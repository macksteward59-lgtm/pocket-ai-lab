-- PostgreSQL migration: namespaced, versioned East task lifecycle snapshots.
-- Run through the host's reviewed migration process; this file does not execute itself.

CREATE TABLE IF NOT EXISTS pocket_task_lifecycle_snapshots (
  namespace TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL CHECK (schema_version > 0),
  record_version BIGINT NOT NULL DEFAULT 0 CHECK (record_version >= 0),
  payload JSONB NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(payload) = 'array'),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE pocket_task_lifecycle_snapshots IS
  'Versioned lifecycle snapshots. Workflow state is not APEX authorization or signed evidence.';
