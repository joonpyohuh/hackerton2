import { z } from "zod";

/**
 * 순수 스키마 모듈 — server-only를 import하지 않아 테스트에서 직접 검증할 수 있다.
 * 런타임에서는 반드시 env.ts(getEnv)를 통해 접근한다.
 */

const emptyToUndefined = (v: unknown) => (v === "" ? undefined : v);

const optionalString = z.preprocess(emptyToUndefined, z.string().min(1).optional());

const csvList = z
  .preprocess(emptyToUndefined, z.string().optional())
  .transform((v) =>
    (v ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
  );

// Supabase의 관리자/소유자 계정. LLM SQL 실행 경로에서 절대 허용하지 않는다.
const PRIVILEGED_DB_USERS = ["postgres", "supabase_admin", "service_role"];

export function isPrivilegedDbUrl(url: string): boolean {
  let user: string;
  try {
    user = decodeURIComponent(new URL(url).username).toLowerCase();
  } catch {
    return true; // 파싱 불가 URL은 안전하지 않은 것으로 간주한다 (fail-closed)
  }
  // Supabase pooler 형식: postgres.<project_ref>
  const base = user.split(".")[0];
  return PRIVILEGED_DB_USERS.includes(base);
}

const readonlyDbUrl = z
  .preprocess(emptyToUndefined, z.string().optional())
  .refine((v) => v === undefined || /^postgres(ql)?:\/\//.test(v), {
    message: "DATABASE_URL_READONLY는 postgres:// 형식이어야 합니다.",
  })
  .refine((v) => v === undefined || !isPrivilegedDbUrl(v), {
    message:
      "DATABASE_URL_READONLY에 관리자 계정(postgres/service_role 등)을 사용할 수 없습니다. 전용 읽기 전용 계정을 지정하세요.",
  });

export const envSchema = z.object({
  AGENT_MODE: z.enum(["mock", "live"]).default("mock"),

  // ── LLM ──
  OPENAI_API_KEY: optionalString,
  GENERATOR_MODEL: z.string().min(1).default("gpt-4.1-mini"),
  // 상위 추론 모델은 기본값 없이 반드시 환경변수로 지정한다.
  VERIFIER_MODEL: optionalString,
  // Semantic Resolver 모델. 미지정 시 VERIFIER_MODEL을 쓴다 (지표 판정은 생성보다 검증에 가까운 작업).
  RESOLVER_MODEL: optionalString,
  EMBEDDING_MODEL: z.string().min(1).default("text-embedding-3-small"),
  LLM_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(300_000).default(60_000),

  // ── Harness Loop ──
  MAX_RETRIES: z.coerce.number().int().min(0).max(10).default(3),
  SEMANTIC_SCORE_THRESHOLD: z.coerce.number().min(0).max(100).default(90),
  REPEATED_ERROR_LIMIT: z.coerce.number().int().min(1).max(10).default(2),

  // ── Database ──
  DATABASE_URL_READONLY: readonlyDbUrl, // LLM 생성 SQL 실행 전용
  DATABASE_URL_APP: optionalString, // 로그·RAG 지식 저장용 (SQL 실행에 사용 금지)
  STATEMENT_TIMEOUT_MS: z.coerce.number().int().min(100).max(60_000).default(5_000),
  MAX_RESULT_ROWS: z.coerce.number().int().min(1).max(10_000).default(1_000),
  // 비어 있으면 어떤 스키마도 허용하지 않는다 (fail-closed). TODO(05단계): 실제 스키마명 확정
  ALLOWED_SCHEMAS: csvList,
});

export type Env = z.infer<typeof envSchema>;

export type EnvParseResult =
  | { ok: true; env: Env }
  | { ok: false; errors: string[] };

export function parseEnv(raw: Record<string, string | undefined>): EnvParseResult {
  const result = envSchema.safeParse(raw);
  if (result.success) return { ok: true, env: result.data };
  return {
    ok: false,
    errors: result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
  };
}

/** 기능별 준비 상태. 누락된 설정이 있으면 해당 기능을 건너뛰지 않고 차단한다. */
export function readiness(env: Env) {
  const missing = (keys: (keyof Env)[]) => keys.filter((k) => !env[k] || (Array.isArray(env[k]) && (env[k] as string[]).length === 0));
  return {
    generation: missing(["OPENAI_API_KEY"]),
    semanticVerification: missing(["OPENAI_API_KEY", "VERIFIER_MODEL"]),
    execution: missing(["DATABASE_URL_READONLY", "ALLOWED_SCHEMAS"]),
    logging: missing(["DATABASE_URL_APP"]),
  };
}
