import { z } from "zod";
import { candidate, official, type Authority } from "./authority";
import { CANDIDATE_DEFINITIONS } from "./candidates";
import { DICTIONARY_DEFINITIONS } from "./dictionary";

export const definitionSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_]{2,63}$/),
  kind: z.enum(["metric", "dimension", "term"]),
  name: z.string().trim().min(2).max(100),
  aliases: z.array(z.string().trim().min(2).max(100)).max(20),
  description: z.string().trim().min(5).max(1000),
  tables: z.array(z.string().regex(/^analytics\.[a-z_]+$/)).min(1).max(7),
  columns: z.array(z.string().max(100)).max(30),
  joins: z.array(z.string().max(300)).max(10),
  rule: z.string().trim().min(5).max(3000),
  numerator: z.string().max(500).nullable(),
  denominator: z.string().max(500).nullable(),
  grain: z.string().min(1).max(200),
  period: z.string().min(1).max(300),
  unit: z.string().min(1).max(100),
  missing: z.string().min(1).max(500),
  caveat: z.string().max(1000),
  status: z.enum(["ready", "needs_data"]),
  /**
   * official: 제공된 공식 자료(문제 PDF)에 근거한 정의.
   * candidate: 공식 정의가 없어 실제 데이터로 계산 가능하게 제안한 후보 — AI가 만든 정의이므로 공식으로 취급하지 않는다.
   * 출처가 표시되지 않은 정의는 후보로 본다(fail-safe).
   */
  authority: z.enum(["official", "candidate"]).default("candidate"),
  source: z.string().max(300).default("출처 미기재"),
});
export type Definition = z.infer<typeof definitionSchema>;
export type StoredDefinition = Definition & { version: number };
/** 시드 작성용 — 근거(authority·source)는 아래 SEED_AUTHORITY에서 붙인다. */
export type SeedInput = Omit<Definition, "authority" | "source">;

/**
 * 기본 시드의 근거. 문제 PDF에 지표·용어로 명시된 것만 official이다.
 * PDF 기준을 비율로 확장했거나 PDF에 없는 지표는 candidate로 둔다.
 */
const SEED_AUTHORITY: Record<string, Authority> = {
  signup_customers: official("문제 1-4 필수 KPI '전체 가입 고객 수'"),
  payment_conversion_30: official("문제 1-1 필수 비교 지표 '가입 후 D+7·D+14·D+30 결제 전환율'"),
  watch_retention_22_28: official("문제 1-1 필수 비교 지표 '결제 후 D+22~D+28 시청 유지율'"),
  early_nonwatch_rate: candidate("PDF 1-1 '(참고) 초기 시청 실패 고객' 권장 기준을 비율로 확장한 후보 — 비율 산식은 PDF에 없음"),
  average_watch_raw: candidate("데이터 산출 후보 — PDF에 지표 정의 없음"),
  campaign_response_rate: candidate("PDF 1-3 캠페인 KPI 요구에 대응한 자리표시 — 계산 원천 데이터 없음"),
  age_band: official("데이터 설명 (2) user_dim.age_band"),
  plan: official("데이터 설명 (4) payment_fact.product_code·product_name"),
  content_genre: official("데이터 설명 (6) content_genre_bridge"),
  early_watch_failure: official("문제 1-1 '(참고) 초기 시청 실패 고객' 권장 기준"),
  active_customer: official("문제 1-1 '결제 후 D+N 활성 고객'"),
  unwatched_customer: candidate("데이터 산출 후보 — PDF에 없음"),
  exploratory_customer: official("문제 1-1 '탐색 고객'"),
  voucher_interest_customer: official("문제 1-1 '이용권 관심 고객'"),
  first_payment_customer_n: official("문제 1-1 'D+N 첫 결제 고객'"),
  postpayment_unwatched_customer_n: candidate("PDF '초기 시청 실패(결제 후 D+7)'를 N일로 일반화한 후보"),
  watch_retained_customer_22_28: official("문제 1-1 'D+22~D+28 시청 고객'"),
  vod_customer: official("문제 1-1 'VOD·영화·LIVE 이용률' channel_type = 'V'"),
  movie_customer: official("문제 1-1 'VOD·영화·LIVE 이용률' channel_type = 'M'"),
  live_customer: official("문제 1-1 'VOD·영화·LIVE 이용률' channel_type = 'L'"),
  push_reachable_customer: official("문제 1-3·1-4 'push_opt_in_current = 1' 푸시 도달 가능 타깃"),
  preferred_content: candidate("데이터 산출 후보 — PDF에 선호 콘텐츠 정의 없음"),
  preferred_genre: candidate("데이터 산출 후보 — 다중 장르 균등 배분은 분석 가정"),
};

