import { parse } from "libpg-query";
import type { StructuralResult, StructuralValidator } from "@/server/agent/types";
import { ALLOWED_FUNCTIONS, ALLOWED_NODES, MAX_SQL_LENGTH, NODE_REJECTION } from "./allowlist";
import type { SchemaCatalog } from "./catalog";

/**
 * 1차 검증: PostgreSQL 실제 파서(libpg-query) AST 기반 결정론적 검사.
 * 문자열 검색으로 보안을 판단하지 않는다. 이 검사를 통과해도 DB 읽기 전용 권한 검사를 대체하지 않는다.
 */

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
/** {"String":{"sval":"x"}} → "x", {"A_Star":{}} → "*" */
const nameOf = (n: unknown): string | null => {
  if (!isObj(n)) return null;
  if (isObj(n.String)) return str(n.String.sval);
  if ("A_Star" in n) return "*";
  return null;
};
const aliasOf = (v: Obj): string | null => (isObj(v.alias) ? str(v.alias.aliasname) : null);

type RangeRef = { catalog: string | null; schema: string | null; rel: string; alias: string | null };

const DERIVED = Symbol("derived");
type Source = ReadonlySet<string> | typeof DERIVED;

const rejectNode = (node: string) => {
  const label = NODE_REJECTION[node];
  return label ? `${label} 구문은 허용되지 않습니다. 조회(SELECT)만 실행할 수 있습니다.` : `허용되지 않은 SQL 구문입니다: ${node}`;
};

