/**
 * 통합 테스트 — 실제 PostgreSQL(analytics 스키마, 읽기 전용 계정) 대상.
 * .env.local에 DATABASE_URL_READONLY가 없으면 건너뛴다. (npm run db:local → npm run db:setup)
 * LLM은 fake로 대체한다. 기대값은 원본 CSV 프로파일링으로 확인한 수치다.
 */
import path from "node:path";
import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readEnvFile } from "../../scripts/lib/envFile";
import type { AgentEvent } from "@/lib/agent/contract";
import { StageError } from "@/server/agent/errors";
import { createTemplateFormatter } from "@/server/agent/formatter";
import { InMemoryRunLogger } from "@/server/agent/logger";
import { runAgentPipeline } from "@/server/agent/pipeline";
import { createBasicRetriever } from "@/server/agent/retriever";
import type { PipelineDeps } from "@/server/agent/types";
import { createQueryExecutor, createReaderPool } from "@/server/db/executor";
import { loadMetadata, type DbMetadata } from "@/server/db/metadata";
import { createStructuralValidator } from "@/server/harness/structural/validator";

const url = readEnvFile(path.resolve(".env.local")).DATABASE_URL_READONLY;

describe.skipIf(!url)("analytics DB (읽기 전용 계정)", () => {
  let pool: Pool;
  let meta: DbMetadata;
  const signal = new AbortController().signal;

  beforeAll(async () => {
    pool = createReaderPool(url!);
    meta = await loadMetadata(pool, ["analytics"]);
  });
  afterAll(async () => pool?.end());

  it("메타데이터: 7개 테이블과 기본키·외래키를 읽는다", () => {
    expect(meta.tables.map((t) => t.name).sort()).toEqual(
      ["behavior_fact", "content_dim", "content_genre_bridge", "payment_fact", "user_content_summary", "user_dim", "watch_daily_fact"],
    );
    const payment = meta.tables.find((t) => t.name === "payment_fact");
    expect(payment?.constraints.some((c) => c.startsWith("FOREIGN KEY (user_key)"))).toBe(true);
    expect(meta.catalog.getColumns("analytics", "user_dim")?.has("signup_device_type")).toBe(true);
  });

  it("구조 검사: 실제 카탈로그로 없는 컬럼을 잡는다", async () => {
    const v = createStructuralValidator({ catalog: meta.catalog, allowedSchemas: ["analytics"] });
    expect((await v.validate("SELECT signup_device_type, count(*) FROM analytics.user_dim GROUP BY 1")).passed).toBe(true);
    expect((await v.validate("SELECT revenue FROM analytics.payment_fact")).errors[0]).toContain("revenue");
  });

  it("실행: 숫자·날짜 타입을 보존하고 원본 행 수와 일치한다", async () => {
    const ex = createQueryExecutor({ pool, maxRows: 100, statementTimeoutMs: 5_000 });
    const r = await ex.execute("SELECT count(*) AS n, min(signup_date) AS first_day FROM analytics.user_dim", signal);
    expect(r.rows[0]).toEqual({ n: 50000, first_day: "2025-02-01" });
    expect(r.columns.map((c) => c.dataType)).toEqual(["int8", "date"]);
  });

  it("실행: 최대 행 수를 넘으면 잘라내고 표시한다 (정렬 유지)", async () => {
    const ex = createQueryExecutor({ pool, maxRows: 3, statementTimeoutMs: 5_000 });
    const r = await ex.execute("SELECT user_key FROM analytics.user_dim ORDER BY user_key DESC", signal);
    expect(r.rowCount).toBe(3);
    expect(r.truncated).toBe(true);
    const keys = r.rows.map((x) => String(x.user_key));
    expect([...keys].sort().reverse()).toEqual(keys);
  });

  it("실행: 시간 초과는 재시도 가능 오류", async () => {
    const ex = createQueryExecutor({ pool, maxRows: 10, statementTimeoutMs: 100 });
    const err = await ex
      .execute("SELECT count(*) FROM analytics.behavior_fact a CROSS JOIN analytics.behavior_fact b", signal)
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(StageError);
    expect(err).toMatchObject({ kind: "execution", retryable: true });
    expect((err as StageError).message).toContain("실행 시간 제한");
  });

  it("실행: DB가 거부한 SQL 오류는 피드백 가능한 재시도 오류", async () => {
    const ex = createQueryExecutor({ pool, maxRows: 10, statementTimeoutMs: 5_000 });
    const err = await ex.execute("SELECT 1 / 0", signal).catch((e: unknown) => e);
    expect(err).toMatchObject({ retryable: true });
    expect((err as StageError).message).toContain("division by zero");
  });

  it("파이프라인 전체(LLM만 fake): 실제 DB 결과로 한국어 답변을 만든다", async () => {
    const SQL = `SELECT signup_device_type AS device, count(*) AS users
                   FROM analytics.user_dim GROUP BY 1 ORDER BY users DESC`;
    const usage = { model: "fake", promptVersion: null, inputTokens: 0, outputTokens: 0 };
    const logger = new InMemoryRunLogger();
    const deps: PipelineDeps = {
      retriever: createBasicRetriever({ getMetadata: async () => meta, notesVersion: "test" }),
      generator: {
        generate: async () => ({
          sql: SQL,
          title: "가입 기기별 가입자 수",
          period: "전체 가입 기간",
          columnLabels: { device: "가입 기기", users: "가입자 수" },
          explanation: "",
          usedMetrics: ["가입자 수"],
          assumptions: [],
          needsClarification: false,
          clarificationQuestion: null,
          usage: { stage: "generation", ...usage },
        }),
      },
      structural: createStructuralValidator({ catalog: meta.catalog, allowedSchemas: ["analytics"] }),
      verifier: {
        verify: async () => ({ passed: true, score: 95, errors: [], suggestions: [], missingDefinitions: [], needsClarification: false, usage: { stage: "verification", ...usage } }),
      },
      executor: createQueryExecutor({ pool, maxRows: 1000, statementTimeoutMs: 5_000 }),
      formatter: createTemplateFormatter(),
      logger,
    };
    const config = { maxRetries: 1, semanticScoreThreshold: 90, repeatedErrorLimit: 2, llmTimeoutMs: 5_000, executionTimeoutMs: 7_000, models: { generator: "fake", verifier: "fake" } };
    const events: AgentEvent[] = [];
    for await (const e of runAgentPipeline("가입 기기별 가입자 수", deps, config, signal)) events.push(e);
    const last = events.at(-1);
    if (last?.type !== "final" || last.response.status !== "passed") throw new Error(JSON.stringify(last));
    const r = last.response;
    // 원본 CSV 프로파일링 값: mobile 17,165 / android 15,056 / ios 11,722 / pc 6,057
    expect(r.table.rows).toEqual([
      { device: "mobile", users: 17165 },
      { device: "android", users: 15056 },
      { device: "ios", users: 11722 },
      { device: "pc", users: 6057 },
    ]);
    expect(r.table.columns.map((c) => c.label)).toEqual(["가입 기기", "가입자 수"]);
    expect(r.answer).toBe("가입 기기별 가입자 수 — 4행을 조회했습니다.");
    expect(r.isMock).toBe(false);
    expect(r.meta.groundTruth).toBe("unverified");
    expect(logger.logs[0]?.knowledgeStatus).toBe("MODEL_VERIFIED");
  });
});
