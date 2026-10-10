import { connection, NextResponse } from "next/server";
import { EnvConfigError, getEnv } from "@/server/config/env";
import { readiness } from "@/server/config/env.schema";
import { parserHealth } from "@/server/harness/structural/validator";

// 비밀값은 노출하지 않고 설정 여부와 모델명만 반환한다.
export async function GET() {
  await connection(); // 빌드 시 프리렌더 방지 — 런타임 환경변수 기준으로 응답
  try {
    const env = getEnv();
    return NextResponse.json({
      ok: true,
      mode: env.AGENT_MODE,
      models: { generator: env.GENERATOR_MODEL, verifier: env.VERIFIER_MODEL ?? null },
      loop: {
        maxRetries: env.MAX_RETRIES,
        semanticScoreThreshold: env.SEMANTIC_SCORE_THRESHOLD,
        repeatedErrorLimit: env.REPEATED_ERROR_LIMIT,
      },
      missing: readiness(env),
      sqlParser: (await parserHealth()) ? "ok" : "error",
    });
  } catch (e) {
    if (e instanceof EnvConfigError) {
      return NextResponse.json({ ok: false, errors: e.errors }, { status: 500 });
    }
    return NextResponse.json({ ok: false, errors: ["알 수 없는 설정 오류"] }, { status: 500 });
  }
}
