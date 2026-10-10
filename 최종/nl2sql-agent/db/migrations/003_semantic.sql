CREATE SCHEMA IF NOT EXISTS semantic;

CREATE TABLE IF NOT EXISTS semantic.revision (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  value bigint NOT NULL DEFAULT 1
);
INSERT INTO semantic.revision (singleton, value) VALUES (true, 1) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS semantic.definitions (
  id text PRIMARY KEY,
  body jsonb NOT NULL,
  version integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS semantic.agent_runs (
  request_id uuid PRIMARY KEY,
  log jsonb NOT NULL,
  approved boolean NOT NULL DEFAULT false,
  approved_revision bigint,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agent_runs_recent_idx ON semantic.agent_runs (created_at DESC);

-- SQL 실행 계정에는 semantic 스키마 권한을 부여하지 않는다.
