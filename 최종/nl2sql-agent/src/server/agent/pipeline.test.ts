import { describe, expect, it, vi } from "vitest";
import { agentEventSchema, type AgentEvent, type AgentResponse, type ConversationTurn, type Resolution } from "@/lib/agent/contract";
import { SEED_DEFINITIONS, type StoredDefinition } from "@/server/semantic/definitions";
import { StageError } from "./errors";
import { InMemoryRunLogger } from "./logger";
import { runAgentPipeline } from "./pipeline";
import type {
  ContextRetriever,
  ExecutionOutput,
  GenerationInput,
  GenerationOutput,
  PipelineConfig,
  PipelineDeps,
  RetrievedContext,
  SemanticResolver,
  SemanticVerdict,
  StructuralResult,
} from "./types";

// ── fakes: 실제 스키마와 무관한 최소 값 ──
const usage = (stage: "generation" | "verification") => ({ stage, model: "fake", promptVersion: null, inputTokens: 10, outputTokens: 5 });
const CONTEXT: RetrievedContext = {
  schemaContext: "fake_table(a int)",
  semanticContext: "",
  examples: "",
  isAmbiguous: false,
  clarificationQuestion: null,
  missingDefinitions: [],
  definitionVersion: "v-test",
  sources: ["fake_table"],
};
const gen = (sql: string | null, extra: Partial<GenerationOutput> = {}): GenerationOutput => ({
  sql,
  title: "테스트",
  period: null,
  columnLabels: {},
  explanation: "",
  usedMetrics: [],
  assumptions: [],
  needsClarification: false,
  clarificationQuestion: null,
  definition: { metricIds: [], definitionRefs: [], formula: "", filters: [], grain: null, unapprovedAssumptions: [], candidateIds: [] },
  usage: usage("generation"),
  ...extra,
});
const ok: StructuralResult = { passed: true, errors: [], normalizedSql: "SELECT a FROM fake_table LIMIT 1000" };
const bad = (e: string): StructuralResult => ({ passed: false, errors: [e], normalizedSql: null });
const verdict = (score: number, extra: Partial<SemanticVerdict> = {}): SemanticVerdict => ({
  passed: score >= 90,
  score,
  errors: score >= 90 ? [] : ["의미 오류"],
  suggestions: [],
  missingDefinitions: [],
  needsClarification: false,
  definitionMatch: true,
  grainMatch: true,
  unapprovedAssumptions: [],
  usage: usage("verification"),
  ...extra,
});

/** 기본 판정: 지표 없이 원천 조회 (기존 루프 테스트가 판정 단계의 영향을 받지 않게 한다) */
const resolution = (extra: Partial<Resolution> = {}): Resolution => ({
  status: "no_metric",
  standaloneQuestion: "질문",
  requestedMetric: null,
  metricIds: [],
  supportIds: [],
  filters: [],
  period: null,
  grain: null,
  relations: [],
  unspecified: [],
  confirmed: [],
  assumptions: [],
  options: [],
  reason: null,
  clarificationQuestion: null,
  concepts: [],
  candidateIds: [],
  ...extra,
});
const rows = (n: number): ExecutionOutput => ({
  columns: [{ name: "a", dataType: "int4" }],
  rows: Array.from({ length: n }, (_, i) => ({ a: i })),
  rowCount: n,
  truncated: false,
});

const CONFIG: PipelineConfig = {
  maxRetries: 3,
  semanticScoreThreshold: 90,
  repeatedErrorLimit: 2,
  llmTimeoutMs: 1_000,
  executionTimeoutMs: 1_000,
  models: { generator: "fake-gen", verifier: "fake-ver" },
};

/** 호출 순서대로 값을 꺼내는 스크립트 fake. 값이 Error면 throw. */
function script<T, A extends unknown[]>(values: (T | Error)[]) {
  let i = 0;
  return vi.fn<(...args: A) => Promise<T>>(async () => {
    const v = values[Math.min(i++, values.length - 1)];
    if (v instanceof Error) throw v;
    return v;
  });
}

