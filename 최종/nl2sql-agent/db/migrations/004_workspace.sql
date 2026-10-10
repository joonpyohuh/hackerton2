BEGIN;
CREATE SCHEMA IF NOT EXISTS workspace;
CREATE TABLE IF NOT EXISTS workspace.users (
  id uuid PRIMARY KEY, email text UNIQUE NOT NULL, name text NOT NULL,
  password_hash text NOT NULL, role text NOT NULL CHECK (role IN ('marketer','analyst')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS workspace.sessions (
  token_hash text PRIMARY KEY, user_id uuid NOT NULL REFERENCES workspace.users(id),
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON workspace.sessions(expires_at);
CREATE TABLE IF NOT EXISTS workspace.login_attempts (
  key text PRIMARY KEY, attempts integer NOT NULL DEFAULT 1, started_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS workspace.analyses (
  id uuid PRIMARY KEY, owner_id uuid NOT NULL REFERENCES workspace.users(id),
  title text NOT NULL, response jsonb NOT NULL, definitions jsonb NOT NULL DEFAULT '[]',
  schema_version text, saved boolean NOT NULL DEFAULT false, shared boolean NOT NULL DEFAULT false,
  review_status text CHECK (review_status IN ('requested','in_review','changes_requested','approved','rejected')),
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS analyses_owner_idx ON workspace.analyses(owner_id,created_at DESC);
CREATE TABLE IF NOT EXISTS workspace.review_events (
  id uuid PRIMARY KEY, analysis_id uuid NOT NULL REFERENCES workspace.analyses(id),
  actor_id uuid NOT NULL REFERENCES workspace.users(id), status text NOT NULL,
  message text NOT NULL, proposed_sql text, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS workspace.definition_changes (
  id uuid PRIMARY KEY, definition_id text NOT NULL, base_version integer NOT NULL,
  body jsonb NOT NULL, reason text NOT NULL, author_id uuid NOT NULL REFERENCES workspace.users(id),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  reviewer_id uuid REFERENCES workspace.users(id), review_note text,
  created_at timestamptz NOT NULL DEFAULT now(), reviewed_at timestamptz
);
CREATE TABLE IF NOT EXISTS semantic.definition_versions (
  id text NOT NULL, version integer NOT NULL, body jsonb NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(id,version)
);
INSERT INTO semantic.definition_versions(id,version,body)
  SELECT id,version,body FROM semantic.definitions ON CONFLICT DO NOTHING;
CREATE OR REPLACE FUNCTION semantic.archive_definition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN
    INSERT INTO semantic.definition_versions(id,version,body) VALUES(OLD.id,OLD.version,OLD.body) ON CONFLICT DO NOTHING;
  END IF;
  IF TG_OP <> 'DELETE' THEN
    INSERT INTO semantic.definition_versions(id,version,body) VALUES(NEW.id,NEW.version,NEW.body) ON CONFLICT DO NOTHING;
  END IF;
  RETURN NULL;
END $$;
DROP TRIGGER IF EXISTS archive_definition ON semantic.definitions;
CREATE TRIGGER archive_definition AFTER INSERT OR UPDATE OR DELETE ON semantic.definitions FOR EACH ROW EXECUTE FUNCTION semantic.archive_definition();
ALTER TABLE semantic.agent_runs ADD COLUMN IF NOT EXISTS schema_version text;
GRANT USAGE ON SCHEMA workspace TO nl2sql_app;
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA workspace TO nl2sql_app;
GRANT SELECT,INSERT ON semantic.definition_versions TO nl2sql_app;
COMMIT;
