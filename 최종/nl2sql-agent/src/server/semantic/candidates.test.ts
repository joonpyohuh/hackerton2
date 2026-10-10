import { describe, expect, it } from "vitest";
import { checkDefinitionCompliance } from "@/server/harness/definitionCheck";
import { SEED_DEFINITIONS, definitionSchema } from "./definitions";
import { finalizeResolution, relativeRange, resolverResponseSchema } from "./resolver";
import { matchConcept, matchDefinitions } from "./search";

const definitions = SEED_DEFINITIONS.map((d) => ({ ...definitionSchema.parse(d), version: 1 }));
const byId = new Map(definitions.map((d) => [d.id, d]));
const raw = (over: Record<string, unknown>) => resolverResponseSchema.parse({ status: "resolved", ...over });
const FAILING_QUESTION = "광고형 요금제와 비광고형 요금제의 유지율을 비교해줘.";

describe("정의 근거 — 공식과 후보 구분", () => {
  it("문제 PDF의 지표는 공식, 데이터로 제안한 지표는 후보다", () => {
    expect(byId.get("watch_retention_22_28")?.authority).toBe("official");
    expect(byId.get("first_payment_customer_n")?.authority).toBe("official");
    for (const id of ["repurchase_rate", "subscription_hold_rate_n", "plan_tier_switch_rate", "payment_count", "plan_ad_tier"]) {
      expect(byId.get(id)?.authority).toBe("candidate");
    }
  });

  it("모든 정의에 출처가 있고, 출처 미기재 정의는 공식이 아니다", () => {
    for (const d of definitions) {
      expect(d.source.length).toBeGreaterThan(0);
      if (d.source === "출처 미기재") expect(d.authority).toBe("candidate");
    }
    expect(definitions.filter((d) => d.source === "출처 미기재")).toEqual([]);
  });

  it("출처 필드가 없는 기존 DB 행은 후보로 읽는다 (fail-safe)", () => {
    const legacy = { ...SEED_DEFINITIONS[0] } as Record<string, unknown>;
    delete legacy.authority;
    delete legacy.source;
    expect(definitionSchema.parse(legacy).authority).toBe("candidate");
  });
});

describe("원인 재현 — '요금제'만 검색되던 질문", () => {
  it("표현 일치 검색에서도 유지율 공식 정의가 함께 검색된다 (이전에는 plan만 검색)", () => {
    const ids = matchDefinitions(FAILING_QUESTION, definitions).map((m) => m.id);
    expect(ids).toContain("watch_retention_22_28");
    expect(ids).toContain("plan_ad_tier");
  });

  it("개념별 동의어 검색: 정확히 같은 단어가 아니어도 찾는다", () => {
    expect(matchConcept("유지율", definitions)[0]?.id).toBe("watch_retention_22_28");
    expect(matchConcept("광고형 요금제", definitions)[0]?.id).toBe("plan_ad_tier");
    expect(matchConcept("재구매율", definitions)[0]?.id).toBe("repurchase_rate");
    expect(matchConcept("리텐션", definitions)[0]?.id).toBe("watch_retention_22_28");
  });
});