/** n번째 생성 호출의 입력 */
function genInput(fn: { mock: { calls: [GenerationInput, AbortSignal][] } }, n: number): GenerationInput {
  const call = fn.mock.calls[n];
  if (!call) throw new Error(`생성 호출 ${n} 없음`);
  return call[0];
}

function setup(over: {
  resolution?: Resolution;
  context?: RetrievedContext;
  generations?: (GenerationOutput | Error)[];
  structural?: StructuralResult[];
  verdicts?: (SemanticVerdict | Error)[];
  executions?: (ExecutionOutput | Error)[];
}) {
  const logger = new InMemoryRunLogger();
  const generate = script<GenerationOutput, [GenerationInput, AbortSignal]>(over.generations ?? [gen("SELECT a FROM fake_table")]);
  const validate = script<StructuralResult, [string]>(over.structural ?? [ok]);
  const verify = script<SemanticVerdict, [unknown, AbortSignal]>(over.verdicts ?? [verdict(95)]);
  const execute = script<ExecutionOutput, [string, AbortSignal]>(over.executions ?? [rows(2)]);
  const resolve = vi.fn<SemanticResolver["resolve"]>(async () => ({ resolution: over.resolution ?? resolution(), usage: null }));
  const retrieve = vi.fn<ContextRetriever["retrieve"]>(async () => over.context ?? CONTEXT);
  const deps: PipelineDeps = {
    resolver: { resolve },
    retriever: { retrieve },
    generator: { generate },
    structural: { validate },
    verifier: { verify },
    executor: { execute },
    formatter: {
      format: async ({ execution }) => ({
        answer: "테스트 답변",
        table: { columns: [{ key: "a", label: "A", kind: "number" }], rows: execution.rows, rowCount: execution.rowCount, truncated: false },
        metrics: [],
        period: null,
        assumptions: [],
        usage: null,
      }),
    },
    logger,
    newId: () => "req-test",
  };
  return { deps, logger, generate, validate, verify, execute, resolve, retrieve };
}

async function run(deps: PipelineDeps, config = CONFIG, signal = new AbortController().signal, question = "질문", history: ConversationTurn[] = []) {
  const events: AgentEvent[] = [];
  for await (const e of runAgentPipeline(question, deps, config, signal, history)) events.push(e);
  for (const e of events) expect(agentEventSchema.safeParse(e).success).toBe(true);
  const last = events.at(-1);
  if (last?.type !== "final") throw new Error("final 이벤트 없음");
  return { events, response: last.response };
}

function expectStatus<S extends AgentResponse["status"]>(r: AgentResponse, s: S): Extract<AgentResponse, { status: S }> {
  expect(r.status).toBe(s);
  return r as Extract<AgentResponse, { status: S }>;
}

