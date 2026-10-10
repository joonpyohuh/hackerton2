/**
 * MOCK — UI 개발 전용. 실제 데이터셋·스키마와 무관한 가상 상점 테이블(mock_*)을 사용한다.
 * 여기의 숫자는 분석 결과가 아니며, 화면에도 isMock=true로 표시된다.
 */
import type { AgentEvent, AgentResponse, Attempt, CheckResult, Resolution, RunningStage } from "@/lib/agent/contract";

export type MockScenario = "success_after_retry" | "clarification" | "repeated_error" | "unsupported_question";

export function pickScenario(question: string): MockScenario {
  if (/유지율|이탈률|전환율/.test(question)) return "clarification";
  if (/삭제|drop|delete|update|truncate/i.test(question)) return "repeated_error";
  if (/지난달/.test(question) && /지역별/.test(question) && /주문/.test(question) && /금액|매출/.test(question)) {
    return "success_after_retry";
  }
  return "unsupported_question";
}

export const MOCK_EXAMPLES: { question: string; scenario: MockScenario }[] = [
  { question: "지난달 지역별 주문 금액 합계를 알려줘", scenario: "success_after_retry" },
  { question: "지난달 유지율을 알려줘", scenario: "clarification" },
  { question: "주문 테이블을 삭제해줘", scenario: "repeated_error" },
];

type Options = { delayMs?: number; signal?: AbortSignal };

const check = (status: CheckResult["status"], errors: string[] = [], score: number | null = null, durationMs = 0): CheckResult => ({
  status,
  errors,
  score,
  durationMs,
});
const SKIPPED = check("skipped");

const SQL_V1 = `SELECT r.region_name, SUM(o.amount) AS total_amount
FROM mock_orders o
JOIN mock_regions r ON r.region_id = o.region_id
GROUP BY r.region_name
ORDER BY total_amount DESC
LIMIT 1000`;

const SQL_V2 = `SELECT r.region_name, SUM(o.amount) AS total_amount
FROM mock_orders o
JOIN mock_regions r ON r.region_id = o.region_id
WHERE o.ordered_at >= date_trunc('month', current_date) - interval '1 month'
  AND o.ordered_at <  date_trunc('month', current_date)
GROUP BY r.region_name
ORDER BY total_amount DESC
LIMIT 1000`;

const SQL_BLOCKED = "DELETE FROM mock_orders";