describe("처리 정책 A~E (결정론적 재판정)", () => {
  it("A: 공식 정의가 있으면 대안 후보가 있어도 되묻지 않는다", () => {
    const r = finalizeResolution(
      raw({
        requestedMetric: "유지율",
        metricIds: ["watch_retention_22_28"],
        supportIds: ["plan_ad_tier"],
        concepts: [
          { phrase: "광고형 요금제", role: "dimension", ids: ["plan_ad_tier"] },
          { phrase: "유지율", role: "metric", ids: ["watch_retention_22_28"] },
        ],
        options: [{ label: "재결제율(후보)", metricIds: ["repurchase_rate"] }],
      }),
      definitions,
      FAILING_QUESTION,
    );
    expect(r.status).toBe("resolved");
    expect(r.candidateIds).toEqual(["plan_ad_tier"]);
    expect(r.clarificationQuestion).toBeNull();
  });

  it("B: 후보 지표인데 다른 계산 방식이 있고 기준을 말하지 않았으면 선택지를 묻는다", () => {
    const r = finalizeResolution(
      raw({
        requestedMetric: "고객 유지율",
        metricIds: ["repurchase_rate"],
        options: [
          { label: "다음 결제 주기 재결제 기준", metricIds: ["repurchase_rate"] },
          { label: "가입 30일 후 구독 보유 기준", metricIds: ["subscription_hold_rate_n"] },
        ],
      }),
      definitions,
      "고객 유지율",
    );
    expect(r.status).toBe("ambiguous");
    expect(r.clarificationQuestion).toContain("재결제 기준");
    expect(r.clarificationQuestion).toContain("구독 보유 기준");
    expect(r.clarificationQuestion).not.toContain("산출 방법");
  });

  it("C: 사용자가 기준을 직접 말했으면 후보 정의로 바로 계산한다 (후보임을 기록)", () => {
    const r = finalizeResolution(
      raw({
        requestedMetric: "재결제율",
        criterionExplicit: true,
        metricIds: ["repurchase_rate"],
        supportIds: ["plan_ad_tier"],
        options: [{ label: "가입 30일 후 구독 보유 기준", metricIds: ["subscription_hold_rate_n"] }],
      }),
      definitions,
      "광고형 요금제의 재결제율",
    );
    expect(r.status).toBe("resolved");
    expect(r.candidateIds.sort()).toEqual(["plan_ad_tier", "repurchase_rate"]);
  });

  it("E: 지표 개념에 대응 정의가 없으면 resolved라고 해도 계산하지 않는다", () => {
    const r = finalizeResolution(
      raw({ requestedMetric: "이탈률", metricIds: ["first_payment_customer_n"], concepts: [{ phrase: "이탈률", role: "metric", ids: [] }] }),
      definitions,
      "이탈률",
    );
    expect(r.status).toBe("undefined");
    expect(r.reason).toContain("이탈률");
  });
});

describe("후보 정의도 정의 준수 검사를 받는다", () => {
  it("재결제율 SQL에 첫 결제 조건이 없으면 차단한다", () => {
    const res = finalizeResolution(raw({ metricIds: ["repurchase_rate"], criterionExplicit: true }), definitions, "재결제율");
    const r = checkDefinitionCompliance({
      resolution: res,
      usage: { metricIds: ["repurchase_rate"], definitionRefs: [], formula: "추가 결제 고객 / 결제 고객", filters: [], grain: "고객", unapprovedAssumptions: [], candidateIds: res.candidateIds },
      sql: "SELECT count(DISTINCT user_key) FILTER (WHERE payment_order >= 2) * 100.0 / count(DISTINCT user_key) FROM analytics.payment_fact",
      referencedTables: ["analytics.payment_fact"],
      definitions,
    });
    expect(r.passed).toBe(false);
    expect(r.errors.join(" ")).toContain("payment_order = 1");
  });
});

