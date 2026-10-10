import { describe, expect, it, vi } from "vitest";
import type { ConversationTurn } from "@/lib/agent/contract";
import type { ChatClient } from "@/server/llm/chat";
import { SEED_DEFINITIONS, definitionSchema } from "./definitions";
import { checkDateRange, createSemanticResolver, finalizeResolution, renderCatalog, renderHistory, resolverResponseSchema } from "./resolver";

const definitions = SEED_DEFINITIONS.map((d) => ({ ...definitionSchema.parse(d), version: 1 }));
const raw = (over: Record<string, unknown>) => resolverResponseSchema.parse({ status: "resolved", ...over });
const signal = new AbortController().signal;

describe("finalizeResolution — LLM 제안을 Semantic Layer로 다시 판정", () => {
  it("카탈로그에 없는 지표 ID로 resolved를 주장하면 정의 없음으로 바꾼다 (임의 지표 차단)", () => {
    const r = finalizeResolution(
      raw({ requestedMetric: "30일 유지율", metricIds: ["retention_30d"], options: [{ label: "D+22~28 시청 유지율", metricIds: ["watch_retention_22_28"] }] }),
      definitions,
      "30일 유지율",
    );
    expect(r.status).toBe("undefined");
    expect(r.metricIds).toEqual([]);
    expect(r.options.map((o) => o.metricIds)).toEqual([["watch_retention_22_28"]]);
    expect(r.clarificationQuestion).toContain("30일 유지율");
    expect(r.clarificationQuestion).toContain("D+22~28 시청 유지율");
  });

  it("지표가 필요한데 공식 ID가 하나도 없으면 resolved라도 계산하지 않는다", () => {
    const r = finalizeResolution(raw({ requestedMetric: "고객 유지율", needsMetric: true, metricIds: [] }), definitions, "q");
    expect(r.status).toBe("undefined");
    expect(r.clarificationQuestion).toContain("고객 유지율");
  });

  it("모호한 표현은 실제로 계산 가능한 선택지만 남긴다", () => {
    const r = finalizeResolution(
      raw({
        status: "ambiguous",
        requestedMetric: "인기",
        options: [
          { label: "첫 결제 고객 수 기준", metricIds: ["first_payment_customer_n"] },
          { label: "결제 금액 기준", metricIds: ["revenue_total"] },
          { label: "캠페인 반응률 기준", metricIds: ["campaign_response_rate"] },
        ],
      }),
      definitions,
      "가장 인기 있는 요금제는?",
    );
    expect(r.status).toBe("ambiguous");
    expect(r.options).toEqual([{ label: "첫 결제 고객 수 기준", metricIds: ["first_payment_customer_n"] }]);
    expect(r.clarificationQuestion).toContain("어떤 기준으로 계산할까요?");
  });

  it("모호하지만 계산 가능한 선택지가 하나도 없으면 정의 없음", () => {
    const r = finalizeResolution(raw({ status: "ambiguous", requestedMetric: "충성도", options: [{ label: "x", metricIds: ["nope"] }] }), definitions, "q");
    expect(r.status).toBe("undefined");
    expect(r.options).toEqual([]);
  });

  it("승인되지 않은 가정이 있으면 resolved여도 사용자 확인으로 돌린다", () => {
    const r = finalizeResolution(
      raw({ metricIds: ["first_payment_customer_n"], assumptions: ["'프리미엄급'을 4인 동시 시청 상품으로 간주"] }),
      definitions,
      "q",
    );
    expect(r.status).toBe("ambiguous");
    expect(r.clarificationQuestion).toContain("프리미엄급");
  });

  it("상대 기간이 데이터 범위 밖이면 계산 불가 — 지난달(2026-09) 가입", () => {
    const r = finalizeResolution(
      raw({ metricIds: ["payment_conversion_30"], dateRange: { column: "signup_date", start: "2026-09-01", end: "2026-09-30" } }),
      definitions,
      "지난달 가입 고객의 전환율",
    );
    expect(r.status).toBe("unavailable");
    expect(r.reason).toContain("2025-02-01~2025-04-01");
  });

  it("범위가 일부만 겹치면 계산하되 실제 집계 범위를 알린다", () => {
    const r = finalizeResolution(
      raw({ metricIds: ["payment_conversion_30"], dateRange: { column: "signup_date", start: "2025-03-01", end: "2025-05-31" } }),
      definitions,
      "q",
    );
    expect(r.status).toBe("resolved");
    expect(r.unspecified.join(" ")).toContain("2025-02-01~2025-04-01");
  });

  it("원천 데이터가 없는 정의(needs_data)는 계산 불가", () => {
    const r = finalizeResolution(raw({ metricIds: ["campaign_response_rate"] }), definitions, "캠페인 반응률");
    expect(r.status).toBe("unavailable");
    expect(r.reason).toContain("캠페인 반응률");
  });

  it("명확한 지표는 되묻지 않는다 — 요금제별 첫 결제 고객 수", () => {
    const r = finalizeResolution(
      raw({ requestedMetric: "첫 결제 고객 수", metricIds: ["first_payment_customer_n"], supportIds: ["plan", "unknown_dim"] }),
      definitions,
      "요금제별 첫 결제 고객 수",
    );
    expect(r.status).toBe("resolved");
    expect(r.metricIds).toEqual(["first_payment_customer_n"]);
    expect(r.supportIds).toEqual(["plan"]);
    expect(r.clarificationQuestion).toBeNull();
  });

  it("날짜 범위 판정", () => {
    expect(checkDateRange({ column: "payment_date", start: "2025-06-01", end: "2025-06-28" }).kind).toBe("ok");
    expect(checkDateRange({ column: "watch_date", start: "2025-06-01", end: "2025-06-30" }).kind).toBe("outside");
    expect(checkDateRange({ column: "unknown", start: "x", end: "y" }).kind).toBe("ok");
  });
});