export function createStructuralValidator(options: { catalog: SchemaCatalog; allowedSchemas: string[] }): StructuralValidator {
  const { catalog } = options;
  const allowedSchemas = new Set(options.allowedSchemas);

  return {
    async validate(rawSql: string): Promise<StructuralResult> {
      const fail = (errors: string[]): StructuralResult => ({ passed: false, errors: [...new Set(errors)], normalizedSql: null });
      const sql = rawSql.trim();
      if (!sql) return fail(["SQL이 비어 있습니다."]);
      if (sql.length > MAX_SQL_LENGTH) return fail([`SQL 길이가 ${MAX_SQL_LENGTH}자를 초과합니다.`]);
      if (allowedSchemas.size === 0) return fail(["허용된 스키마가 설정되지 않아 실행할 수 없습니다."]);

      let tree: unknown;
      try {
        tree = await parse(sql);
      } catch (e) {
        return fail([`SQL 문법 오류: ${e instanceof Error ? e.message : String(e)}`]);
      }
      const stmts = isObj(tree) && Array.isArray(tree.stmts) ? tree.stmts : [];
      if (stmts.length !== 1) return fail([stmts.length === 0 ? "실행할 SQL 문이 없습니다." : "여러 개의 SQL 문을 한 번에 실행할 수 없습니다."]);
      const first = stmts[0];
      const top = isObj(first) && isObj(first.stmt) ? first.stmt : {};
      const topType = Object.keys(top)[0] ?? "알 수 없음";
      if (topType !== "SelectStmt") return fail([rejectNode(topType)]);

      // ── AST 순회: 허용 목록 검사 + 참조 수집 ──
      const errors: string[] = [];
      const ranges: RangeRef[] = [];
      const columnRefs: string[][] = [];
      const cteNames = new Set<string>();
      const derivedAliases = new Set<string>();
      const targetNames = new Set<string>();

      const visit = (node: unknown): void => {
        if (Array.isArray(node)) return node.forEach(visit);
        if (!isObj(node)) return;
        for (const [key, value] of Object.entries(node)) {
          if (key === "intoClause") {
            errors.push("SELECT INTO(테이블 생성)는 허용되지 않습니다.");
            continue;
          }
          if (/^[A-Z]/.test(key)) {
            if (!ALLOWED_NODES.has(key)) {
              errors.push(rejectNode(key));
              continue;
            }
            if (isObj(value)) collect(key, value);
          }
          visit(value);
        }
      };

      const collect = (type: string, v: Obj) => {
        switch (type) {
          case "FuncCall": {
            const parts = (Array.isArray(v.funcname) ? v.funcname : []).map(nameOf);
            const full = parts.join(".");
            const name = (parts.at(-1) ?? "").toLowerCase();
            if (parts.length > 2 || (parts.length === 2 && parts[0] !== "pg_catalog")) {
              errors.push(`스키마를 지정한 함수 ${full}()은(는) 허용되지 않습니다.`);
            } else if (!ALLOWED_FUNCTIONS.has(name)) {
              errors.push(`함수 ${name}()은(는) 허용되지 않습니다.`);
            }
            break;
          }
          case "RangeVar": {
            const rel = str(v.relname);
            if (rel) ranges.push({ catalog: str(v.catalogname), schema: str(v.schemaname), rel, alias: aliasOf(v) });
            break;
          }
          case "RangeSubselect":
          case "JoinExpr": {
            const alias = aliasOf(v);
            if (alias) derivedAliases.add(alias);
            break;
          }
          case "CommonTableExpr": {
            const name = str(v.ctename);
            if (name) cteNames.add(name);
            break;
          }
          case "ResTarget": {
            const name = str(v.name);
            if (name) targetNames.add(name);
            break;
          }
          case "ColumnRef": {
            const fields = (Array.isArray(v.fields) ? v.fields : []).map(nameOf);
            if (fields.every((f): f is string => f !== null)) columnRefs.push(fields);
            break;
          }
        }
      };

      visit(top);

      // ── 테이블·스키마 검사 ──
      const sources = new Map<string, Source>();
      const referencedTables: ReadonlySet<string>[] = [];
      const tableNames = new Set<string>();
      for (const alias of derivedAliases) sources.set(alias, DERIVED);
      for (const r of ranges) {
        const visibleName = r.alias ?? r.rel;
        if (r.catalog) {
          errors.push(`다른 데이터베이스(${r.catalog})는 참조할 수 없습니다.`);
          continue;
        }
        if (!r.schema && cteNames.has(r.rel)) {
          sources.set(visibleName, DERIVED);
          continue;
        }
        const schema = r.schema ?? catalog.defaultSchema;
        if (!allowedSchemas.has(schema)) {
          errors.push(`스키마 ${schema}에는 접근할 수 없습니다.`);
          continue;
        }
        const columns = catalog.getColumns(schema, r.rel);
        if (!columns) {
          errors.push(`테이블 ${schema}.${r.rel}이(가) 존재하지 않습니다.`);
          continue;
        }
        sources.set(visibleName, columns);
        if (r.schema) sources.set(`${r.schema}.${r.rel}`, columns);
        referencedTables.push(columns);
        tableNames.add(`${schema}.${r.rel}`);
      }

      // ── 컬럼 검사 (파생 테이블·CTE 출처는 DB 실행 단계에서 확인) ──
      const hasDerived = [...sources.values()].some((s) => s === DERIVED);
      for (const fields of columnRefs) {
        const col = fields[fields.length - 1];
        const qualifier = fields.slice(0, -1).join(".");
        if (fields.length > 3) {
          errors.push(`지원하지 않는 컬럼 참조 형식입니다: ${fields.join(".")}`);
          continue;
        }
        if (!qualifier) {
          if (col === "*") continue;
          const known = targetNames.has(col) || referencedTables.some((t) => t.has(col));
          if (!known && !hasDerived) errors.push(`컬럼 ${col}이(가) 참조한 테이블에 없습니다.`);
          continue;
        }
        const source = sources.get(qualifier);
        if (!source) {
          errors.push(`테이블 또는 별칭 ${qualifier}을(를) FROM 절에서 찾을 수 없습니다.`);
          continue;
        }
        if (source !== DERIVED && col !== "*" && !source.has(col)) {
          errors.push(`컬럼 ${qualifier}.${col}이(가) 존재하지 않습니다.`);
        }
      }

      if (errors.length) return fail(errors);
      // 행 수 제한은 실행기(05단계)가 강제한다. 여기서는 끝의 세미콜론·공백만 정리한다.
      return { passed: true, errors: [], normalizedSql: sql.replace(/[\s;]+$/, ""), referencedTables: [...tableNames] };
    },
  };
}

/** 파서(WASM) 로딩 여부 진단용 */
export async function parserHealth(): Promise<boolean> {
  try {
    await parse("SELECT 1");
    return true;
  } catch {
    return false;
  }
}
