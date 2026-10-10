import { DatabaseError, Pool, types as pgTypes, type PoolConfig } from "pg";
import type { Cell } from "@/lib/agent/contract";
import { StageError } from "@/server/agent/errors";
import type { ExecutionOutput, QueryExecutor } from "@/server/agent/types";

/**
 * 3차 검증: 읽기 전용 계정 + READ ONLY 트랜잭션 + 커서 FETCH로 행 수 제한.
 * 결과는 항상 ROLLBACK한다. 권한·트랜잭션이 AST 검사와 별개로 쓰기를 막는다.
 */

const OID = { int8: 20, int2: 21, int4: 23, numeric: 1700, float4: 700, float8: 701, date: 1082, timestamp: 1114, timestamptz: 1184, bool: 16 } as const;
const OID_NAME = new Map<number, string>(Object.entries(OID).map(([k, v]) => [v, k]));

// 날짜는 문자열 그대로(시간대 변환 방지), 큰 정수·numeric은 안전 범위면 number로.
const toNumberIfSafe = (v: string): string | number => {
  const n = Number(v);
  return Number.isFinite(n) && Math.abs(n) <= Number.MAX_SAFE_INTEGER ? n : v;
};
const typeParsers: PoolConfig["types"] = {
  getTypeParser: ((oid: number, format?: "text" | "binary") => {
    if (oid === OID.date || oid === OID.timestamp || oid === OID.timestamptz) return (v: string) => v;
    if (oid === OID.int8 || oid === OID.numeric) return toNumberIfSafe;
    return pgTypes.getTypeParser(oid, format ?? "text");
  }) as NonNullable<PoolConfig["types"]>["getTypeParser"],
};

export function createReaderPool(connectionString: string): Pool {
  const local = /@(127\.0\.0\.1|localhost)[:/]/.test(connectionString);
  return new Pool({
    connectionString,
    max: 4,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    application_name: "nl2sql-agent-reader",
    ssl: local ? false : { rejectUnauthorized: false },
    types: typeParsers,
  });
}

const toCell = (v: unknown): Cell => {
  if (v === null || v === undefined) return null;
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return v;
  if (v instanceof Date) return v.toISOString();
  return JSON.stringify(v);
};

/** PostgreSQL SQLSTATE → 재시도 가능 여부. 42xxx(문법·참조 오류)와 22xxx(데이터 오류)는 SQL을 고치면 해결될 수 있다. */
export function toExecutionError(e: unknown, timeoutMs: number): StageError {
  if (e instanceof StageError) return e;
  if (e instanceof DatabaseError && e.code) {
    const code = e.code;
    if (code === "57014") return new StageError("execution", `실행 시간 제한(${timeoutMs}ms)을 초과했습니다. 집계 범위를 줄이거나 조건을 추가하세요.`, true, { cause: e });
    if (code === "42501") return new StageError("execution", "권한이 없는 객체를 참조했습니다.", false, { cause: e });
    if (code === "25006") return new StageError("execution", "쓰기 작업은 차단되었습니다. 조회만 실행할 수 있습니다.", false, { cause: e });
    if (code.startsWith("42") || code.startsWith("22") || code === "54001")
      return new StageError("execution", `SQL 실행 오류: ${e.message}`, true, { cause: e });
    if (code.startsWith("08") || code.startsWith("28") || code === "3D000")
      return new StageError("config", "데이터베이스에 연결할 수 없습니다. 접속 정보를 확인하세요.", false, { cause: e });
    return new StageError("execution", `데이터베이스 오류(${code}): ${e.message}`, false, { cause: e });
  }
  const sys = (e as { code?: unknown } | null)?.code;
  if (typeof sys === "string" && /^E(CONN|TIMEDOUT|NOTFOUND|HOSTUNREACH)/.test(sys))
    return new StageError("config", "데이터베이스에 연결할 수 없습니다. DB 서버가 실행 중인지 확인하세요.", false, { cause: e });
  return new StageError("execution", "SQL 실행 중 알 수 없는 오류가 발생했습니다.", false, { cause: e });
}

export function createQueryExecutor(options: { pool: Pool; maxRows: number; statementTimeoutMs: number }): QueryExecutor {
  const { pool, maxRows, statementTimeoutMs } = options;
  return {
    async execute(sql: string): Promise<ExecutionOutput> {
      let client;
      try {
        client = await pool.connect();
      } catch (e) {
        throw toExecutionError(e, statementTimeoutMs);
      }
      try {
        await client.query("BEGIN READ ONLY");
        await client.query(`SET LOCAL statement_timeout = ${Math.trunc(statementTimeoutMs)}`);
        await client.query(`DECLARE nl2sql_cursor NO SCROLL CURSOR FOR ${sql}`);
        const res = await client.query({ text: `FETCH FORWARD ${maxRows + 1} FROM nl2sql_cursor`, rowMode: "array" });

        // 같은 이름의 컬럼(예: count 두 개)도 잃지 않도록 키를 유일하게 만든다.
        const seen = new Map<string, number>();
        const columns = res.fields.map((f) => {
          const n = (seen.get(f.name) ?? 0) + 1;
          seen.set(f.name, n);
          return { name: n === 1 ? f.name : `${f.name}_${n}`, dataType: OID_NAME.get(f.dataTypeID) ?? "text" };
        });
        const raw = res.rows as unknown[][];
        const rows = raw.slice(0, maxRows).map((r) => Object.fromEntries(columns.map((c, i) => [c.name, toCell(r[i])])));
        return { columns, rows, rowCount: rows.length, truncated: raw.length > maxRows };
      } catch (e) {
        throw toExecutionError(e, statementTimeoutMs);
      } finally {
        await client.query("ROLLBACK").catch(() => {});
        client.release();
      }
    },
  };
}
