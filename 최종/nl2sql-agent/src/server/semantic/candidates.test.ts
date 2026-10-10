import { describe, expect, it } from "vitest";
import { checkDefinitionCompliance } from "@/server/harness/definitionCheck";
import { SEED_DEFINITIONS, definitionSchema } from "./definitions";
import { finalizeResolution, resolverResponseSchema } from "./resolver";
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
