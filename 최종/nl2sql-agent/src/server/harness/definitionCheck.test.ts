import { describe, expect, it } from "vitest";
import type { DefinitionUsage, Resolution } from "@/lib/agent/contract";
import { SEED_DEFINITIONS, definitionSchema } from "@/server/semantic/definitions";
import { checkDefinitionCompliance, requiredPredicates } from "./definitionCheck";

const definitions = SEED_DEFINITIONS.map((d) => ({ ...definitionSchema.parse(d), version: 3 }));
const resolution = (metricIds: string[], extra: Partial<Resolution> = {}): Resolution => ({
  status: "resolved", standaloneQuestion: "q", requestedMetric: null, metricIds, supportIds: [], filters: [], period: null, grain: null,
  relations: [], unspecified: [], confirmed: [], assumptions: [], options: [], reason: null, clarificationQuestion: null,
  concepts: [], candidateIds: [], ...extra,
});
const usage = (extra: Partial<DefinitionUsage> = {}): DefinitionUsage => ({
  metricIds: ["first_payment_customer_n"], definitionRefs: [], formula: "COUNT(DISTINCT user_key) WHERE payment_order = 1",
  filters: ["payment_order = 1", "relative_signup_day BETWEEN 0 AND 30"], grain: "상품별 첫 결제 고객", unapprovedAssumptions: [], candidateIds: [], ...extra,
});
const FIRST_PAYERS_BY_PLAN = `SELECT p.product_code, p.product_name, COUNT(DISTINCT p.user_key) AS first_payers
  FROM analytics.payment_fact p WHERE p.payment_order = 1 AND p.relative_signup_day BETWEEN 0 AND 30
  GROUP BY p.product_code, p.product_name ORDER BY first_payers DESC`;

describe("정의 준수 검사 (결정론적)", () => {
  it("정의 산식의 리터럴 조건만 필수 조건으로 뽑는다 (조인 조건 제외)", () => {
    expect(requiredPredicates("p.payment_order=1 AND w.user_key=p.user_key")).toEqual([{ column: "payment_order", literal: "1" }]);
    expect(requiredPredicates("w.channel_type='V'; COUNT(DISTINCT w.user_key)")).toEqual([{ column: "channel_type", literal: "'V'" }]);
  });

  it("공식 정의대로 쓴 SQL은 통과한다", () => {
    const r = checkDefinitionCompliance({
      resolution: resolution(["first_payment_customer_n"]), usage: usage(), sql: FIRST_PAYERS_BY_PLAN,
      referencedTables: ["analytics.payment_fact"], definitions,
    });
    expect(r).toEqual({ passed: true, errors: [], unapprovedAssumptions: [] });
  });

  it("첫 결제 조건(payment_order = 1)이 빠지면 차단한다", () => {
    const r = checkDefinitionCompliance({
      resolution: resolution(["first_payment_customer_n"]), usage: usage(),
      sql: "SELECT p.product_code, COUNT(*) AS n FROM analytics.payment_fact p GROUP BY 1",
      referencedTables: ["analytics.payment_fact"], definitions,
    });
    expect(r.passed).toBe(false);
    expect(r.errors.join(" ")).toContain("payment_order = 1");
  });

  it("판정된 지표와 다른 지표를 계산했다고 밝히면 차단한다", () => {
    const r = checkDefinitionCompliance({
      resolution: resolution(["first_payment_customer_n"]), usage: usage({ metricIds: ["payment_conversion_30"] }),
      sql: FIRST_PAYERS_BY_PLAN, referencedTables: ["analytics.payment_fact"], definitions,
    });
    expect(r.passed).toBe(false);
    expect(r.errors[0]).toContain("다릅니다");
  });

  it("전환율 분모에 필요한 user_dim을 참조하지 않으면 차단한다", () => {
    const r = checkDefinitionCompliance({
      resolution: resolution(["payment_conversion_30"]), usage: usage({ metricIds: ["payment_conversion_30"] }),
      sql: "SELECT round(100.0 * count(*) FILTER (WHERE payment_order = 1) / nullif(count(*), 0), 1) FROM analytics.payment_fact",
      referencedTables: ["analytics.payment_fact"], definitions,
    });
    expect(r.passed).toBe(false);
    expect(r.errors.join(" ")).toContain("analytics.user_dim");
  });

  it("등록되지 않은 지표 ID와 빈 계산식을 차단한다", () => {
    const r = checkDefinitionCompliance({
      resolution: resolution(["first_payment_customer_n"]), usage: usage({ metricIds: ["first_payment_customer_n", "popularity"], formula: "" }),
      sql: FIRST_PAYERS_BY_PLAN, referencedTables: ["analytics.payment_fact"], definitions,
    });
    expect(r.errors.join(" ")).toContain("popularity");
    expect(r.errors.join(" ")).toContain("계산식");
  });

  it("생성 모델이 밝힌 미승인 가정이 있으면 SQL이 맞아도 통과시키지 않는다", () => {
    const r = checkDefinitionCompliance({
      resolution: resolution(["first_payment_customer_n"]), usage: usage({ unapprovedAssumptions: ["인기를 첫 결제 고객 수로 해석"] }),
      sql: FIRST_PAYERS_BY_PLAN, referencedTables: ["analytics.payment_fact"], definitions,
    });
    expect(r.passed).toBe(false);
    expect(r.errors).toEqual([]);
    expect(r.unapprovedAssumptions).toEqual(["인기를 첫 결제 고객 수로 해석"]);
  });

  it("IN 목록 안의 리터럴도 필수 조건으로 인정한다", () => {
    const r = checkDefinitionCompliance({
      resolution: resolution(["vod_customer"]),
      usage: usage({ metricIds: ["vod_customer"] }),
      sql: "SELECT count(DISTINCT w.user_key) FROM analytics.watch_daily_fact w WHERE w.channel_type IN ('V')",
      referencedTables: ["analytics.watch_daily_fact"], definitions,
    });
    expect(r.passed).toBe(true);
  });
});
