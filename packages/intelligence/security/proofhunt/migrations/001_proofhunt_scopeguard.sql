-- ProofHunt 1.1 authorization and assessment ledger.
-- Apply only after provisioning a trusted schema owner and project-scoped
-- application role. This migration creates no scanner runtime.

CREATE SCHEMA IF NOT EXISTS proofhunt;

CREATE TABLE proofhunt.authorization_records (
  record_id UUID PRIMARY KEY,
  project_id TEXT NOT NULL,
  record_kind TEXT NOT NULL CHECK (record_kind IN ('bug_bounty_program', 'asset_ownership', 'operational_approval')),
  environment TEXT NOT NULL CHECK (environment IN ('bounty', 'owned')),
  subject_id TEXT NOT NULL,
  parent_program_authorization_id UUID,
  evidence_reference TEXT NOT NULL,
  source_revision TEXT NOT NULL,
  permitted_checks TEXT[],
  permitted_checks_reviewed_by TEXT,
  permitted_checks_review_reference TEXT,
  scope_policy_snapshot JSONB,
  scope_policy_hash CHAR(64),
  record_status TEXT NOT NULL CHECK (record_status IN ('pending', 'verified', 'approved', 'revoked', 'expired')),
  policy_version TEXT,
  policy_hash CHAR(64),
  target_scope_hash CHAR(64),
  approved_by TEXT,
  approval_reference TEXT,
  signature_reference TEXT,
  verified_at TIMESTAMPTZ,
  approved_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (project_id, record_id),
  UNIQUE (project_id, record_id, policy_version, policy_hash),
  FOREIGN KEY (project_id, parent_program_authorization_id)
    REFERENCES proofhunt.authorization_records(project_id, record_id),
  CHECK (
    (
      record_kind = 'operational_approval'
      AND parent_program_authorization_id IS NOT NULL
      AND policy_version IS NOT NULL
      AND policy_hash IS NOT NULL
      AND policy_hash ~ '^[a-f0-9]{64}
      AND approval_reference IS NOT NULL
      AND signature_reference IS NOT NULL
      AND approved_at IS NOT NULL
      AND permitted_checks IS NULL
      AND permitted_checks_reviewed_by IS NULL
      AND permitted_checks_review_reference IS NULL
      AND scope_policy_snapshot IS NULL
      AND scope_policy_hash IS NULL
    )
    OR
    (
      record_kind = 'bug_bounty_program'
      AND environment = 'bounty'
      AND parent_program_authorization_id IS NULL
      AND permitted_checks IS NOT NULL
      AND cardinality(permitted_checks) > 0
      AND permitted_checks_reviewed_by IS NOT NULL
      AND permitted_checks_review_reference IS NOT NULL
      AND scope_policy_snapshot IS NOT NULL
      AND scope_policy_hash IS NOT NULL
      AND scope_policy_hash ~ '^[a-f0-9]{64}$'
      AND scope_policy_snapshot -> 'authorized' = 'false'::JSONB
      AND policy_hash IS NULL
      AND target_scope_hash IS NULL
    )
    OR
    (
      record_kind = 'asset_ownership'
      AND environment = 'owned'
      AND parent_program_authorization_id IS NULL
      AND permitted_checks IS NOT NULL
      AND cardinality(permitted_checks) > 0
      AND permitted_checks_reviewed_by IS NOT NULL
      AND permitted_checks_review_reference IS NOT NULL
      AND scope_policy_snapshot IS NULL
      AND scope_policy_hash IS NULL
      AND policy_hash IS NULL
      AND target_scope_hash IS NULL
    )
  )
);

CREATE TABLE proofhunt.authorized_targets (
  target_id UUID PRIMARY KEY,
  project_id TEXT NOT NULL,
  authorization_record_id UUID NOT NULL,
  hostname TEXT NOT NULL,
  include_subdomains BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (project_id, authorization_record_id, hostname),
  UNIQUE (project_id, authorization_record_id, target_id),
  FOREIGN KEY (project_id, authorization_record_id)
    REFERENCES proofhunt.authorization_records(project_id, record_id)
);

CREATE TABLE proofhunt.excluded_targets (
  exclusion_id UUID PRIMARY KEY,
  project_id TEXT NOT NULL,
  authorization_record_id UUID NOT NULL,
  hostname TEXT NOT NULL,
  include_subdomains BOOLEAN NOT NULL DEFAULT FALSE,
  exclusion_reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (project_id, authorization_record_id, hostname),
  FOREIGN KEY (project_id, authorization_record_id)
    REFERENCES proofhunt.authorization_records(project_id, record_id)
);

CREATE TABLE proofhunt.assessment_policies (
  policy_id UUID PRIMARY KEY,
  project_id TEXT NOT NULL,
  policy_version TEXT NOT NULL,
  policy_hash CHAR(64) NOT NULL CHECK (policy_hash ~ '^[a-f0-9]{64}$'),
  program_authorization_id UUID NOT NULL,
  operational_authorization_id UUID NOT NULL,
  preapproved BOOLEAN NOT NULL DEFAULT FALSE,
  allowed_checks TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  max_requests_per_second NUMERIC(8,3) NOT NULL CHECK (max_requests_per_second > 0),
  max_concurrent_jobs INTEGER NOT NULL CHECK (max_concurrent_jobs > 0),
  stop_on_scope_violation BOOLEAN NOT NULL DEFAULT TRUE CHECK (stop_on_scope_violation = TRUE),
  effective_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (project_id, policy_version),
  UNIQUE (project_id, policy_id),
  UNIQUE (project_id, policy_id, policy_version, policy_hash, program_authorization_id, operational_authorization_id),
  FOREIGN KEY (project_id, program_authorization_id)
    REFERENCES proofhunt.authorization_records(project_id, record_id),
  FOREIGN KEY (project_id, operational_authorization_id)
    REFERENCES proofhunt.authorization_records(project_id, record_id),
  FOREIGN KEY (project_id, operational_authorization_id, policy_version, policy_hash)
    REFERENCES proofhunt.authorization_records(project_id, record_id, policy_version, policy_hash),
  CHECK (expires_at > effective_at),
  CHECK (program_authorization_id <> operational_authorization_id)
);

