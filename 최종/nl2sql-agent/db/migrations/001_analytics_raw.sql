-- 원본 CSV 7개를 변형 없이 적재하는 analytics 스키마.
-- 타입은 2026-10-10 전수 프로파일링 결과 기준 (null 허용 여부, 선행 0 보존, 소수 표기 포함).
-- 지표 정의·파생 컬럼은 여기 두지 않는다 (06단계 Semantic Layer).

CREATE SCHEMA IF NOT EXISTS analytics;

CREATE TABLE IF NOT EXISTS analytics.user_dim (
  user_key            text PRIMARY KEY,
  signup_date         date     NOT NULL,
  signup_device_type  text     NOT NULL,
  gender_code         smallint NOT NULL,
  age_band            text     NOT NULL,
  push_opt_in_current smallint NOT NULL
);

CREATE TABLE IF NOT EXISTS analytics.content_dim (
  content_key  text PRIMARY KEY,
  channel_type text NOT NULL,
  content_id   text,
  program_id   text,
  title        text,
  channel_id   text,
  channel_name text,
  section      text,
  target_age   numeric(4, 1) -- 원본이 "15.0" 형식
);

CREATE TABLE IF NOT EXISTS analytics.content_genre_bridge (
  content_key  text NOT NULL REFERENCES analytics.content_dim (content_key),
  genre_code   text NOT NULL, -- 선행 0 보존 ("06")
  genre_name   text NOT NULL,
  genre_source text NOT NULL,
  PRIMARY KEY (content_key, genre_code)
);

CREATE TABLE IF NOT EXISTS analytics.behavior_fact (
  user_key            text     NOT NULL REFERENCES analytics.user_dim (user_key),
  event_date          date     NOT NULL,
  relative_signup_day integer  NOT NULL,
  behavior_type       text     NOT NULL,
  event_count         integer  NOT NULL,
  export_part         smallint NOT NULL,
  PRIMARY KEY (user_key, event_date, behavior_type)
);

CREATE TABLE IF NOT EXISTS analytics.payment_fact (
  payment_key               text PRIMARY KEY,
  user_key                  text           NOT NULL REFERENCES analytics.user_dim (user_key),
  payment_date              date           NOT NULL,
  relative_signup_day       integer        NOT NULL,
  payment_order             integer        NOT NULL,
  source_user_type          text           NOT NULL,
  product_code              text           NOT NULL,
  product_name              text           NOT NULL,
  transaction_amount        numeric(12, 2) NOT NULL,
  cash_paid_amount          numeric(12, 2) NOT NULL,
  coin_used_amount          numeric(12, 2) NOT NULL,
  bonus_used_amount         numeric(12, 2) NOT NULL,
  discount_amount           numeric(12, 2) NOT NULL,
  promotion_discount_amount numeric(12, 2) NOT NULL,
  currency_type_id          smallint       NOT NULL,
  payment_device_type       text,
  market_type_id            integer        NOT NULL,
  partner_type_id           integer        NOT NULL,
  promotion_id              text,          -- '0'과 NULL이 공존 (원본 유지)
  package_type_id           text           NOT NULL, -- 비트 문자열, 선행 0 보존
  screen_quality_type_id    text           NOT NULL,
  screen_type_id            text           NOT NULL,
  is_auto_payment           smallint       NOT NULL,
  service_start_date        date           NOT NULL,
  service_end_date          date           NOT NULL,
  service_duration_days     integer        NOT NULL,
  concurrent_watch_count    integer        NOT NULL
);

CREATE TABLE IF NOT EXISTS analytics.watch_daily_fact (
  user_key               text     NOT NULL REFERENCES analytics.user_dim (user_key),
  watch_date             date     NOT NULL,
  relative_signup_day    integer  NOT NULL,
  channel_type           text     NOT NULL,
  watch_time_raw         integer  NOT NULL,
  watch_log_count        integer  NOT NULL,
  distinct_content_count integer  NOT NULL,
  active_hour_count      integer  NOT NULL,
  has_charged_watch      smallint NOT NULL,
  export_part            smallint NOT NULL,
  PRIMARY KEY (user_key, watch_date, channel_type)
);

CREATE TABLE IF NOT EXISTS analytics.user_content_summary (
  user_key             text     NOT NULL REFERENCES analytics.user_dim (user_key),
  channel_type         text     NOT NULL,
  content_key          text     NOT NULL REFERENCES analytics.content_dim (content_key),
  total_watch_time_raw integer  NOT NULL,
  watch_log_count      integer  NOT NULL,
  watch_day_count      integer  NOT NULL,
  first_watch_day      integer  NOT NULL,
  last_watch_day       integer  NOT NULL,
  has_charged_watch    smallint NOT NULL,
  export_part          smallint NOT NULL,
  PRIMARY KEY (user_key, content_key)
);

-- 조회 패턴용 보조 인덱스 (기본키 선두 컬럼이 아닌 것만)
CREATE INDEX IF NOT EXISTS payment_fact_user_idx ON analytics.payment_fact (user_key, payment_order);
CREATE INDEX IF NOT EXISTS payment_fact_date_idx ON analytics.payment_fact (payment_date);
CREATE INDEX IF NOT EXISTS behavior_fact_type_idx ON analytics.behavior_fact (behavior_type, relative_signup_day);
CREATE INDEX IF NOT EXISTS watch_daily_fact_date_idx ON analytics.watch_daily_fact (watch_date);
CREATE INDEX IF NOT EXISTS user_content_summary_content_idx ON analytics.user_content_summary (content_key);
CREATE INDEX IF NOT EXISTS user_dim_signup_idx ON analytics.user_dim (signup_date);
