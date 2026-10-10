/**
 * 데이터 특성 노트 v0 — 2026-10-10 원본 CSV 전수 프로파일링으로 **검증한 사실**만 적는다.
 * 지표 정의(유지율·전환율·매출 등)는 여기 두지 않는다 → 06단계 Semantic Layer에서 승인 후 등록.
 * 의미가 확인되지 않은 코드값은 "미확인"으로 명시해, 모델이 추측하지 않고 확인 질문을 하도록 한다.
 */
export const DATA_NOTES_VERSION = "data-notes.v0";

/**
 * 날짜 컬럼별 관측 범위 — 2026-10-10 운영 Neon(analytics) min/max 조회로 확인.
 * 저장된 날짜는 개인정보 보호를 위해 실제보다 365일 이동된 값이다(문제 PDF 데이터 설명 (7)).
 * 요청 기간이 이 범위를 벗어나면 Semantic Resolver가 계산하지 않고 이유를 설명한다.
 */
export const DATA_COVERAGE = {
  signup_date: { start: "2025-02-01", end: "2025-04-01" },
  payment_date: { start: "2025-02-01", end: "2025-06-28" },
  watch_date: { start: "2025-02-01", end: "2025-05-31" },
  event_date: { start: "2025-02-01", end: "2025-05-01" },
} as const;
export type CoverageColumn = keyof typeof DATA_COVERAGE;

export const DATA_NOTES = `
[전체]
- 2025-02-01 ~ 2025-04-01 가입자 50,000명 단일 코호트. 모든 fact의 user_key는 user_dim에 존재.
- relative_signup_day = 해당 날짜 − signup_date (일 단위). 모든 테이블에서 불일치 0건.
- 테이블별 관측 범위가 다르다: behavior_fact 가입 후 0~30일, watch_daily_fact 0~60일, payment_fact 0~90일.
  서로 다른 테이블을 비교할 때는 같은 relative_signup_day 범위로 맞춰야 한다.
  같은 고객의 event 날짜를 절대 날짜로 비교하는 것은 relative_signup_day로 비교하는 것과 동등하다. 예: 첫 결제일~+7일의 시청은 watch_date BETWEEN payment_date AND payment_date + 7로 판정할 수 있다.
- export_part 컬럼은 추출 분할 번호이며 분석에 사용하지 않는다.

[user_dim]
- age_band 값: UNDER_14, 14_19, 20_29, 30_39, 40_49, 50_59, 60_69, 70_PLUS, UNKNOWN. UNKNOWN이 63.7%.
- gender_code 값 0/1/2. 각 숫자의 의미(남·녀)는 미확인 — 성별 이름으로 해석하지 말 것. 0은 age_band UNKNOWN과 항상 함께 나타난다.
- signup_device_type 값: mobile, android, ios, pc. push_opt_in_current는 0/1이며 추출 시점 기준.

[payment_fact]
- 결제 14,388건, 결제 유저 12,933명. payment_order = 1은 유저별 첫 결제(유저당 정확히 1건).
- currency_type_id 1과 2는 금액 단위가 다르다(2는 4.99 같은 소수 금액). 통화의 의미는 미확인 — 금액을 합산할 때는 currency_type_id별로 나눈다.
- transaction_amount ≠ cash_paid_amount + coin_used_amount + bonus_used_amount 인 행이 5,583건(제휴 번들 등). "매출" 정의는 미확정.
- discount_amount는 모든 행이 0. 할인은 promotion_discount_amount에 있다.
- promotion_id는 '0'과 NULL이 함께 존재한다.
- product_name이 같지만 product_code가 다른 상품이 5종(더블 시리즈) 있다.

[시청: watch_daily_fact, user_content_summary]
- 시청 기록이 있는 유저는 17,889명(전체의 35.8%).
- watch_time_raw, total_watch_time_raw의 단위는 미확인(초로 추정되나 확정 아님) — 시간 단위로 환산해 표현하지 말 것.
- 두 테이블의 유저×channel_type별 시청시간·로그 수 합계는 100% 일치한다.
- channel_type V/M/L은 content_key 접두어 PROGRAM|/MOVIE|/LIVE|와 일대일 대응한다.

[콘텐츠: content_dim, content_genre_bridge]
- 콘텐츠당 장르가 평균 3.07개(최대 16개). 장르로 JOIN한 뒤 시청시간 등을 합산하면 중복 집계된다.
- genre_source가 LIVE_CHANNEL_GENRE인 행은 genre_name이 코드값("06" 등)이다.
- content_key 'LIVE|', 'PROGRAM|'은 ID가 빈 자리표시자 행이다.
`.trim();
