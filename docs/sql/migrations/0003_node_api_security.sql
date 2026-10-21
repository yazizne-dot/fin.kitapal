BEGIN;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM qarzhy.schema_migrations WHERE version='0001_relational_finance')
     OR NOT EXISTS (SELECT 1 FROM qarzhy.schema_migrations WHERE version='0002_relational_source_resolution')
  THEN
    RAISE EXCEPTION 'Expected relational finance migrations 0001 and 0002';
  END IF;
END $$;

ALTER TABLE qarzhy.users ADD COLUMN IF NOT EXISTS password_changed_at timestamptz;

CREATE TABLE IF NOT EXISTS qarzhy.login_attempts (
  subject_hash bytea PRIMARY KEY CHECK (octet_length(subject_hash)=32),
  failed_count integer NOT NULL DEFAULT 0 CHECK (failed_count>=0),
  blocked_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS login_attempts_updated_idx ON qarzhy.login_attempts(updated_at);

INSERT INTO qarzhy.schema_migrations(version)
VALUES ('0003_node_api_security') ON CONFLICT (version) DO NOTHING;
COMMIT;