export async function* runMockAgent(question: string, options: Options = {}): AsyncGenerator<AgentEvent> {
  const { delayMs = 450, signal } = options;
  const startedAt = Date.now();
  const requestId = `mock_${startedAt.toString(36)}`;
  const wait = () =>
    new Promise<void>((resolve, reject) => {
      if (signal?.aborted) return reject(new Error("aborted"));
      setTimeout(resolve, delayMs);
    });
  const stage = (s: RunningStage, attempt: number): AgentEvent => ({ type: "stage", stage: s, attempt });
  const base = () => ({ requestId, question, isMock: true, durationMs: Date.now() - startedAt });

  const scenario = pickScenario(question);
  yield stage("resolving", 0);
  await wait();

  if (scenario === "clarification") {
    // 실제 파이프라인과 같은 경로: 지표 판정 단계에서 정의 없음 → 계산 가능한 가상 선택지 제시
    const resolution: Resolution = {
      status: "undefined",
      standaloneQuestion: question,
      requestedMetric: "유지율",
      metricIds: [],
      supportIds: [],
      filters: [],
      period: null,
      grain: null,
      relations: [],
      unspecified: [],
      confirmed: [],
      assumptions: [],
      options: [
        { label: "가상 28일 재주문율", metricIds: ["mock_reorder_28"] },
        { label: "가상 첫 주문 후 활성률", metricIds: ["mock_active_7"] },
      ],
      reason: "‘유지율’은 Mock 정의 목록에 없어 임의로 계산하지 않습니다.",
      concepts: [{ phrase: "유지율", role: "metric", ids: [] }],
      candidateIds: [],
      clarificationQuestion:
        "‘유지율’은 Mock 정의 목록에 없어 임의로 계산하지 않습니다. 공식 정의로 계산할 수 있는 기준: 1) 가상 28일 재주문율 2) 가상 첫 주문 후 활성률",
    };
    yield { type: "resolution", resolution };
    const response: AgentResponse = {
      status: "needs_clarification",
      ...base(),
      attempts: [],
      resolution,
      clarificationQuestion: resolution.clarificationQuestion!,
      missingDefinitions: ["유지율"],
    };
    yield { type: "final", response };
    return;
  }

  yield stage("retrieving", 0);
  await wait();

  if (scenario === "unsupported_question") {
    yield {
      type: "final",
      response: {
        status: "failed",
        ...base(),
        attempts: [],
        message: "Mock 모드에서는 이 질문에 답할 수 없습니다.",
        reasons: ["Mock 데이터에는 지난달 지역별 주문 금액만 있고 프로그램 인기 데이터는 없습니다. 실제 데이터 조회나 SQL 검증은 실행하지 않았습니다."],
      },
    };
    return;
  }

  if (scenario === "repeated_error") {
    const attempts: Attempt[] = [];
    const error = "DELETE 구문은 허용되지 않습니다. 조회(SELECT)만 실행할 수 있습니다.";
    for (let i = 0; i < 2; i++) {
      if (i > 0) yield stage("correcting", i);
      yield stage("generating", i);
      await wait();
      yield stage("structural", i);
      await wait();
      const attempt: Attempt = {
        index: i,
        sql: SQL_BLOCKED,
        structural: check("failed", [error], null, 3),
        semantic: SKIPPED,
        execution: SKIPPED,
        feedback: [error],
      };
      attempts.push(attempt);
      yield { type: "attempt", attempt };
    }
    yield {
      type: "final",
      response: {
        status: "failed",
        ...base(),
        attempts,
        message: "요청한 작업을 안전하게 수행할 수 없습니다.",
        reasons: ["동일한 구조 검증 오류가 2회 반복되어 조기 종료했습니다.", error],
      },
    };
    return;
  }

  // success_after_retry
  yield stage("generating", 0);
  await wait();
  yield stage("structural", 0);
  await wait();
  yield stage("semantic", 0);
  await wait();
  const first: Attempt = {
    index: 0,
    sql: SQL_V1,
    structural: check("passed", [], null, 4),
    semantic: check("failed", ["질문의 ‘지난달’ 기간 조건이 SQL에 없습니다."], 72, 1840),
    execution: SKIPPED,
    feedback: ["ordered_at 기준으로 지난달 1일~말일 필터를 추가하세요."],
  };
  yield { type: "attempt", attempt: first };

  yield stage("correcting", 1);
  await wait();
  yield stage("generating", 1);
  await wait();
  yield stage("structural", 1);
  await wait();
  yield stage("semantic", 1);
  await wait();
  yield stage("executing", 1);
  await wait();
  const second: Attempt = {
    index: 1,
    sql: SQL_V2,
    structural: check("passed", [], null, 5),
    semantic: check("passed", [], 94, 1712),
    execution: check("passed", [], null, 38),
    feedback: [],
  };
  yield { type: "attempt", attempt: second };

  yield {
    type: "final",
    response: {
      status: "passed",
      ...base(),
      attempts: [first, second],
      answer: "가상 상점 데이터 기준, 지난달 주문 금액이 가장 큰 지역은 북부입니다.",
      sql: SQL_V2,
      table: {
        columns: [
          { key: "region_name", label: "지역", kind: "text" },
          { key: "total_amount", label: "주문 금액 합계(원)", kind: "number" },
        ],
        rows: [
          { region_name: "북부", total_amount: 4_820_000 },
          { region_name: "중부", total_amount: 3_915_500 },
          { region_name: "남부", total_amount: 2_740_000 },
          { region_name: "서부", total_amount: 1_088_200 },
        ],
        rowCount: 4,
        truncated: false,
      },
      meta: {
        metrics: ["주문 금액 합계 (Mock 정의)"],
        period: "지난달 (실행일 기준)",
        sources: ["mock_orders", "mock_regions"],
        assumptions: [],
        semanticScore: 94,
        groundTruth: "unverified",
      },
    },
  };
}
