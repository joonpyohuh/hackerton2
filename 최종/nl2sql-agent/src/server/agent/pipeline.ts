import type { AgentEvent, AgentResponse, Attempt, CheckResult, RunningStage } from "@/lib/agent/contract";
import { runStage, toStageError } from "./errors";
import { createRepeatTracker } from "./repeatTracker";
import type {
  ExecutionOutput,
  GenerationOutput,
  LlmUsage,
  PipelineConfig,
  PipelineDeps,
  RetrievedContext,
  RunLog,
  SemanticVerdict,
} from "./types";

const SKIPPED: CheckResult = { status: "skipped", errors: [], score: null, durationMs: 0 };
const check = (passed: boolean, errors: string[], durationMs: number, score: number | null = null): CheckResult => ({
  status: passed ? "passed" : "failed",
  errors: passed ? [] : errors,
  score,
  durationMs,
});

type Outcome =
  | { kind: "passed"; attempt: Attempt; sql: string; execution: ExecutionOutput; verdict: SemanticVerdict; generation: GenerationOutput }
  | { kind: "retry"; attempt: Attempt; feedback: string[] }
  | { kind: "clarify"; attempt: Attempt | null; question: string; missing: string[] }
  | { kind: "fatal"; attempt: Attempt | null; message: string; reasons: string[] };

const errorsOf = (a: Attempt) => [...a.structural.errors, ...a.semantic.errors, ...a.execution.errors];

/**
 * Harness Verification Loop.
 * 생성 → 1차 구조 검사 → 2차 의미 검증 → 3차 실행. 어느 단계든 실패하면 오류를 피드백으로 재생성한다.
 * 의미 검증 통과는 "정답"이 아니다 — 런타임 결과의 groundTruth는 항상 unverified.
 */