describe("운영 실측에서 발견한 문제의 회귀 방지", () => {
  it("상대 기간은 코드가 계산한다 — 오늘 2026-10-10이면 지난달은 2026-09 (모델이 2025-09로 써도 교정)", () => {
    expect(relativeRange("지난달 가입한 고객", "2026-10-10")).toEqual({ label: "지난달", start: "2026-09-01", end: "2026-09-30" });
    expect(relativeRange("최근 7일 결제", "2026-10-10")).toEqual({ label: "최근 7일", start: "2026-10-04", end: "2026-10-10" });
    expect(relativeRange("지난 달 가입", "2026-01-15")?.start).toBe("2025-12-01");
    const r = finalizeResolution(
      raw({
        metricIds: ["subscription_hold_rate_n"], criterionExplicit: true,
        standaloneQuestion: "2025년 9월에 가입한 고객의 30일 구독 유지율",
        dateRange: { column: "signup_date", start: "2025-09-01", end: "2025-09-30" },
        filters: ["가입일 2025-09-01부터 2025-09-30까지"],
      }),
      definitions,
      "지난달 가입한 고객의 30일 유지율을 알려줘.",
      "2026-10-10",
    );
    expect(r.status).toBe("unavailable");
    expect(r.reason).toContain("2026-09-01~2026-09-30");
    expect(r.filters[0]).toContain("2026-09-01");
    expect(r.clarificationQuestion).toContain("데이터가 있는 가입일 기간으로 바꿔");
  });

  it("정책 A 강제: 모델이 공식 1개 + 후보 1개를 두고 모호하다고 해도 공식 정의로 계산한다", () => {
    const r = finalizeResolution(
      raw({
        status: "ambiguous",
        requestedMetric: "유지율",
        supportIds: ["plan_ad_tier"],
        concepts: [
          { phrase: "광고형 요금제", role: "dimension", ids: ["plan_ad_tier"] },
          { phrase: "유지율", role: "metric", ids: ["watch_retention_22_28", "subscription_hold_rate_n"] },
        ],
        options: [
          { label: "시청 유지율(결제 후 22~28일)", metricIds: ["watch_retention_22_28"] },
          { label: "구독 유지율(가입 후 30일 보유)", metricIds: ["subscription_hold_rate_n"] },
        ],
        assumptions: ["유지율=리텐션으로 해석, 공식 정의 2종이 존재하나 기준 선택 필요"],
      }),
      definitions,
      FAILING_QUESTION,
    );
    expect(r.status).toBe("resolved");
    expect(r.metricIds).toEqual(["watch_retention_22_28"]);
    expect(r.candidateIds).toEqual(["plan_ad_tier"]);
    expect(r.unspecified.join(" ")).toContain("구독 유지율(가입 후 30일 보유)");
  });

  it("정책 A는 모델이 기준 명시(criterionExplicit)로 표시하고 해석을 '가정'으로 적어도 적용된다 (운영 재현)", () => {
    const r = finalizeResolution(
      raw({
        status: "ambiguous", requestedMetric: "유지율", criterionExplicit: true, supportIds: ["plan_ad_tier"],
        concepts: [
          { phrase: "광고형 요금제", role: "dimension", ids: ["plan_ad_tier"] },
          { phrase: "유지율", role: "metric", ids: ["watch_retention_22_28"] },
        ],
        assumptions: ["유지율을 D+22~28 시청 유지율(공식)을 의미하는 것으로 해석함"],
      }),
      definitions,
      FAILING_QUESTION,
    );
    expect(r.status).toBe("resolved");
    expect(r.metricIds).toEqual(["watch_retention_22_28"]);
    expect(r.assumptions).toEqual([]);
  });

  it("공식 지표가 없으면 정책 A를 적용하지 않고 선택지를 묻는다 — '인기'", () => {
    const r = finalizeResolution(
      raw({
        status: "ambiguous", requestedMetric: "인기",
        concepts: [{ phrase: "인기", role: "metric", ids: ["payment_count", "first_payment_customer_n"] }],
        options: [
          { label: "첫 결제 고객 수 기준", metricIds: ["first_payment_customer_n"] },
          { label: "결제 건수 기준", metricIds: ["payment_count"] },
        ],
      }),
      definitions,
      "가장 인기 있는 요금제는?",
    );
    // first_payment_customer_n은 공식 지표지만 '인기'의 정의(이름·별칭)가 아니다 — 승격하지 않고 묻는다
    expect(r.status).toBe("ambiguous");
    expect(r.metricIds).toEqual([]);
    expect(r.options.map((o) => o.metricIds[0])).toEqual(["first_payment_customer_n", "payment_count"]);
  });
});
