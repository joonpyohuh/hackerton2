-- LLM 생성 SQL 실행 전용 읽기 전용 계정. 보안은 AST 검사가 아니라 이 권한이 최종적으로 강제한다.
-- 비밀번호는 저장소에 두지 않는다: scripts/db-setup.ts가 무작위로 생성해 :reader_password 자리에 넣는다.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nl2sql_reader') THEN
    CREATE ROLE nl2sql_reader LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
      NOINHERIT NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 10;
  END IF;
END $$;

-- Neon lets the database owner set a role password, but restricts altering role flags.
ALTER ROLE nl2sql_reader WITH PASSWORD :'reader_password';

-- 세션 기본값: 읽기 전용 트랜잭션, 실행 시간 제한, analytics만 보이는 search_path
ALTER ROLE nl2sql_reader SET default_transaction_read_only = on;
ALTER ROLE nl2sql_reader SET statement_timeout = '5s';
ALTER ROLE nl2sql_reader SET idle_in_transaction_session_timeout = '10s';
ALTER ROLE nl2sql_reader SET search_path = analytics;

-- 권한: analytics 스키마 SELECT만. public 등 다른 스키마는 회수.
REVOKE ALL ON SCHEMA public FROM nl2sql_reader;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA analytics TO nl2sql_reader;
REVOKE ALL ON ALL TABLES IN SCHEMA analytics FROM nl2sql_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA analytics TO nl2sql_reader;
ALTER DEFAULT PRIVILEGES IN SCHEMA analytics GRANT SELECT ON TABLES TO nl2sql_reader;
