import { describe, expect, it } from "vitest";
import { SEED_DEFINITIONS, definitionSchema } from "./definitions";
import { matchDefinitions, scoreText } from "./search";

const definitions = SEED_DEFINITIONS.map((item) => ({ ...definitionSchema.parse(item), version: 1 }));

describe("질문별 시맨틱 검색", () => {
  it("PDF 요구 지표·차원·업무 용어가 유효한 정의로 등록된다", () => {
    expect(definitions.filter((d) => d.kind === "metric").length).toBeGreaterThanOrEqual(3);
    expect(definitions.filter((d) => d.kind === "dimension")).toHaveLength(3);
    expect(definitions.filter((d) => d.kind === "term").length).toBeGreaterThanOrEqual(3);
  });
  it("20대 초기 미시청률 질문에 관련 정의를 우선 검색한다", () => {
    const hits = matchDefinitions("20대의 초기 미시청률을 알려줘", definitions);
    expect(hits[0]?.id).toBe("early_nonwatch_rate");
    expect(hits.some((h) => h.id === "age_band")).toBe(true);
    expect(hits.map((h) => h.id)).toEqual(["early_nonwatch_rate", "age_band"]);
  });
  it("없는 데이터의 지표도 검색되며 상태는 needs_data다", () => {
    const id = matchDefinitions("캠페인 반응률", definitions)[0]?.id;
    expect(definitions.find((d) => d.id === id)?.status).toBe("needs_data");
  });
  it("관련 없는 승인 사례는 검색 점수 0으로 제외할 수 있다", () => {
    expect(scoreText("초기 미시청률", "요금제별 결제")).toBe(0);
  });
  it("요청한 고객 여정·채널·선호 정의 16개를 모두 등록한다", () => {
    const ids = [
      "signup_customers", "exploratory_customer", "voucher_interest_customer", "first_payment_customer_n",
      "payment_conversion_30", "active_customer", "postpayment_unwatched_customer_n", "early_watch_failure",
      "watch_retained_customer_22_28", "watch_retention_22_28", "vod_customer", "movie_customer",
      "live_customer", "push_reachable_customer", "preferred_content", "preferred_genre",
    ];
    for (const id of ids) expect(definitions.find((item) => item.id === id)).toBeDefined();
    expect(new Set(definitions.map((item) => item.id)).size).toBe(definitions.length);
  });
  it("D+N 기간과 선호 장르를 질문별로 찾는다", () => {
    expect(matchDefinitions("D+14 첫 결제 고객은 몇 명?", definitions)[0]?.id).toBe("first_payment_customer_n");
    expect(matchDefinitions("D+14 결제 전환율은?", definitions)[0]?.id).toBe("payment_conversion_30");
    expect(matchDefinitions("가입 후 14일 내 첫 결제 고객", definitions)[0]?.id).toBe("first_payment_customer_n");
    expect(matchDefinitions("결제 후 14일 활성 고객", definitions)[0]?.id).toBe("active_customer");
    expect(matchDefinitions("결제 후 D+14 미시청 고객", definitions)[0]?.id).toBe("postpayment_unwatched_customer_n");
    expect(matchDefinitions("내 선호 장르", definitions)[0]?.id).toBe("preferred_genre");
  });
  it("이용권 조회 고객 질문에 상품 차원을 섞지 않는다", () => {
    expect(matchDefinitions("이용권 관심 고객은 몇 명이야?", definitions).map((item) => item.id)).toEqual(["voucher_interest_customer"]);
  });
});