export async function* runAgentPipeline(
  question: string,
  deps: PipelineDeps,
  config: PipelineConfig,
  signal: AbortSignal,
): AsyncGenerator<AgentEvent> {
  const now = deps.now ?? Date.now;
  const startedAt = now();
  const requestId = deps.newId?.() ?? crypto.randomUUID();
  const attempts: Attempt[] = [];
  const usage: LlmUsage[] = [];
  let context: RetrievedContext | null = null;

  const stage = (s: RunningStage, attempt: number): AgentEvent => ({ type: "stage", stage: s, attempt });
  const base = () => ({ requestId, question, attempts: [...attempts], isMock: false, durationMs: now() - startedAt });

  /** 시도 1회. 이벤트를 내보내고 결과를 반환한다. */
  async function* attemptOnce(i: number, feedback: string[], ctx: RetrievedContext): AsyncGenerator<AgentEvent, Outcome> {
    const attempt = (sql: string | null, s: CheckResult, m: CheckResult, e: CheckResult, fb: string[]): Attempt => ({
      index: i,
      sql,
      structural: s,
      semantic: m,
      execution: e,
      feedback: fb,
    });

    // 생성
    yield stage("generating", i);
    let gen;
    try {
      gen = await runStage((s) => deps.generator.generate({ question, context: ctx, feedback, attempt: i }, s), signal, config.llmTimeoutMs);
    } catch (e) {
      const err = toStageError(e, "SQL 생성 모델 호출에 실패했습니다.");
      if (!err.retryable) return { kind: "fatal", attempt: null, message: "SQL을 생성할 수 없습니다.", reasons: [err.message] };
      const msg = `SQL 생성 실패: ${err.message}`;
      return { kind: "retry", attempt: attempt(null, check(false, [msg], 0), SKIPPED, SKIPPED, []), feedback: [] };
    }
    usage.push(gen.usage);
    if (gen.needsClarification) {
      return {
        kind: "clarify",
        attempt: null,
        question: gen.clarificationQuestion ?? "질문의 기준(지표·기간·대상)을 조금 더 구체적으로 알려 주세요.",
        missing: [],
      };
    }
    if (!gen.sql?.trim()) {
      const msg = "SQL이 생성되지 않았습니다.";
      return { kind: "retry", attempt: attempt(null, check(false, [msg], 0), SKIPPED, SKIPPED, [msg]), feedback: [msg] };
    }

    // 1차: 구조·보안 검사 (결정론적 — 예외는 버그이므로 재시도하지 않는다)
    yield stage("structural", i);
    let t = now();
    let structural;
    try {
      structural = await deps.structural.validate(gen.sql);
    } catch (e) {
      return { kind: "fatal", attempt: null, message: "구조 검사기를 실행할 수 없습니다.", reasons: [toStageError(e, "구조 검사기 오류").message] };
    }
    const sCheck = check(structural.passed, structural.errors, now() - t);
    if (!structural.passed || !structural.normalizedSql) {
      const errors = structural.errors.length ? structural.errors : ["구조 검사를 통과하지 못했습니다."];
      return { kind: "retry", attempt: attempt(gen.sql, { ...sCheck, status: "failed", errors }, SKIPPED, SKIPPED, errors), feedback: errors };
    }
    const sql = structural.normalizedSql;

    // 2차: 의미 검증
    yield stage("semantic", i);
    t = now();
    let verdict: SemanticVerdict;
    try {
      verdict = await runStage((s) => deps.verifier.verify({ question, sql, context: ctx }, s), signal, config.llmTimeoutMs);
    } catch (e) {
      const err = toStageError(e, "의미 검증 모델 호출에 실패했습니다.");
      if (!err.retryable) return { kind: "fatal", attempt: attempt(sql, sCheck, check(false, [err.message], now() - t), SKIPPED, []), message: "의미 검증을 수행할 수 없습니다.", reasons: [err.message] };
      // 검증기 문제(형식 오류·타임아웃)는 SQL 탓이 아니므로 생성 피드백에 넣지 않는다.
      const mCheck = check(false, [`의미 검증 실패: ${err.message}`], now() - t);
      return { kind: "retry", attempt: attempt(sql, sCheck, mCheck, SKIPPED, []), feedback };
    }
    usage.push(verdict.usage);
    const elapsed = now() - t;
    if (verdict.needsClarification || verdict.missingDefinitions.length > 0) {
      const missing = verdict.missingDefinitions;
      const errors = verdict.errors.length ? verdict.errors : ["필요한 업무 정의가 없습니다."];
      return {
        kind: "clarify",
        attempt: attempt(sql, sCheck, check(false, errors, elapsed, verdict.score), SKIPPED, []),
        question: missing.length ? `다음 정의를 알려 주세요: ${missing.join(", ")}` : "질문의 기준을 조금 더 구체적으로 알려 주세요.",
        missing,
      };
    }
    const semanticPassed = verdict.passed && verdict.score >= config.semanticScoreThreshold;
    const semanticErrors = verdict.errors.length
      ? verdict.errors
      : [`의미 검증 점수 ${verdict.score}점이 기준(${config.semanticScoreThreshold}점)보다 낮습니다.`];
    const mCheck = check(semanticPassed, semanticErrors, elapsed, verdict.score);
    if (!semanticPassed) {
      const fb = [...semanticErrors, ...verdict.suggestions];
      return { kind: "retry", attempt: attempt(sql, sCheck, mCheck, SKIPPED, fb), feedback: fb };
    }

    // 3차: 읽기 전용 실행
    yield stage("executing", i);
    t = now();
    let execution: ExecutionOutput;
    try {
      execution = await runStage((s) => deps.executor.execute(sql, s), signal, config.executionTimeoutMs);
    } catch (e) {
      const err = toStageError(e, "SQL 실행 중 알 수 없는 오류가 발생했습니다.");
      const eCheck = check(false, [err.message], now() - t);
      if (!err.retryable) return { kind: "fatal", attempt: attempt(sql, sCheck, mCheck, eCheck, []), message: "SQL을 실행할 수 없습니다.", reasons: [err.message] };
      const fb = [`실행 오류: ${err.message}`];
      return { kind: "retry", attempt: attempt(sql, sCheck, mCheck, eCheck, fb), feedback: fb };
    }
    // 0건은 실패가 아니다. 정상 실행이 의미적 정답을 보장하지도 않는다.
    return { kind: "passed", attempt: attempt(sql, sCheck, mCheck, check(true, [], now() - t), []), sql, execution, verdict, generation: gen };
  }

  async function finalize(response: AgentResponse, reasons: string[]): Promise<AgentEvent> {
    const log: RunLog = {
      requestId,
      question,
      startedAt: new Date(startedAt).toISOString(),
      durationMs: response.durationMs,
      finalStatus: response.status,
      knowledgeStatus: response.status === "passed" ? "MODEL_VERIFIED" : response.status === "failed" ? "REJECTED" : null,
      contextSources: context?.sources ?? [],
      definitionVersion: context?.definitionVersion ?? null,
      initialSql: attempts.find((a) => a.sql)?.sql ?? null,
      finalSql: response.status === "passed" ? response.sql : null,
      attempts: response.attempts,
      failureReasons: reasons,
      usage,
      models: config.models,
    };
    try {
      await deps.logger.save(log);
    } catch (e) {
      // 로그 저장 실패가 사용자 응답을 막지는 않되, 서버 로그에는 반드시 남긴다.
      console.error("[agent] 실행 로그 저장 실패", requestId, e);
    }
    return { type: "final", response };
  }

  const fail = (message: string, reasons: string[]) =>
    finalize({ status: "failed", ...base(), message, reasons }, reasons);

  try {
    yield stage("retrieving", 0);
    try {
      context = await runStage((s) => deps.retriever.retrieve(question, s), signal, config.llmTimeoutMs);
    } catch (e) {
      const err = toStageError(e, "질문 맥락을 검색할 수 없습니다.");
      yield await fail("질문에 필요한 정의를 불러오지 못했습니다.", [err.message]);
      return;
    }
    const ctx = context;
    if (ctx.isAmbiguous) {
      yield await finalize(
        {
          status: "needs_clarification",
          ...base(),
          clarificationQuestion: ctx.clarificationQuestion ?? "질문의 기준을 조금 더 구체적으로 알려 주세요.",
          missingDefinitions: ctx.missingDefinitions,
        },
        [],
      );
      return;
    }

    const repeated = createRepeatTracker(config.repeatedErrorLimit);
    let feedback: string[] = [];
    for (let i = 0; i <= config.maxRetries; i++) {
      if (i > 0) yield stage("correcting", i);
      const outcome = yield* attemptOnce(i, feedback, ctx);
      if (outcome.attempt) {
        attempts.push(outcome.attempt);
        yield { type: "attempt", attempt: outcome.attempt };
      }

      switch (outcome.kind) {
        case "passed": {
          let formatted;
          try {
            formatted = await runStage(
              (s) => deps.formatter.format({ question, sql: outcome.sql, context: ctx, execution: outcome.execution, generation: outcome.generation }, s),
              signal,
              config.llmTimeoutMs,
            );
          } catch (e) {
            const err = toStageError(e, "결과 설명을 생성하지 못했습니다.");
            yield await fail("검증된 결과의 설명을 만들지 못했습니다.", [err.message]);
            return;
          }
          if (formatted.usage) usage.push(formatted.usage);
          yield await finalize(
            {
              status: "passed",
              ...base(),
              answer: formatted.answer,
              sql: outcome.sql,
              table: formatted.table,
              meta: {
                metrics: formatted.metrics,
                period: formatted.period,
                sources: ctx.sources,
                assumptions: formatted.assumptions,
                semanticScore: outcome.verdict.score,
                groundTruth: "unverified",
              },
            },
            [],
          );
          return;
        }
        case "clarify":
          yield await finalize(
            { status: "needs_clarification", ...base(), clarificationQuestion: outcome.question, missingDefinitions: outcome.missing },
            [],
          );
          return;
        case "fatal":
          yield await fail(outcome.message, outcome.reasons);
          return;
        case "retry": {
          const errors = errorsOf(outcome.attempt);
          if (repeated.record(errors)) {
            yield await fail("요청한 분석을 안전하게 완료하지 못했습니다.", [
              `동일한 오류가 ${config.repeatedErrorLimit}회 연속 발생해 조기 종료했습니다.`,
              ...errors,
            ]);
            return;
          }
          if (outcome.feedback.length) feedback = outcome.feedback;
          break;
        }
      }
    }

    const lastErrors = attempts.length ? errorsOf(attempts[attempts.length - 1]) : [];
    yield await fail("요청한 분석을 안전하게 완료하지 못했습니다.", [
      `최대 재시도 횟수(${config.maxRetries}회)를 초과했습니다.`,
      ...lastErrors,
    ]);
  } catch (e) {
    const err = toStageError(e, "에이전트 실행 중 예기치 않은 오류가 발생했습니다.");
    yield await fail(err.kind === "aborted" ? "요청이 취소되었습니다." : "에이전트 실행 중 오류가 발생했습니다.", [err.message]);
  }
}