describe("대화 상태와 프롬프트", () => {
  const prev: ConversationTurn = {
    question: "광고형 요금제의 고객 유지율은 얼마야?",
    status: "needs_clarification",
    clarificationQuestion: "'고객 유지율'은 공식 정의가 없습니다. 공식 정의로 계산할 수 있는 기준: 1) D+22~28 시청 유지율",
    resolution: finalizeResolution(
      raw({
        status: "undefined",
        requestedMetric: "고객 유지율",
        filters: ["payment_fact.product_name LIKE '%광고형%'"],
        options: [{ label: "D+22~28 시청 유지율", metricIds: ["watch_retention_22_28"] }],
      }),
      definitions,
      "광고형 요금제의 고객 유지율은 얼마야?",
    ),
  };

  it("이전 질문·시스템 질문·필터·선택지를 이력에 남긴다", () => {
    const text = renderHistory([prev]);
    expect(text).toContain("광고형 요금제의 고객 유지율");
    expect(text).toContain("product_name LIKE '%광고형%'");
    expect(text).toContain("watch_retention_22_28");
  });

  it("카탈로그에는 지표·차원·용어만 넣고 컬럼 사전은 뺀다", () => {
    const catalog = renderCatalog(definitions);
    expect(catalog).toContain("[metric/공식] watch_retention_22_28");
    expect(catalog).toContain("[metric/후보(비공식)] repurchase_rate");
    expect(catalog).not.toContain("col_payment_fact_payment_order");
  });

  it("후속 답변은 이력과 함께 판정 모델에 전달되고, 결과는 다시 검증된다", async () => {
    const chat = vi.fn<ChatClient>(async () => ({
      content: JSON.stringify({
        status: "resolved",
        standaloneQuestion: "광고형 요금제 고객의 30일 유지율",
        requestedMetric: "30일 유지율",
        metricIds: ["retention_30d"],
      }),
      inputTokens: 1,
      outputTokens: 1,
    }));
    const resolver = createSemanticResolver({
      chat,
      model: "m",
      listDefinitions: async () => definitions,
      valueHints: async () => "- pk_3512: 광고형 스탠다드",
      today: () => "2026-10-10",
      loadTemplate: async () => "{{today}}|{{history}}|{{question}}|{{catalog}}|{{coverage}}|{{value_hints}}",
    });
    const { resolution } = await resolver.resolve({ question: "30일 기준으로 계산해줘.", history: [prev] }, signal);
    const prompt = chat.mock.calls[0]?.[0].user ?? "";
    expect(prompt).toContain("광고형 요금제의 고객 유지율은 얼마야?");
    expect(prompt).toContain("2026-10-10");
    expect(resolution.standaloneQuestion).toBe("광고형 요금제 고객의 30일 유지율");
    expect(resolution.status).toBe("undefined"); // 정의 없는 30일 유지율을 만들지 않는다
  });

  it("판정 모델의 잘못된 JSON은 재시도 가능 오류", async () => {
    const resolver = createSemanticResolver({
      chat: async () => ({ content: "not json", inputTokens: 0, outputTokens: 0 }),
      model: "m",
      listDefinitions: async () => definitions,
      valueHints: async () => "",
      loadTemplate: async () => "{{question}}",
    });
    await expect(resolver.resolve({ question: "q", history: [] }, signal)).rejects.toMatchObject({ kind: "invalid_response", retryable: true });
  });
});
