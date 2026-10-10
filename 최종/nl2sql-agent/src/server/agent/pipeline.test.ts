import { describe, expect, it, vi } from "vitest";
import { agentEventSchema, type AgentEvent, type AgentResponse } from "@/lib/agent/contract";
import { StageError } from "./errors";
import { InMemoryRunLogger } from "./logger";
import { runAgentPipeline } from "./pipeline";
import type {
  ExecutionOutput,
  GenerationInput,
  GenerationOutput,
  PipelineConfig,
  PipelineDeps,
  RetrievedContext,
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
  usage: usage("verification"),
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
  const deps: PipelineDeps = {
    retriever: { retrieve: async () => over.context ?? CONTEXT },
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
  return { deps, logger, generate, validate, verify, execute };
}

async function run(deps: PipelineDeps, config = CONFIG, signal = new AbortController().signal) {
  const events: AgentEvent[] = [];
  for await (const e of runAgentPipeline("질문", deps, config, signal)) events.push(e);
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