describe("runAgentPipeline", () => {
  it("1. 정상: 첫 시도에 통과하고 MODEL_VERIFIED로만 기록된다 (정답 미확인)", async () => {
    const { deps, logger } = setup({});
    const { response } = await run(deps);
    const r = expectStatus(response, "passed");
    expect(r.attempts).toHaveLength(1);
    expect(r.meta.groundTruth).toBe("unverified");
    expect(r.sql).toBe(ok.normalizedSql);
    expect(logger.logs[0]).toMatchObject({ finalStatus: "passed", knowledgeStatus: "MODEL_VERIFIED", definitionVersion: "v-test" });
    expect(logger.logs[0].usage.map((u) => u.stage)).toEqual(["generation", "verification"]);
  });

  it("2·7. 구조 오류(존재하지 않는 컬럼·문법) → 오류를 피드백으로 재생성", async () => {
    const { deps, generate } = setup({ structural: [bad("컬럼 b가 존재하지 않습니다."), ok] });
    const r = expectStatus((await run(deps)).response, "passed");
    expect(r.attempts.map((a) => a.structural.status)).toEqual(["failed", "passed"]);
    expect(r.attempts[0].semantic.status).toBe("skipped");
    expect(genInput(generate, 1)).toMatchObject({ attempt: 1, feedback: ["컬럼 b가 존재하지 않습니다."] });
  });

  it("3·4·6. 의미 검증 점수 미달(passed=true여도 기준 미만) → 재시도", async () => {
    const { deps, generate } = setup({ verdicts: [verdict(85, { passed: true, errors: [] }), verdict(93)] });
    const r = expectStatus((await run(deps)).response, "passed");
    expect(r.attempts[0].semantic).toMatchObject({ status: "failed", score: 85 });
    expect(r.attempts[0].execution.status).toBe("skipped");
    expect(genInput(generate, 1).feedback[0]).toContain("85점");
  });

  it("5. 정의되지 않은 지표 → 재생성하지 않고 확인 질문", async () => {
    const { deps, generate } = setup({ verdicts: [verdict(40, { missingDefinitions: ["유지율 분모"] })] });
    const r = expectStatus((await run(deps)).response, "needs_clarification");
    expect(r.missingDefinitions).toEqual(["유지율 분모"]);
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it("5. 맥락 단계에서 모호하면 생성 자체를 하지 않는다", async () => {
    const { deps, generate, logger } = setup({ context: { ...CONTEXT, isAmbiguous: true, clarificationQuestion: "기간은?" } });
    const r = expectStatus((await run(deps)).response, "needs_clarification");
    expect(r.clarificationQuestion).toBe("기간은?");
    expect(generate).not.toHaveBeenCalled();
    expect(logger.logs[0].knowledgeStatus).toBeNull();
  });

  it("9. DB 실행 실패(재시도 가능) → 실행 오류를 피드백으로 재시도", async () => {
    const { deps, generate } = setup({
      executions: [new StageError("execution", "division by zero", true), rows(1)],
    });
    const r = expectStatus((await run(deps)).response, "passed");
    expect(r.attempts[0].execution).toMatchObject({ status: "failed", errors: ["division by zero"] });
    expect(genInput(generate, 1).feedback).toEqual(["실행 오류: division by zero"]);
  });

  it("10. 최대 재시도 초과 → 검증 실패, 시도 수 = maxRetries + 1", async () => {
    const { deps, generate, logger } = setup({
      structural: [bad("오류 A"), bad("오류 B"), bad("오류 C"), bad("오류 D")],
    });
    const r = expectStatus((await run(deps, { ...CONFIG, repeatedErrorLimit: 10 })).response, "failed");
    expect(generate).toHaveBeenCalledTimes(4);
    expect(r.reasons[0]).toContain("최대 재시도 횟수(3회)");
    expect(logger.logs[0].knowledgeStatus).toBe("REJECTED");
    expect(logger.logs[0].finalSql).toBeNull();
  });

  it("11. 동일 오류 반복(숫자만 다른 경우 포함) → 조기 종료", async () => {
    const { deps, generate } = setup({ structural: [bad("LIMIT 5000 초과"), bad("LIMIT 7000 초과")] });
    const r = expectStatus((await run(deps)).response, "failed");
    expect(generate).toHaveBeenCalledTimes(2);
    expect(r.reasons[0]).toContain("동일한 오류가 2회 연속");
  });

  it("13. 결과 0건은 실패가 아니다", async () => {
    const { deps } = setup({ executions: [rows(0)] });
    const r = expectStatus((await run(deps)).response, "passed");
    expect(r.table.rowCount).toBe(0);
  });

  it("14. 검증 모델의 잘못된 JSON → 통과시키지 않고, SQL 피드백에도 섞지 않는다", async () => {
    const { deps, generate, execute } = setup({
      verdicts: [new StageError("invalid_response", "검증 모델 응답이 JSON 형식이 아닙니다.", true), verdict(95)],
    });
    const r = expectStatus((await run(deps)).response, "passed");
    expect(r.attempts[0].semantic.status).toBe("failed");
    expect(r.attempts[0].execution.status).toBe("skipped");
    expect(execute).toHaveBeenCalledTimes(1);
    expect(genInput(generate, 1).feedback).toEqual([]);
  });

  it("재시도 불가 오류(예: API 인증 실패)는 즉시 종료한다", async () => {
    const { deps, generate } = setup({ generations: [new StageError("upstream", "OpenAI 인증 실패 (401)", false)] });
    const r = expectStatus((await run(deps)).response, "failed");
    expect(r.reasons).toEqual(["OpenAI 인증 실패 (401)"]);
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it("타임아웃은 재시도 가능 오류로 처리된다", async () => {
    const { deps } = setup({});
    let calls = 0;
    deps.verifier = {
      verify: (_input, signal) =>
        calls++ === 0
          ? new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("aborted"))))
          : Promise.resolve(verdict(95)),
    };
    const r = expectStatus((await run(deps, { ...CONFIG, llmTimeoutMs: 30 })).response, "passed");
    expect(r.attempts[0].semantic.errors[0]).toContain("응답 시간(30ms)");
  });

  it("사용자 취소 시 루프를 멈추고 실패로 기록한다", async () => {
    const { deps, generate } = setup({});
    const controller = new AbortController();
    controller.abort();
    const r = expectStatus((await run(deps, CONFIG, controller.signal)).response, "failed");
    expect(r.reasons[0]).toContain("취소");
    expect(generate).not.toHaveBeenCalled();
  });

  it("로그 저장 실패가 응답을 막지 않는다", async () => {
    const { deps } = setup({});
    deps.logger = { save: async () => Promise.reject(new Error("db down")) };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await run(deps)).response.status).toBe("passed");
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});


// ── 회귀: Semantic Resolver · 대화 상태 · 정의 준수 검사 ──
const DEFS: StoredDefinition[] = SEED_DEFINITIONS.map((d) => ({ ...d, version: 4 }));
const def = (id: string) => DEFS.find((d) => d.id === id)!;
const PLAN_CONTEXT: RetrievedContext = {
  ...CONTEXT,
  sources: ["analytics.payment_fact"],
  definitions: [def("first_payment_customer_n"), def("plan")],
};
const FIRST_PAYERS = `SELECT p.product_code, p.product_name, COUNT(DISTINCT p.user_key) AS first_payers
  FROM analytics.payment_fact p WHERE p.payment_order = 1 AND p.relative_signup_day BETWEEN 0 AND 30
  GROUP BY p.product_code, p.product_name ORDER BY first_payers DESC`;
const planOk: StructuralResult = { passed: true, errors: [], normalizedSql: FIRST_PAYERS, referencedTables: ["analytics.payment_fact"] };
const planResolution = resolution({
  status: "resolved", requestedMetric: "첫 결제 고객 수", metricIds: ["first_payment_customer_n"], supportIds: ["plan"],
  standaloneQuestion: "요금제별 첫 결제 고객 수 비교", grain: "상품별 첫 결제 고객", period: "가입 후 D+30(정의 기본값)",
});
const planGen = (extra: Partial<GenerationOutput["definition"]> = {}) =>
  gen(FIRST_PAYERS, {
    definition: {
      metricIds: ["first_payment_customer_n"], definitionRefs: [], formula: "COUNT(DISTINCT user_key) WHERE payment_order = 1 AND relative_signup_day 0~30",
      filters: ["payment_order = 1", "relative_signup_day BETWEEN 0 AND 30"], grain: "상품별 첫 결제 고객", unapprovedAssumptions: [], candidateIds: [], ...extra,
    },
  });

describe("회귀 — 지표 판정과 정의 준수", () => {
  it("회귀 1·4: 정의 없음/모호 판정이면 검색·생성 없이 선택지와 함께 되묻는다", async () => {
    const { deps, generate, retrieve } = setup({
      resolution: resolution({
        status: "ambiguous", requestedMetric: "인기",
        options: [{ label: "첫 결제 고객 수 기준(가입 후 D+30)", metricIds: ["first_payment_customer_n"] }],
        clarificationQuestion: "'인기'의 계산 기준이 하나로 정해지지 않았습니다. 어떤 기준으로 계산할까요? 1) 첫 결제 고객 수 기준(가입 후 D+30)",
      }),
    });
    const { events, response } = await run(deps, CONFIG, new AbortController().signal, "가장 인기 있는 요금제는 무엇이야?");
    const r = expectStatus(response, "needs_clarification");
    expect(r.clarificationQuestion).toContain("첫 결제 고객 수 기준");
    expect(r.resolution?.options).toHaveLength(1);
    expect(events.some((e) => e.type === "resolution")).toBe(true);
    expect(retrieve).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
  });

  it("회귀 2: 후속 답변은 이전 대화와 함께 판정되고, 생성은 완결 질문을 쓴다", async () => {
    const history: ConversationTurn[] = [
      { question: "가장 인기 있는 요금제는 무엇이야?", status: "needs_clarification", clarificationQuestion: "어떤 기준으로 계산할까요? 1) 첫 결제 고객 수 기준", resolution: null },
    ];
    const { deps, resolve, generate, retrieve } = setup({
      resolution: { ...planResolution, standaloneQuestion: "첫 결제 고객 수가 가장 많은 요금제", confirmed: ["인기 = 첫 결제 고객 수(사용자 선택)"] },
      context: PLAN_CONTEXT, generations: [planGen()], structural: [planOk],
    });
    const r = expectStatus((await run(deps, CONFIG, new AbortController().signal, "1번 기준으로", history)).response, "passed");
    expect(resolve.mock.calls[0]?.[0].history).toEqual(history);
    expect(genInput(generate, 0).question).toBe("첫 결제 고객 수가 가장 많은 요금제");
    expect(retrieve.mock.calls[0]?.[2]).toEqual(["first_payment_customer_n", "plan"]);
    expect(r.question).toBe("1번 기준으로");
    expect(r.resolution?.confirmed).toEqual(["인기 = 첫 결제 고객 수(사용자 선택)"]);
  });

  it("회귀 5·6: 명확한 지표는 되묻지 않고, 사용한 정의·계산식·필터·단위를 응답에 남긴다", async () => {
    const { deps } = setup({ resolution: planResolution, context: PLAN_CONTEXT, generations: [planGen()], structural: [planOk] });
    const r = expectStatus((await run(deps)).response, "passed");
    expect(r.meta.definition).toMatchObject({
      metricIds: ["first_payment_customer_n"],
      definitionRefs: ["first_payment_customer_n@v4", "plan@v4"],
      grain: "상품별 첫 결제 고객",
      unapprovedAssumptions: [],
    });
    expect(r.meta.definition?.filters).toContain("payment_order = 1");
  });

  it("핵심: 검증 모델이 95점을 줘도 정의 불일치 판정이면 실행하지 않는다", async () => {
    const { deps, execute } = setup({
      resolution: planResolution, context: PLAN_CONTEXT, generations: [planGen()], structural: [planOk],
      verdicts: [verdict(95, { definitionMatch: false })],
    });
    const r = expectStatus((await run(deps)).response, "failed");
    expect(execute).not.toHaveBeenCalled();
    expect(r.attempts[0]?.semantic.status).toBe("failed");
    expect(r.attempts[0]?.semantic.score).toBe(95);
    expect(r.reasons.join(" ")).toContain("공식 정의와 일치하지 않습니다");
  });

  it("검증 모델이 높은 점수와 함께 미승인 가정을 찾으면 통과시키지 않는다", async () => {
    const { deps, execute, generate } = setup({
      resolution: planResolution, context: PLAN_CONTEXT, generations: [planGen()], structural: [planOk],
      verdicts: [verdict(96, { unapprovedAssumptions: ["인기를 첫 결제 건수로 해석"] }), verdict(95)],
    });
    expectStatus((await run(deps)).response, "passed");
    expect(generate).toHaveBeenCalledTimes(2);
    expect(genInput(generate, 1).feedback.join(" ")).toContain("미승인 가정");
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("결정론적 검사: 첫 결제 조건이 빠진 SQL은 검증 모델 호출 전에 차단·재생성한다", async () => {
    const noOrder = "SELECT p.product_code, COUNT(*) AS n FROM analytics.payment_fact p GROUP BY 1";
    const { deps, verify, generate } = setup({
      resolution: planResolution, context: PLAN_CONTEXT,
      generations: [gen(noOrder, { definition: planGen().definition }), planGen()],
      structural: [{ passed: true, errors: [], normalizedSql: noOrder, referencedTables: ["analytics.payment_fact"] }, planOk],
    });
    const r = expectStatus((await run(deps)).response, "passed");
    expect(r.attempts[0]?.semantic.errors.join(" ")).toContain("payment_order = 1");
    expect(verify).toHaveBeenCalledTimes(1);
    expect(genInput(generate, 1).feedback.join(" ")).toContain("[정의 검사]");
  });

  it("생성 모델이 밝힌 미승인 가정은 재생성하지 않고 사용자에게 확인한다", async () => {
    const { deps, verify, execute } = setup({
      resolution: planResolution, context: PLAN_CONTEXT,
      generations: [planGen({ unapprovedAssumptions: ["'광고형'을 package_type_id 3번째 자리로 판단"] })], structural: [planOk],
    });
    const r = expectStatus((await run(deps)).response, "needs_clarification");
    expect(r.clarificationQuestion).toContain("package_type_id");
    expect(verify).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it("지표 판정 실패(모델 오류)는 판정 없이 SQL을 만들지 않는다", async () => {
    const { deps, generate } = setup({});
    deps.resolver = { resolve: async () => Promise.reject(new StageError("upstream", "모델 서버 오류", false)) };
    const r = expectStatus((await run(deps)).response, "failed");
    expect(r.message).toContain("지표를 판정하지 못했습니다");
    expect(generate).not.toHaveBeenCalled();
  });
});

describe("정의 문제와 기술 오류 구분", () => {
  it("정의 없음 판정은 definition_missing으로 보류된다", async () => {
    const { deps } = setup({ resolution: resolution({ status: "undefined", requestedMetric: "이탈률", clarificationQuestion: "'이탈률' 정의 없음" }) });
    const r = expectStatus((await run(deps)).response, "needs_clarification");
    expect(r.issueType).toBe("definition_missing");
    expect(r.missingDefinitions).toEqual(["이탈률"]);
  });

  it("데이터 범위 밖 기간은 data_unavailable", async () => {
    const { deps } = setup({ resolution: resolution({ status: "unavailable", reason: "범위 밖", clarificationQuestion: "범위 밖" }) });
    expect(expectStatus((await run(deps)).response, "needs_clarification").issueType).toBe("data_unavailable");
  });

  it("SQL 구조 오류 반복은 sql_error (정의 문제가 아님)", async () => {
    const { deps } = setup({ structural: [bad("컬럼 x가 존재하지 않습니다."), bad("컬럼 x가 존재하지 않습니다.")] });
    expect(expectStatus((await run(deps)).response, "failed").issueType).toBe("sql_error");
  });

  it("검증 모델의 정의 불일치 반복은 definition_conflict", async () => {
    const { deps } = setup({
      resolution: planResolution, context: PLAN_CONTEXT, generations: [planGen()], structural: [planOk],
      verdicts: [verdict(95, { definitionMatch: false })],
    });
    expect(expectStatus((await run(deps)).response, "failed").issueType).toBe("definition_conflict");
  });

  it("후보 정의를 쓴 결과는 응답·로그에 후보임이 남는다", async () => {
    const { deps, logger } = setup({
      resolution: { ...planResolution, supportIds: ["plan", "plan_ad_tier"], candidateIds: ["plan_ad_tier"] },
      context: { ...PLAN_CONTEXT, definitions: [...PLAN_CONTEXT.definitions!, def("plan_ad_tier")] },
      generations: [planGen()], structural: [planOk],
    });
    const r = expectStatus((await run(deps)).response, "passed");
    expect(r.meta.definition?.candidateIds).toEqual(["plan_ad_tier"]);
    expect(r.meta.definition?.definitionRefs).toContain("plan_ad_tier@v4");
    expect(logger.logs[0]?.resolution?.candidateIds).toEqual(["plan_ad_tier"]);
  });
});
