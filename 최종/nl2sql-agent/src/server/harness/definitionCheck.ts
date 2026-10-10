import type { DefinitionUsage, Resolution } from "@/lib/agent/contract";
import type { StoredDefinition } from "@/server/semantic/definitions";

/**
 * 정의 준수 검사 (결정론적). 의미 검증 모델의 점수와 무관하게 아래 위반이 있으면 SQL을 승인하지 않는다.
 * - 판정된 공식 지표와 SQL이 밝힌 지표가 다름 / 등록되지 않은 지표 ID
 * - 공식 정의에 필요한 테이블을 참조하지 않음
 * - 공식 정의 산식의 필수 리터럴 조건(예: payment_order = 1)이 SQL에 없음
 * - 계산식 메타데이터 누락
 * - 생성 모델이 밝힌 사용자 미승인 가정
 * 이 검사는 필요조건만 확인한다. 통과해도 의미상 정답이 보장되지 않는다.
 */

export type DefinitionCheckInput = {
  resolution: Resolution;
  usage: DefinitionUsage;
  sql: string;
  referencedTables?: string[];
  definitions: StoredDefinition[];
};
export type DefinitionCheckResult = { passed: boolean; errors: string[]; unapprovedAssumptions: string[] };

const PREDICATE = /\b(?:[a-z_][a-z0-9_]*\.)?([a-z_][a-z0-9_]*)\s*=\s*('(?:[^']|'')*'|\d+(?:\.\d+)?)/gi;
const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** 정의 산식(rule)에 적힌 "컬럼 = 리터럴" 조건. 조인 조건(컬럼 = 컬럼)은 대상이 아니다. */
export function requiredPredicates(rule: string): { column: string; literal: string }[] {
  const found = new Map<string, { column: string; literal: string }>();
  for (const m of rule.matchAll(PREDICATE)) {
    const column = m[1].toLowerCase();
    const literal = m[2];
    found.set(`${column}=${literal}`, { column, literal });
  }
  return [...found.values()];
}

function sqlHasPredicate(sql: string, column: string, literal: string): boolean {
  const col = `(?:\\b[a-z_][a-z0-9_]*\\.)?${escapeRe(column)}`;
  const lit = escapeRe(literal);
  const eq = new RegExp(`${col}\\s*=\\s*${lit}(?![0-9.])|(?<![0-9.])${lit}\\s*=\\s*${col}\\b`, "i");
  // IN 목록 안의 동일 리터럴도 인정한다 (예: channel_type IN ('V')).
  const inList = new RegExp(`${col}\\s+in\\s*\\(([^)]*)\\)`, "gi");
  if (eq.test(sql)) return true;
  for (const m of sql.matchAll(inList)) {
    if (m[1].split(",").some((v) => v.trim() === literal)) return true;
  }
  return false;
}

export function checkDefinitionCompliance(input: DefinitionCheckInput): DefinitionCheckResult {
  const { resolution, usage, sql, definitions } = input;
  const byId = new Map(definitions.map((d) => [d.id, d]));
  const errors: string[] = [];

  const unknown = usage.metricIds.filter((id) => !byId.has(id));
  for (const id of unknown) errors.push(`등록되지 않은 지표 ID '${id}'를 사용했습니다. 공식 정의 ID만 사용할 수 있습니다.`);

  const expected = [...new Set(resolution.metricIds)].sort();
  const declared = [...new Set(usage.metricIds)].sort();
  if (resolution.status === "resolved" && expected.join(",") !== declared.join(",")) {
    errors.push(
      `판정된 공식 지표(${expected.join(", ") || "없음"})와 SQL이 밝힌 지표(${declared.join(", ") || "없음"})가 다릅니다.`,
    );
  }
  if (resolution.status === "no_metric" && declared.some((id) => byId.get(id)?.kind === "metric")) {
    errors.push("지표가 필요 없는 질문으로 판정됐는데 SQL이 업무 지표를 사용했습니다.");
  }

  if (expected.length && !usage.formula.trim()) errors.push("SQL의 실제 계산식(formula)이 비어 있습니다.");

  const tables = input.referencedTables ? new Set(input.referencedTables.map((t) => t.toLowerCase())) : null;
  for (const id of expected) {
    const def = byId.get(id);
    if (!def) {
      errors.push(`판정된 지표 '${id}'의 정의를 찾을 수 없습니다.`);
      continue;
    }
    if (tables) {
      for (const table of def.tables) {
        if (!tables.has(table.toLowerCase())) errors.push(`'${def.name}' 정의에 필요한 테이블 ${table}을(를) SQL이 참조하지 않습니다.`);
      }
    }
    for (const p of requiredPredicates(def.rule)) {
      if (!sqlHasPredicate(sql, p.column, p.literal)) {
        errors.push(`'${def.name}' 정의의 필수 조건 ${p.column} = ${p.literal}이(가) SQL에 없습니다.`);
      }
    }
  }

  const unapprovedAssumptions = usage.unapprovedAssumptions.map((a) => a.trim()).filter(Boolean);
  return { passed: errors.length === 0 && unapprovedAssumptions.length === 0, errors, unapprovedAssumptions };
}