const d = (value: SeedInput): SeedInput => value;
const BASE_SEED_INPUTS: SeedInput[] = [
  d({
    id: "signup_customers", kind: "metric", name: "가입 고객", aliases: ["가입자 수", "전체 가입자", "전체 가입 고객"],
    description: "선택한 가입 코호트의 고유 고객 수.", tables: ["analytics.user_dim"], columns: ["user_dim.user_key", "user_dim.signup_date"], joins: [],
    rule: "COUNT(DISTINCT u.user_key) FROM analytics.user_dim u. 기간 필터는 u.signup_date에 적용.",
    numerator: "고유 가입 고객 수", denominator: null, grain: "고객", period: "선택한 가입일 범위", unit: "명",
    missing: "조건에 맞는 고객이 없으면 0명.", caveat: "다른 fact의 이벤트 발생일과 가입일을 혼동하지 않는다.", status: "ready",
  }),
  d({
    id: "payment_conversion_30", kind: "metric", name: "D+N 결제 전환율", aliases: ["결제 전환율", "첫 결제율", "D+30 결제 전환율", "30일 결제 전환율", "N일 결제 전환율"],
    description: "가입 후 N일 내 첫 결제한 고유 고객의 전체 가입 고객 대비 비율. N 미지정 시 30일.",
    tables: ["analytics.user_dim", "analytics.payment_fact"],
    columns: ["user_dim.user_key", "user_dim.signup_date", "payment_fact.user_key", "payment_fact.payment_order", "payment_fact.relative_signup_day"],
    joins: ["user_dim.user_key = payment_fact.user_key"],
    rule: "N은 질문의 비음수 일수(미지정 시 30). N>90이면 계산하지 말고 관측 범위 부족을 설명한다. 그 외 COUNT(DISTINCT CASE WHEN p.payment_order=1 AND p.relative_signup_day BETWEEN 0 AND N THEN p.user_key END)::numeric / NULLIF(COUNT(DISTINCT u.user_key),0) * 100. 기준 코호트는 user_dim.signup_date로 필터링.",
    numerator: "가입 후 D0~DN 첫 결제 고객", denominator: "선택한 코호트의 전체 가입 고객",
    grain: "가입 고객", period: "가입 후 0~N일(기본 N=30)", unit: "%",
    missing: "가입 고객 0명이면 NULL 또는 계산 불가.", caveat: "첫 결제 건수와 첫 결제 고객 수를 혼동하지 않는다. payment_fact의 관측은 D90까지여서 N>90이면 완전한 전환율을 계산할 수 없다.", status: "ready",
  }),
  d({
    id: "watch_retention_22_28", kind: "metric", name: "D+22~28 시청 유지율", aliases: ["유지율", "리텐션", "시청 유지율", "4주차 유지율", "결제 후 유지율"],
    description: "가입 후 30일 내 첫 결제한 고객 중 결제일로부터 22~28일 사이 시청한 고객 비율.",
    tables: ["analytics.payment_fact", "analytics.watch_daily_fact"],
    columns: ["payment_fact.user_key", "payment_fact.payment_date", "payment_fact.payment_order", "payment_fact.relative_signup_day", "watch_daily_fact.user_key", "watch_daily_fact.watch_date"],
    joins: ["payment_fact.user_key = watch_daily_fact.user_key; 시청일은 첫 결제일+22일부터 +28일까지"],
    rule: "첫 결제 고객(p.payment_order=1 AND p.relative_signup_day BETWEEN 0 AND 30) 중 EXISTS (SELECT 1 FROM analytics.watch_daily_fact w WHERE w.user_key=p.user_key AND w.watch_date BETWEEN p.payment_date + 22 AND p.payment_date + 28)인 고객 / 첫 결제 고객 * 100.",
    numerator: "첫 결제 후 D+22~D+28 시청 고객", denominator: "가입 후 D0~D30 첫 결제 고객",
    grain: "첫 결제 고객", period: "첫 결제 후 22~28일", unit: "%",
    missing: "첫 결제 고객 0명이면 NULL 또는 계산 불가.", caveat: "시청 로그는 가입 후 D0~D60까지만 제공. D30 내 결제자로 제한해 +28일 관측을 보장한다.", status: "ready",
  }),
  d({
    id: "early_nonwatch_rate", kind: "metric", name: "초기 미시청률", aliases: ["첫 시청 실패율", "결제 후 7일 미시청률", "초기 시청 실패율"],
    description: "가입 후 D0~D30에 첫 결제한 고객 중 결제일~7일 후 시청 기록이 없는 고객의 비율.",
    tables: ["analytics.payment_fact", "analytics.watch_daily_fact"], columns: ["payment_fact.user_key", "payment_fact.payment_date", "payment_fact.payment_order", "payment_fact.relative_signup_day", "watch_daily_fact.user_key", "watch_daily_fact.watch_date"],
    joins: ["payment_fact.user_key = watch_daily_fact.user_key; 시청일은 첫 결제일 이상 결제일+7일 이하"],
    rule: "첫 결제(payment_order=1 AND relative_signup_day BETWEEN 0 AND 30)를 고객별 한 건으로 잡고, 결제일~+7일 watch_daily_fact가 NOT EXISTS인 고객 수 / 첫 결제 고객 수 * 100.",
    numerator: "결제 후 D0~D7 시청 기록이 없는 첫 결제 고객", denominator: "D0~D30 첫 결제 고객",
    grain: "첫 결제 고객", period: "가입 후 30일 내 첫 결제, 결제 후 0~7일 시청", unit: "%",
    missing: "분모 0이면 NULL 또는 '계산 불가'로 표시.", caveat: "시청 로그 부재를 실제 미시청으로 해석한다. watch_daily_fact는 가입 후 D0~D60 범위다.", status: "ready",
  }),
  d({
    id: "average_watch_raw", kind: "metric", name: "평균 시청시간 원천값", aliases: ["평균 시청시간", "인당 시청시간", "평균 시청량"],
    description: "관측 기간에 시청한 고객 1인당 watch_time_raw 합계의 평균. 원천값 단위는 확인되지 않았다.",
    tables: ["analytics.watch_daily_fact"], columns: ["watch_daily_fact.user_key", "watch_daily_fact.watch_date", "watch_daily_fact.watch_time_raw"], joins: [],
    rule: "SUM(w.watch_time_raw)::numeric / NULLIF(COUNT(DISTINCT w.user_key),0) FROM analytics.watch_daily_fact w. 기간 조건은 watch_date에 적용.",
    numerator: "선택 기간의 watch_time_raw 합계", denominator: "선택 기간에 시청 기록이 있는 고유 고객 수",
    grain: "시청 고객", period: "질문에서 지정한 관측 기간; 미지정 시 전체 시청 관측 기간", unit: "원천 단위(시간·분·초 미확인)",
    missing: "시청 고객 0명이면 NULL. 시청하지 않은 가입자를 분모에 포함하려면 별도 지표로 명시.",
    caveat: "원천값을 시간 또는 분으로 환산하지 않는다. 시간 단위 결과를 요청하면 단위 확인이 필요하다.", status: "ready",
  }),
  d({
    id: "campaign_response_rate", kind: "metric", name: "캠페인 반응률", aliases: ["캠페인 응답률", "캠페인 클릭률"],
    description: "캠페인 노출 또는 발송 고객 중 목표 반응 고객의 비율. 현재 원본에는 캠페인 발송·노출 ID와 반응 연결 정보가 없다.",
    tables: ["analytics.behavior_fact"], columns: ["behavior_fact.user_key", "behavior_fact.behavior_type"], joins: [],
    rule: "현재 데이터로 계산 금지. 캠페인 ID, 고객별 발송/노출 시각, 반응 이벤트 및 귀속 기간이 있어야 한다.",
    numerator: "정의된 귀속 기간 내 캠페인 반응 고객", denominator: "캠페인 발송 또는 노출 고객",
    grain: "캠페인×고객", period: "귀속 기간 미정", unit: "%",
    missing: "필수 원천 데이터가 없어 결과 산출 불가.", caveat: "일반 행동 이벤트를 캠페인 반응으로 임의 간주하지 않는다.", status: "needs_data",
  }),
  d({
    id: "age_band", kind: "dimension", name: "연령대", aliases: ["나이대", "20대", "고객 연령"],
    description: "가입 고객의 age_band 코드.", tables: ["analytics.user_dim"], columns: ["user_dim.user_key", "user_dim.age_band"], joins: [],
    rule: "u.age_band로 GROUP BY. 20대는 u.age_band = '20_29'.",
    numerator: null, denominator: null, grain: "고객", period: "가입 시점의 기록", unit: "범주",
    missing: "UNKNOWN은 별도 범주로 유지.", caveat: "UNKNOWN 비중이 높아 연령대별 해석에 주의.", status: "ready",
  }),
  d({
    id: "plan", kind: "dimension", name: "요금제", aliases: ["이용권 상품", "상품", "구독 상품"],
    description: "결제 기록의 상품 코드와 이름.", tables: ["analytics.payment_fact"], columns: ["payment_fact.product_code", "payment_fact.product_name", "payment_fact.payment_order"], joins: [],
    rule: "p.product_code와 p.product_name을 함께 GROUP BY. 첫 결제 상품이면 p.payment_order = 1.",
    numerator: null, denominator: null, grain: "결제 건 또는 첫 결제 고객(질문에 명시)", period: "결제일 기준", unit: "범주",
    missing: "상품명이 비어 있으면 코드로 표시.", caveat: "동일한 product_name에 서로 다른 product_code가 존재하므로 이름만으로 합치지 않는다.", status: "ready",
  }),
  d({
    id: "content_genre", kind: "dimension", name: "콘텐츠 장르", aliases: ["장르별", "프로그램 장르"],
    description: "콘텐츠에 부여된 장르. 하나의 콘텐츠에 여러 장르가 있다.",
    tables: ["analytics.user_content_summary", "analytics.content_dim", "analytics.content_genre_bridge"],
    columns: ["user_content_summary.content_key", "content_dim.content_key", "content_genre_bridge.content_key", "content_genre_bridge.genre_name"],
    joins: ["user_content_summary.content_key = content_dim.content_key", "content_dim.content_key = content_genre_bridge.content_key"],
    rule: "장르별 GROUP BY cgb.genre_name. 콘텐츠당 복수 장르이므로 장르 간 합계를 전체로 다시 합산하지 않는다.",
    numerator: null, denominator: null, grain: "콘텐츠×장르", period: "user_content_summary 전체 관측 기간(콘텐츠별 날짜 필터 불가)", unit: "범주",
    missing: "장르 없는 콘텐츠는 JOIN 시 빠질 수 있어 LEFT JOIN 또는 미상 범주를 명시.", caveat: "다중 장르 중복 집계. 날짜별 콘텐츠 장르 순위는 현재 스키마로 계산 불가.", status: "ready",
  }),
  d({
    id: "early_watch_failure", kind: "term", name: "초기 시청 실패 고객", aliases: ["결제 후 첫 시청 실패", "첫 주 미시청 고객"],
    description: "가입 후 30일 내 첫 결제했지만 결제 후 7일까지 시청 기록이 없는 고객.",
    tables: ["analytics.payment_fact", "analytics.watch_daily_fact"], columns: ["payment_fact.user_key", "payment_fact.payment_date", "payment_fact.payment_order", "watch_daily_fact.user_key", "watch_daily_fact.watch_date"],
    joins: ["payment_fact.user_key = watch_daily_fact.user_key"],
    rule: "p.payment_order=1 AND p.relative_signup_day BETWEEN 0 AND 30 AND NOT EXISTS (SELECT 1 FROM analytics.watch_daily_fact w WHERE w.user_key=p.user_key AND w.watch_date BETWEEN p.payment_date AND p.payment_date + 7).",
    numerator: null, denominator: null, grain: "첫 결제 고객", period: "첫 결제일~7일 후", unit: "고객 집합",
    missing: "시청 기록 부재를 미시청으로 분류.", caveat: "첫 결제일 이전 시청은 초기 활성화에 포함하지 않는다.", status: "ready",
  }),
  d({
    id: "active_customer", kind: "term", name: "결제 후 D+N 활성 고객", aliases: ["활성 고객", "첫 주 시청 고객", "D+7 활성 고객", "결제 후 7일 활성 고객", "결제 후 N일 활성 고객"],
    description: "첫 결제일부터 N일까지 시청 기록이 있는 고객. N 미지정 시 7일.",
    tables: ["analytics.payment_fact", "analytics.watch_daily_fact"], columns: ["payment_fact.user_key", "payment_fact.payment_date", "payment_fact.payment_order", "watch_daily_fact.user_key", "watch_daily_fact.watch_date"],
    joins: ["payment_fact.user_key = watch_daily_fact.user_key"],
    rule: "N은 질문의 비음수 일수(미지정 시 7). p.payment_order=1 AND p.relative_signup_day + N <= 60 AND EXISTS (SELECT 1 FROM analytics.watch_daily_fact w WHERE w.user_key=p.user_key AND w.watch_date BETWEEN p.payment_date AND p.payment_date + N).",
    numerator: null, denominator: null, grain: "첫 결제 고객", period: "첫 결제일~N일 후(기본 N=7)", unit: "고객 집합",
    missing: "시청 기록이 없으면 제외.", caveat: "watch_daily_fact는 가입 후 D60까지만 관측한다. 완전 관측 가능한 첫 결제 고객만 판정하며 제외된 고객 수를 함께 알린다.", status: "ready",
  }),
  d({
    id: "unwatched_customer", kind: "term", name: "가입 후 미시청 고객", aliases: ["가입 후 미시청 고객", "시청 안 한 가입자"],
    description: "가입 후 D0~D60에 시청 기록이 전혀 없는 가입 고객.",
    tables: ["analytics.user_dim", "analytics.watch_daily_fact"], columns: ["user_dim.user_key", "watch_daily_fact.user_key", "watch_daily_fact.relative_signup_day"],
    joins: ["user_dim.user_key = watch_daily_fact.user_key"],
    rule: "NOT EXISTS (SELECT 1 FROM analytics.watch_daily_fact w WHERE w.user_key=u.user_key AND w.relative_signup_day BETWEEN 0 AND 60).",
    numerator: null, denominator: null, grain: "가입 고객", period: "가입 후 0~60일", unit: "고객 집합",
    missing: "시청 기록이 없으면 미시청으로 분류.", caveat: "결제 후 7일 미시청(초기 시청 실패)과 다른 집합이다.", status: "ready",
  }),
  d({
    id: "exploratory_customer", kind: "term", name: "탐색 고객", aliases: ["탐색한 고객", "가입 후 탐색 고객"],
    description: "가입 후 D0~D30에 행동 기록이 1건 이상 존재하는 고객.",
    tables: ["analytics.user_dim", "analytics.behavior_fact"], columns: ["user_dim.user_key", "behavior_fact.user_key", "behavior_fact.relative_signup_day"], joins: ["user_dim.user_key = behavior_fact.user_key"],
    rule: "EXISTS (SELECT 1 FROM analytics.behavior_fact b WHERE b.user_key=u.user_key AND b.relative_signup_day BETWEEN 0 AND 30). 고객 수는 COUNT(DISTINCT b.user_key).",
    numerator: null, denominator: null, grain: "가입 고객", period: "가입 후 0~30일", unit: "고객 집합",
    missing: "행동 기록이 없으면 제외.", caveat: "행동 종류를 제한하지 않는다. 이벤트 행 수가 아니라 고유 고객을 센다.", status: "ready",
  }),
  d({
    id: "voucher_interest_customer", kind: "term", name: "이용권 관심 고객", aliases: ["이용권 조회 고객", "VOUCHER_VIEW 고객"],
    description: "VOUCHER_VIEW 행동을 경험한 고유 고객.",
    tables: ["analytics.user_dim", "analytics.behavior_fact"], columns: ["user_dim.user_key", "behavior_fact.user_key", "behavior_fact.behavior_type", "behavior_fact.relative_signup_day"], joins: ["user_dim.user_key = behavior_fact.user_key"],
    rule: "COUNT(DISTINCT b.user_key) 또는 EXISTS (SELECT 1 FROM analytics.behavior_fact b WHERE b.user_key=u.user_key AND b.behavior_type='VOUCHER_VIEW').",
    numerator: null, denominator: null, grain: "고객", period: "behavior_fact 관측 기간(가입 후 D0~D30)", unit: "고객 집합",
    missing: "VOUCHER_VIEW 기록이 없으면 제외.", caveat: "이용권 구매·결제 고객과 다르다.", status: "ready",
  }),
  d({
    id: "first_payment_customer_n", kind: "term", name: "D+N 첫 결제 고객", aliases: ["N일 내 첫 결제 고객", "첫 결제 고객", "D+30 첫 결제 고객"],
    description: "가입일부터 N일까지 첫 결제한 고유 고객. N 미지정 시 30일.",
    tables: ["analytics.payment_fact"], columns: ["payment_fact.user_key", "payment_fact.payment_order", "payment_fact.relative_signup_day"], joins: [],
    rule: "N은 질문의 비음수 일수(미지정 시 30). N>90이면 계산하지 말고 관측 범위 부족을 설명한다. 그 외 p.payment_order=1 AND p.relative_signup_day BETWEEN 0 AND N; 고객 수는 COUNT(DISTINCT p.user_key).",
    numerator: null, denominator: null, grain: "고객", period: "가입 후 0~N일(기본 N=30)", unit: "고객 집합",
    missing: "해당 기간 첫 결제가 없으면 0명.", caveat: "payment_fact는 가입 후 D90까지만 관측한다. N>90이면 기간 전체를 확인할 수 없어 계산하지 않는다.", status: "ready",
  }),
  d({
    id: "postpayment_unwatched_customer_n", kind: "term", name: "결제 후 D+N 미시청 고객", aliases: ["결제 후 미시청 고객", "첫 결제 후 미시청 고객", "결제 후 7일 미시청 고객", "결제 후 N일 미시청 고객"],
    description: "첫 결제일부터 N일까지 시청 기록이 없는 첫 결제 고객. N 미지정 시 7일.",
    tables: ["analytics.payment_fact", "analytics.watch_daily_fact"],
    columns: ["payment_fact.user_key", "payment_fact.payment_date", "payment_fact.payment_order", "payment_fact.relative_signup_day", "watch_daily_fact.user_key", "watch_daily_fact.watch_date"],
    joins: ["payment_fact.user_key = watch_daily_fact.user_key"],
    rule: "N은 질문의 비음수 일수(미지정 시 7). N>60이면 계산하지 말고 관측 범위 부족을 설명한다. 그 외 p.payment_order=1 AND p.relative_signup_day + N <= 60 AND NOT EXISTS (SELECT 1 FROM analytics.watch_daily_fact w WHERE w.user_key=p.user_key AND w.watch_date BETWEEN p.payment_date AND p.payment_date + N).",
    numerator: null, denominator: null, grain: "완전 관측 가능한 첫 결제 고객", period: "첫 결제일~N일 후(기본 N=7)", unit: "고객 집합",
    missing: "시청 기록 부재를 미시청으로 분류.", caveat: "가입 후 D60까지만 시청 관측. 결제일+N이 D60을 넘는 고객은 미시청 여부를 판정할 수 없어 제외하고 제외 수를 밝힌다. N>60은 계산 불가.", status: "ready",
  }),
  d({
    id: "watch_retained_customer_22_28", kind: "term", name: "D22~D28 시청 유지 고객", aliases: ["D+22~28 시청 고객", "첫 결제 후 22~28일 시청 고객", "4주차 시청 고객"],
    description: "가입 후 D0~D30에 첫 결제하고 결제일로부터 22~28일 사이 시청 기록이 있는 고객.",
    tables: ["analytics.payment_fact", "analytics.watch_daily_fact"],
    columns: ["payment_fact.user_key", "payment_fact.payment_date", "payment_fact.payment_order", "payment_fact.relative_signup_day", "watch_daily_fact.user_key", "watch_daily_fact.watch_date"],
    joins: ["payment_fact.user_key = watch_daily_fact.user_key"],
    rule: "p.payment_order=1 AND p.relative_signup_day BETWEEN 0 AND 30 AND EXISTS (SELECT 1 FROM analytics.watch_daily_fact w WHERE w.user_key=p.user_key AND w.watch_date BETWEEN p.payment_date + 22 AND p.payment_date + 28). 고객 수는 COUNT(DISTINCT p.user_key).",
    numerator: null, denominator: null, grain: "D0~D30 첫 결제 고객", period: "첫 결제 후 22~28일", unit: "고객 집합",
    missing: "기간 중 시청 기록이 없으면 제외.", caveat: "D0~D30 첫 결제 코호트로 제한해 D60 시청 관측 내에서 완전한 28일 추적을 보장한다.", status: "ready",
  }),
  d({
    id: "vod_customer", kind: "term", name: "VOD 이용 고객", aliases: ["VOD 시청 고객", "VOD 고객"],
    description: "channel_type='V' 시청 기록이 있는 고유 고객.",
    tables: ["analytics.watch_daily_fact"], columns: ["watch_daily_fact.user_key", "watch_daily_fact.channel_type", "watch_daily_fact.watch_date"], joins: [],
    rule: "w.channel_type='V'; COUNT(DISTINCT w.user_key). 질문의 기간은 w.watch_date에 적용.",
    numerator: null, denominator: null, grain: "시청 고객", period: "시청 관측 기간 또는 질문의 기간", unit: "고객 집합",
    missing: "시청 기록이 없으면 제외.", caveat: "고객이 V/M/L 여러 채널을 함께 이용할 수 있어 채널별 고객 수 합계는 전체 고유 고객 수와 다르다.", status: "ready",
  }),
  d({
    id: "movie_customer", kind: "term", name: "영화 이용 고객", aliases: ["영화 시청 고객", "영화 고객"],
    description: "channel_type='M' 시청 기록이 있는 고유 고객.",
    tables: ["analytics.watch_daily_fact"], columns: ["watch_daily_fact.user_key", "watch_daily_fact.channel_type", "watch_daily_fact.watch_date"], joins: [],
    rule: "w.channel_type='M'; COUNT(DISTINCT w.user_key). 질문의 기간은 w.watch_date에 적용.",
    numerator: null, denominator: null, grain: "시청 고객", period: "시청 관측 기간 또는 질문의 기간", unit: "고객 집합",
    missing: "시청 기록이 없으면 제외.", caveat: "동일 고객은 VOD·LIVE 이용 고객에도 포함될 수 있다.", status: "ready",
  }),
  d({
    id: "live_customer", kind: "term", name: "LIVE 이용 고객", aliases: ["라이브 이용 고객", "LIVE 시청 고객", "실시간 시청 고객"],
    description: "channel_type='L' 시청 기록이 있는 고유 고객.",
    tables: ["analytics.watch_daily_fact"], columns: ["watch_daily_fact.user_key", "watch_daily_fact.channel_type", "watch_daily_fact.watch_date"], joins: [],
    rule: "w.channel_type='L'; COUNT(DISTINCT w.user_key). 질문의 기간은 w.watch_date에 적용.",
    numerator: null, denominator: null, grain: "시청 고객", period: "시청 관측 기간 또는 질문의 기간", unit: "고객 집합",
    missing: "시청 기록이 없으면 제외.", caveat: "동일 고객은 VOD·영화 이용 고객에도 포함될 수 있다.", status: "ready",
  }),
  d({
    id: "push_reachable_customer", kind: "term", name: "푸시 도달 가능 고객", aliases: ["푸시 수신 가능 고객", "푸시 동의 고객", "푸시 타깃 고객"],
    description: "추출 시점의 푸시 수신 동의 값이 1인 고객.",
    tables: ["analytics.user_dim"], columns: ["user_dim.user_key", "user_dim.push_opt_in_current"], joins: [],
    rule: "u.push_opt_in_current=1; COUNT(DISTINCT u.user_key).",
    numerator: null, denominator: null, grain: "고객", period: "데이터 추출 시점", unit: "고객 집합",
    missing: "동의 값이 1이 아니면 제외.", caveat: "동의 상태는 실제 발송 성공이나 알림 도달을 보장하지 않는다.", status: "ready",
  }),
  d({
    id: "preferred_content", kind: "term", name: "선호 콘텐츠", aliases: ["좋아하는 콘텐츠", "가장 많이 본 콘텐츠", "고객별 선호 콘텐츠"],
    description: "고객별 total_watch_time_raw가 가장 큰 콘텐츠. 질문에서 시청일수를 지정하면 watch_day_count를 사용.",
    tables: ["analytics.user_content_summary", "analytics.content_dim"],
    columns: ["user_content_summary.user_key", "user_content_summary.content_key", "user_content_summary.total_watch_time_raw", "user_content_summary.watch_day_count", "content_dim.content_key", "content_dim.title"],
    joins: ["user_content_summary.content_key = content_dim.content_key"],
    rule: "s.content_key NOT IN ('PROGRAM|','LIVE|')인 콘텐츠 중 고객별 ROW_NUMBER() OVER (PARTITION BY s.user_key ORDER BY s.total_watch_time_raw DESC, s.content_key ASC)=1. 질문에서 시청일수를 명시하면 ORDER BY s.watch_day_count DESC, s.content_key ASC. content_dim은 표시 제목을 얻을 때만 조인.",
    numerator: null, denominator: null, grain: "고객×콘텐츠", period: "user_content_summary 전체 관측 기간", unit: "콘텐츠",
    missing: "시청 콘텐츠가 없으면 선호 콘텐츠 없음.", caveat: "total_watch_time_raw 단위 미확인. 날짜별 콘텐츠 기록이 없어 특정 월 선호 콘텐츠는 계산 불가. 빈 ID 자리표시자 PROGRAM|, LIVE|는 결과에서 제외한다.", status: "ready",
  }),
  d({
    id: "preferred_genre", kind: "term", name: "선호 장르", aliases: ["좋아하는 장르", "고객별 선호 장르", "가장 많이 본 장르"],
    description: "고객별 시청시간 비중이 가장 큰 장르. 콘텐츠의 복수 장르에는 시청시간을 균등 배분한다.",
    tables: ["analytics.user_content_summary", "analytics.content_genre_bridge"],
    columns: ["user_content_summary.user_key", "user_content_summary.content_key", "user_content_summary.total_watch_time_raw", "content_genre_bridge.content_key", "content_genre_bridge.genre_code", "content_genre_bridge.genre_name"],
    joins: ["user_content_summary.content_key = content_genre_bridge.content_key"],
    rule: "각 콘텐츠의 장르 수 k=COUNT(*) OVER (PARTITION BY content_key)를 구해 각 장르에 s.total_watch_time_raw::numeric/k 배분. 고객×genre_code×genre_name별 배분량을 합하고 고객의 전체 배분량으로 나눠 % 비중을 계산. 고객별 비중 DESC, genre_code ASC 순위 1개가 선호 장르.",
    numerator: "고객의 해당 장르 배분 시청시간 원천값", denominator: "고객의 장르 연결 콘텐츠 배분 시청시간 원천값 합계",
    grain: "고객×장르", period: "user_content_summary 전체 관측 기간", unit: "장르와 시청 비중 %",
    missing: "장르 연결이 없거나 분모 0이면 선호 장르 없음.", caveat: "다중 장르 균등 배분은 분석상 가정이다. 장르 없는 콘텐츠는 분모에서 제외한다. 특정 월 선호 장르는 날짜별 콘텐츠 기록이 없어 계산 불가.", status: "ready",
  }),
];

const BASE_SEED_DEFINITIONS: Definition[] = BASE_SEED_INPUTS.map((item) => ({
  ...item,
  ...(SEED_AUTHORITY[item.id] ?? candidate("출처 미기재")),
}));

export const SEED_DEFINITIONS: Definition[] = [...BASE_SEED_DEFINITIONS, ...DICTIONARY_DEFINITIONS, ...CANDIDATE_DEFINITIONS];

export function renderDefinition(item: StoredDefinition): string {
  return [
    `[${item.kind}] ${item.name} (ID ${item.id}, v${item.version}, ${item.status})`,
    `별칭: ${item.aliases.join(", ") || "없음"}`,
    `설명: ${item.description}`,
    `테이블: ${item.tables.join(", ")}; 컬럼: ${item.columns.join(", ")}`,
    `JOIN: ${item.joins.join("; ") || "없음"}`,
    `SQL 조건/계산: ${item.rule}`,
    `분자: ${item.numerator ?? "해당 없음"}; 분모: ${item.denominator ?? "해당 없음"}`,
    `집계 단위: ${item.grain}; 기간: ${item.period}; 단위: ${item.unit}`,
    `결측/0 처리: ${item.missing}; 주의: ${item.caveat}`,
  ].join("\n");
}
