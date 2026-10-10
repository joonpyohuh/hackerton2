import { candidate } from "./authority";
import type { Definition, SeedInput } from "./definitions";

/**
 * 공식 정의가 없는 업무 개념을 실제 데이터로 계산할 수 있게 제안한 후보 정의.
 * 2026-10-10 운영 Neon(analytics) 읽기 전용 조회로 계산 가능성을 확인했다. 공식 정의가 아니다.
 * - 사용자가 해당 기준을 직접 말했거나 선택했을 때만 적용하고, 응답에 "후보 정의"임을 표시한다.
 * - 이 정의로 나온 실행은 담당자 승인(확정 RAG 지식) 대상에서 제외한다.
 */

const SOURCE = "데이터 산출 후보 — 2026-10-10 Neon 조회로 계산 가능성 확인, 공식 승인 아님";
const MISSING = "분모가 0이면 NULL 또는 계산 불가로 표시한다.";

const INPUTS: SeedInput[] = [
  {
    id: "plan_ad_tier",
    kind: "dimension",
    name: "광고형·비광고형 요금제 분류",
    aliases: ["광고형 요금제", "비광고형 요금제", "광고형", "비광고형", "광고 요금제", "광고 없는 요금제"],
    description: "상품명(product_name)에 '광고형'이 들어간 상품을 광고형, 그 외 상품을 비광고형으로 나눈 분류. 2026-10-10 기준 광고형 12개, 비광고형 44개 상품.",
    tables: ["analytics.payment_fact"],
    columns: ["payment_fact.product_name", "payment_fact.product_code", "payment_fact.payment_order"],
    joins: [],
    rule: "CASE WHEN p.product_name LIKE '%광고형%' THEN '광고형' ELSE '비광고형' END. 고객 단위로 비교할 때는 고객의 첫 결제(payment_order 1) 상품 분류를 그 고객의 요금제 분류로 쓴다.",
    numerator: null,
    denominator: null,
    grain: "결제 건 또는 첫 결제 고객",
    period: "결제일 기준",
    unit: "범주",
    missing: "상품명이 NULL이면 비광고형으로 분류되지 않도록 별도 '미상'으로 표시한다.",
    caveat: "공식 요금제 그룹 정의가 없다. package_type_id '0010011011'은 광고형 12개에 '멜론 X 웨이브 플레이 패스권' 2개(첫 결제 4명)를 더한 14개라 이름 기준과 다르다. 번들 상품(디즈니+ 티빙 웨이브 번들, 3 PACK)은 광고 포함 여부를 데이터로 확인할 수 없어 비광고형으로 분류된다.",
    status: "ready",
  },
  {
    id: "repurchase_rate",
    kind: "metric",
    name: "재결제율",
    aliases: ["재결제율", "재구매율", "추가 결제율", "재결제", "다음 결제 주기 재결제"],
    description: "첫 결제 고객 중 첫 결제일 이후 다른 날에 추가 결제(payment_order 2 이상)가 있는 고객의 비율. 첫 이용권 종료가 결제 관측 범위(가입 후 D90) 안에 있는 고객만 분모에 넣는다.",
    tables: ["analytics.payment_fact"],
    columns: ["payment_fact.user_key", "payment_fact.payment_order", "payment_fact.payment_date", "payment_fact.relative_signup_day", "payment_fact.service_duration_days"],
    joins: ["payment_fact p1.user_key = payment_fact p2.user_key"],
    rule: "분모: p1.payment_order = 1 AND p1.relative_signup_day + p1.service_duration_days <= 90 인 고객. 분자: 그중 EXISTS (SELECT 1 FROM analytics.payment_fact p2 WHERE p2.user_key = p1.user_key AND p2.payment_order >= 2 AND p2.payment_date > p1.payment_date) 인 고객. 비율 = 분자 / 분모 * 100.",
    numerator: "첫 결제일 이후 다른 날 추가 결제가 있는 첫 결제 고객",
    denominator: "첫 이용권 종료가 가입 후 D90 이내인 첫 결제 고객",
    grain: "첫 결제 고객",
    period: "가입 후 D0~D90 결제 관측",
    unit: "%",
    missing: MISSING,
    caveat: "payment_order 2 이상은 추가 결제 기록이며 자동 갱신 성공을 뜻하지 않는다(PDF). 첫 결제와 같은 날의 추가 결제(226건)는 제외한다. 2026-10-10 기준 2번째 결제 1,266건 중 첫 결제 후 26~40일 415건, 40일 초과 471건.",
    status: "ready",
  },
  {
    id: "subscription_hold_rate_n",
    kind: "metric",
    name: "가입 후 D+N 구독 보유율",
    aliases: ["구독 유지율", "구독 보유율", "D+N 구독 유지율", "가입 후 N일 구독 유지", "30일 구독 유지율"],
    description: "가입 후 D+N 이전에 첫 결제한 고객 중 가입일 + N일에 유효한 이용권(service_start_date <= 가입일+N <= service_end_date)을 가진 고객의 비율. N 미지정 시 30.",
    tables: ["analytics.user_dim", "analytics.payment_fact"],
    columns: ["user_dim.user_key", "user_dim.signup_date", "payment_fact.user_key", "payment_fact.payment_order", "payment_fact.relative_signup_day", "payment_fact.service_start_date", "payment_fact.service_end_date"],
    joins: ["user_dim.user_key = payment_fact.user_key"],
    rule: "N은 질문의 일수(미지정 시 30, N은 90 이하). 분모: EXISTS (SELECT 1 FROM analytics.payment_fact f WHERE f.user_key = u.user_key AND f.payment_order = 1 AND f.relative_signup_day < N) 인 고객. 분자: 그중 EXISTS (SELECT 1 FROM analytics.payment_fact p WHERE p.user_key = u.user_key AND p.service_start_date <= u.signup_date + N AND p.service_end_date >= u.signup_date + N) 인 고객. 비율 = 분자 / 분모 * 100.",
    numerator: "가입일 + N일에 유효한 이용권이 있는 고객",
    denominator: "가입 후 D+N 이전에 첫 결제한 고객",
    grain: "첫 결제 고객",
    period: "가입 후 D+N 시점(기본 N=30)",
    unit: "%",
    missing: MISSING,
    caveat: "이용권 대부분이 28~32일이라 가입 직전에 결제한 고객은 갱신과 무관하게 유지로 잡힌다. 갱신 여부를 보려면 재결제율을 쓴다.",
    status: "ready",
  },
  {
    id: "plan_tier_switch_rate",
    kind: "metric",
    name: "요금제 전환율(광고형↔비광고형)",
    aliases: ["요금제 전환율", "요금제 변경률", "플랜 전환율", "광고형 전환율"],
    description: "2번째 결제가 있는 고객 중 첫 결제와 2번째 결제의 광고형·비광고형 분류가 다른 고객의 비율.",
    tables: ["analytics.payment_fact"],
    columns: ["payment_fact.user_key", "payment_fact.payment_order", "payment_fact.product_name"],
    joins: ["payment_fact p1.user_key = payment_fact p2.user_key"],
    rule: "p1.payment_order = 1 과 p2.payment_order = 2 를 같은 user_key로 JOIN. 분모: 2번째 결제가 있는 고객. 분자: (p1.product_name LIKE '%광고형%') <> (p2.product_name LIKE '%광고형%') 인 고객. 방향별(광고형→비광고형, 비광고형→광고형)로 나눠 보여줄 수 있다.",
    numerator: "첫 결제와 2번째 결제의 광고형 분류가 다른 고객",
    denominator: "2번째 결제가 있는 고객",
    grain: "2번째 결제 고객",
    period: "가입 후 D0~D90 결제 관측",
    unit: "%",
    missing: MISSING,
    caveat: "광고형 분류는 후보 분류(plan_ad_tier)다. 같은 분류 안의 상품 변경은 포함하지 않는다. 결제 전환율(첫 결제 전환)과 다른 지표다.",
    status: "ready",
  },
  {
    id: "payment_count",
    kind: "metric",
    name: "결제 건수",
    aliases: ["결제 건수", "구매 건수", "판매 건수"],
    description: "payment_fact의 결제 레코드 수(payment_key 기준).",
    tables: ["analytics.payment_fact"],
    columns: ["payment_fact.payment_key"],
    joins: [],
    rule: "COUNT(DISTINCT p.payment_key) FROM analytics.payment_fact p. 고객 수가 아니라 결제 건수다.",
    numerator: "결제 레코드 수",
    denominator: null,
    grain: "결제 건",
    period: "결제일 기준(가입 후 D0~D90)",
    unit: "건",
    missing: "해당 결제가 없으면 0건.",
    caveat: "같은 날 추가 결제와 추가 이용권이 모두 포함된다. 고객 수 비교에는 첫 결제 고객 수를 쓴다.",
    status: "ready",
  },
];

export const CANDIDATE_DEFINITIONS: Definition[] = INPUTS.map((item) => ({ ...item, ...candidate(SOURCE) }));
