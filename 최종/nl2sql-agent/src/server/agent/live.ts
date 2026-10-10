import "server-only";
import type { Pool } from "pg";
import type { Env } from "@/server/config/env.schema";
import { readiness } from "@/server/config/env.schema";
import { createQueryExecutor, createReaderPool } from "@/server/db/executor";
import { createMetadataCache, loadMetadata, schemaFingerprint } from "@/server/db/metadata";
import { createValueHintsCache } from "@/server/db/valueHints";
import { createSemanticResolver } from "@/server/semantic/resolver";
import { createSemanticVerifier } from "@/server/harness/semanticVerifier";
import { createStructuralValidator } from "@/server/harness/structural/validator";
import { createOpenAIChat } from "@/server/llm/chat";
import { DATA_NOTES, DATA_NOTES_VERSION } from "@/server/semantic/dataNotes";
import { createTemplateFormatter } from "./formatter";
import { createSqlGenerator } from "./generator";
import { getSemanticStore } from "@/server/semantic/store";
import { createBasicRetriever } from "./retriever";
import type { PipelineConfig, PipelineDeps } from "./types";

export function pipelineConfigFromEnv(env: Env): PipelineConfig {
  return {
    maxRetries: env.MAX_RETRIES,
    semanticScoreThreshold: env.SEMANTIC_SCORE_THRESHOLD,
    repeatedErrorLimit: env.REPEATED_ERROR_LIMIT,
    llmTimeoutMs: env.LLM_TIMEOUT_MS,
    // DB statement_timeout보다 약간 길게 — DB가 먼저 끊고 명확한 오류를 돌려주게 한다.
    executionTimeoutMs: env.STATEMENT_TIMEOUT_MS + 2_000,
    models: { generator: env.GENERATOR_MODEL, verifier: env.VERIFIER_MODEL ?? null, resolver: env.RESOLVER_MODEL ?? env.VERIFIER_MODEL ?? null },
  };
}

export type LiveAgent = { ok: true; deps: PipelineDeps; config: PipelineConfig } | { ok: false; missing: string[] };
export async function currentSchemaVersion(env: Env) {
  if (!env.DATABASE_URL_READONLY) throw new Error("읽기 전용 데이터 연결이 없습니다.");
  return schemaFingerprint((await loadMetadata(readerPool(env.DATABASE_URL_READONLY), env.ALLOWED_SCHEMAS)).tables);
}

// 개발 서버 핫리로드에서도 커넥션 풀을 하나만 유지한다.
const globalForDb = globalThis as unknown as { nl2sqlReaderPool?: { url: string; pool: Pool } };
function readerPool(url: string): Pool {
  const cached = globalForDb.nl2sqlReaderPool;
  if (cached?.url === url) return cached.pool;
  const pool = createReaderPool(url);
  globalForDb.nl2sqlReaderPool = { url, pool };
  return pool;
}

let metadataCache: { key: string; cache: ReturnType<typeof createMetadataCache> } | null = null;
let valueHints: { pool: Pool; cache: ReturnType<typeof createValueHintsCache> } | null = null;

/** 실제 구현체 조립. 필수 설정이 하나라도 빠지면 실행하지 않는다 (검증 단계를 건너뛰는 경로 없음). */
export function buildLiveAgent(env: Env): LiveAgent {
  const r = readiness(env);
  const missing = [...new Set([...r.generation, ...r.semanticVerification, ...r.execution, ...r.logging])];
  if (missing.length || !env.OPENAI_API_KEY || !env.VERIFIER_MODEL || !env.DATABASE_URL_READONLY || !env.DATABASE_URL_APP) {
    return { ok: false, missing: missing.map((k) => `환경변수 ${k}`) };
  }

  const pool = readerPool(env.DATABASE_URL_READONLY);
  const key = `${env.DATABASE_URL_READONLY}|${env.ALLOWED_SCHEMAS.join(",")}`;
  if (metadataCache?.key !== key) metadataCache = { key, cache: createMetadataCache(pool, env.ALLOWED_SCHEMAS) };
  const metadata = metadataCache.cache;
  const store = getSemanticStore(env.DATABASE_URL_APP);
  const chat = createOpenAIChat(env.OPENAI_API_KEY);

  if (!valueHints || valueHints.pool !== pool) valueHints = { pool, cache: createValueHintsCache(pool) };
  const hints = valueHints.cache;

  const deps: PipelineDeps = {
    resolver: createSemanticResolver({
      chat,
      model: env.RESOLVER_MODEL ?? env.VERIFIER_MODEL,
      listDefinitions: () => store.list(),
      valueHints: () => hints.get(),
    }),
    retriever: createBasicRetriever({ getMetadata: () => metadata.get(), notesVersion: DATA_NOTES_VERSION, store }),
    generator: createSqlGenerator({ chat, model: env.GENERATOR_MODEL, dataNotes: DATA_NOTES }),
    structural: {
      // 카탈로그는 DB 메타데이터에서 만든다 (하드코딩 없음)
      async validate(sql) {
        const meta = await metadata.get();
        return createStructuralValidator({ catalog: meta.catalog, allowedSchemas: env.ALLOWED_SCHEMAS }).validate(sql);
      },
    },
    verifier: createSemanticVerifier({ chat, model: env.VERIFIER_MODEL, dataNotes: DATA_NOTES }),
    executor: createQueryExecutor({ pool, maxRows: env.MAX_RESULT_ROWS, statementTimeoutMs: env.STATEMENT_TIMEOUT_MS }),
    formatter: createTemplateFormatter(),
    logger: { save: (log) => store.saveRun(log) },
  };
  return { ok: true, deps, config: pipelineConfigFromEnv(env) };
}