CREATE TABLE proofhunt.assessment_jobs (
  job_id UUID PRIMARY KEY,
  project_id TEXT NOT NULL,
  program_authorization_id UUID NOT NULL,
  operational_authorization_id UUID NOT NULL,
  policy_id UUID NOT NULL,
  policy_version TEXT NOT NULL,
  policy_hash CHAR(64) NOT NULL CHECK (policy_hash ~ '^[a-f0-9]{64}$'),
  authorized_target_id UUID,
  target_hostname TEXT NOT NULL,
  check_type TEXT NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('approved_plan', 'denied')),
  decision_reason TEXT NOT NULL,
  job_status TEXT NOT NULL CHECK (job_status IN ('planned', 'queued', 'running', 'completed', 'cancelled', 'failed', 'stopped')),
  decision_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (project_id, job_id),
  FOREIGN KEY (project_id, program_authorization_id)
    REFERENCES proofhunt.authorization_records(project_id, record_id),
  FOREIGN KEY (project_id, operational_authorization_id)
    REFERENCES proofhunt.authorization_records(project_id, record_id),
  FOREIGN KEY (project_id, policy_id, policy_version, policy_hash, program_authorization_id, operational_authorization_id)
    REFERENCES proofhunt.assessment_policies(project_id, policy_id, policy_version, policy_hash, program_authorization_id, operational_authorization_id),
  FOREIGN KEY (project_id, operational_authorization_id, authorized_target_id)
    REFERENCES proofhunt.authorized_targets(project_id, authorization_record_id, target_id),
  CHECK (program_authorization_id <> operational_authorization_id),
  CHECK (decision <> 'approved_plan' OR authorized_target_id IS NOT NULL)
);

CREATE TABLE proofhunt.assessment_events (
  event_id UUID PRIMARY KEY,
  project_id TEXT NOT NULL,
  job_id UUID NOT NULL,
  event_sequence BIGINT NOT NULL CHECK (event_sequence >= 0),
  event_type TEXT NOT NULL,
  details JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (project_id, job_id, event_sequence),
  FOREIGN KEY (project_id, job_id)
    REFERENCES proofhunt.assessment_jobs(project_id, job_id)
);

CREATE TABLE proofhunt.audit_events (
  event_id UUID PRIMARY KEY,
  project_id TEXT NOT NULL,
  sequence BIGINT NOT NULL CHECK (sequence >= 0),
  previous_hash TEXT NOT NULL CHECK (
    previous_hash = 'GENESIS' OR previous_hash ~ '^[a-f0-9]{64}$'
  ),
  event_hash CHAR(64) NOT NULL CHECK (event_hash ~ '^[a-f0-9]{64}$'),
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (project_id, sequence),
  UNIQUE (project_id, event_hash)
);

CREATE TABLE proofhunt.validation_results (
  validation_id UUID PRIMARY KEY,
  project_id TEXT NOT NULL,
  job_id UUID NOT NULL,
  finding_reference TEXT NOT NULL,
  validation_state TEXT NOT NULL CHECK (
    validation_state IN ('detected', 'corroborated', 'reproduced', 'confirmed', 'rejected')
  ),
  confidence NUMERIC(4,3) CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  evidence_references JSONB NOT NULL DEFAULT '[]'::JSONB,
  counter_evidence JSONB NOT NULL DEFAULT '[]'::JSONB,
  validator_reference TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (project_id, job_id)
    REFERENCES proofhunt.assessment_jobs(project_id, job_id)
);

DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'authorization_records',
    'authorized_targets',
    'excluded_targets',
    'assessment_policies',
    'assessment_jobs',
    'assessment_events',
    'audit_events',
    'validation_results'
  ]
  LOOP
    EXECUTE format('ALTER TABLE proofhunt.%I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE proofhunt.%I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY project_isolation ON proofhunt.%I USING (project_id = nullif(current_setting(''app.project_id'', true), '''')) WITH CHECK (project_id = nullif(current_setting(''app.project_id'', true), ''''))',
      table_name
    );
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION proofhunt.reject_append_only_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'ProofHunt history records are append-only';
END;
$$;

DO $$
DECLARE
  table_name TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'authorization_records',
    'authorized_targets',
    'excluded_targets',
    'assessment_policies',
    'assessment_events',
    'audit_events',
    'validation_results'
  ]
  LOOP
    EXECUTE format(
      'CREATE TRIGGER proofhunt_append_only BEFORE UPDATE OR DELETE ON proofhunt.%I FOR EACH ROW EXECUTE FUNCTION proofhunt.reject_append_only_mutation()',
      table_name
    );
  END LOOP;
END $$;

CREATE INDEX assessment_jobs_project_status_idx
  ON proofhunt.assessment_jobs (project_id, job_status, created_at);
CREATE INDEX assessment_jobs_authorization_idx
  ON proofhunt.assessment_jobs (project_id, program_authorization_id, operational_authorization_id, policy_version, policy_hash);
CREATE INDEX assessment_events_job_sequence_idx
  ON proofhunt.assessment_events (project_id, job_id, event_sequence);
CREATE INDEX validation_results_job_state_idx
  ON proofhunt.validation_results (project_id, job_id, validation_state);
