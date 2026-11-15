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
  approved_by TEXT,
  approval_reference TEXT,
  signature_reference TEXT,
  verified_at TIMESTAMPTZ,
  approved_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (project_id, record_id),
  UNIQUE (project_id, record_id, policy_version, policy_hash),
  UNIQUE (project_id, record_id, scope_policy_hash),
  FOREIGN KEY (project_id, parent_program_authorization_id)
    REFERENCES proofhunt.authorization_records(project_id, record_id),
  CHECK (
    (
      record_kind = 'operational_approval'
      AND parent_program_authorization_id IS NOT NULL
      AND policy_version IS NOT NULL
      AND policy_hash IS NOT NULL
      AND policy_hash ~ '^[a-f0-9]{64}$'
      AND approved_by IS NOT NULL
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
    )
  )
);

-- Revocation is an append-only event so authorization records remain immutable.
-- Trusted program/ownership and operational verifiers must deny any record with
-- a matching revocation row; a replacement authorization receives a new ID.
CREATE TABLE proofhunt.authorization_revocations (
  revocation_id UUID PRIMARY KEY,
  project_id TEXT NOT NULL,
  authorization_record_id UUID NOT NULL,
  revoked_at TIMESTAMPTZ NOT NULL,
  revoked_by TEXT NOT NULL,
  reason TEXT NOT NULL,
  evidence_reference TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (project_id, authorization_record_id),
  FOREIGN KEY (project_id, authorization_record_id)
    REFERENCES proofhunt.authorization_records(project_id, record_id)
);

-- Serialize authorization revocation with approved-job admission without
-- granting the runtime role UPDATE permission on immutable authorization rows.
CREATE OR REPLACE FUNCTION proofhunt.lock_authorization_revocation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(
    'proofhunt:' || NEW.project_id || ':' || NEW.authorization_record_id::TEXT, 0
  ));
  RETURN NEW;
END;
$$;

CREATE TRIGGER proofhunt_authorization_revocation_lock
  BEFORE INSERT ON proofhunt.authorization_revocations
  FOR EACH ROW EXECUTE FUNCTION proofhunt.lock_authorization_revocation();

CREATE TABLE proofhunt.authorized_targets (
  target_id UUID PRIMARY KEY,
  project_id TEXT NOT NULL,
  authorization_record_id UUID NOT NULL,
  hostname TEXT NOT NULL,
  include_subdomains BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (project_id, authorization_record_id, hostname),
  UNIQUE (project_id, authorization_record_id, target_id),
  UNIQUE (project_id, authorization_record_id, target_id, hostname),
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
  check_type TEXT NOT NULL,
  authorized_target_id UUID,
  authorized_target_hostname TEXT,
  target_hostname TEXT NOT NULL,
  program_scope_hash CHAR(64) CHECK (program_scope_hash IS NULL OR program_scope_hash ~ '^[a-f0-9]{64}$'),
  decision TEXT NOT NULL CHECK (decision IN ('approved_plan', 'denied')),
  decision_reason TEXT NOT NULL,
  job_status TEXT NOT NULL CHECK (job_status IN ('planned', 'queued', 'running', 'completed', 'cancelled', 'failed', 'stopped')),
  decision_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (project_id, job_id),
  FOREIGN KEY (project_id, program_authorization_id)
    REFERENCES proofhunt.authorization_records(project_id, record_id),
  FOREIGN KEY (project_id, program_authorization_id, program_scope_hash)
    REFERENCES proofhunt.authorization_records(project_id, record_id, scope_policy_hash),
  FOREIGN KEY (project_id, operational_authorization_id)
    REFERENCES proofhunt.authorization_records(project_id, record_id),
  FOREIGN KEY (project_id, policy_id, policy_version, policy_hash, program_authorization_id, operational_authorization_id)
    REFERENCES proofhunt.assessment_policies(project_id, policy_id, policy_version, policy_hash, program_authorization_id, operational_authorization_id),
  FOREIGN KEY (project_id, program_authorization_id, authorized_target_id, authorized_target_hostname)
    REFERENCES proofhunt.authorized_targets(project_id, authorization_record_id, target_id, hostname),
  CHECK (program_authorization_id <> operational_authorization_id),
  CHECK (decision <> 'approved_plan' OR
    (authorized_target_id IS NOT NULL AND authorized_target_hostname IS NOT NULL)),
  CHECK ((authorized_target_id IS NULL) = (authorized_target_hostname IS NULL))
);

CREATE OR REPLACE FUNCTION proofhunt.validate_assessment_job_target()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  allowed_subdomains BOOLEAN;
  target_is_excluded BOOLEAN;
  program_kind TEXT;
  program_status TEXT;
  program_expires_at TIMESTAMPTZ;
  stored_program_scope_hash CHAR(64);
  program_scope_snapshot JSONB;
  program_environment TEXT;
  program_checks TEXT[];
  operational_kind TEXT;
  operational_status TEXT;
  operational_expires_at TIMESTAMPTZ;
  operational_parent UUID;
  operational_environment TEXT;
  operational_policy_version TEXT;
  operational_policy_hash CHAR(64);
  policy_preapproved BOOLEAN;
  policy_checks TEXT[];
  policy_effective_at TIMESTAMPTZ;
  policy_expires_at TIMESTAMPTZ;
  policy_stop_on_scope_violation BOOLEAN;
  authorization_revoked BOOLEAN;
  program_scope_included BOOLEAN;
  program_scope_excluded BOOLEAN;
  program_path_scoped BOOLEAN;
BEGIN
  IF NEW.decision <> 'approved_plan' THEN
    RETURN NEW;
  END IF;

  -- Acquire both authorization locks in stable order. Revocation insertion
  -- takes the same per-record lock, preventing a check/insert race.
  IF NEW.program_authorization_id::TEXT < NEW.operational_authorization_id::TEXT THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('proofhunt:' || NEW.project_id || ':' || NEW.program_authorization_id::TEXT, 0));
    PERFORM pg_advisory_xact_lock(hashtextextended('proofhunt:' || NEW.project_id || ':' || NEW.operational_authorization_id::TEXT, 0));
  ELSE
    PERFORM pg_advisory_xact_lock(hashtextextended('proofhunt:' || NEW.project_id || ':' || NEW.operational_authorization_id::TEXT, 0));
    PERFORM pg_advisory_xact_lock(hashtextextended('proofhunt:' || NEW.project_id || ':' || NEW.program_authorization_id::TEXT, 0));
  END IF;

  SELECT record_kind, record_status, expires_at, scope_policy_hash,
         scope_policy_snapshot, permitted_checks, environment
  INTO program_kind, program_status, program_expires_at, stored_program_scope_hash,
       program_scope_snapshot, program_checks, program_environment
  FROM proofhunt.authorization_records
  WHERE project_id = NEW.project_id AND record_id = NEW.program_authorization_id;
  IF NOT FOUND OR program_status <> 'verified' OR program_expires_at <= CURRENT_TIMESTAMP THEN
    RAISE EXCEPTION 'ProofHunt program/ownership authorization is missing, unverified, or expired';
  END IF;
  IF NEW.check_type <> ALL(program_checks) THEN
    RAISE EXCEPTION 'ProofHunt check is not included in the reviewed program/ownership permissions';
  END IF;

  SELECT record_kind, record_status, expires_at, parent_program_authorization_id,
         environment, policy_version, policy_hash
  INTO operational_kind, operational_status, operational_expires_at, operational_parent,
       operational_environment, operational_policy_version, operational_policy_hash
  FROM proofhunt.authorization_records
  WHERE project_id = NEW.project_id AND record_id = NEW.operational_authorization_id;
  IF NOT FOUND OR operational_kind <> 'operational_approval' OR
     operational_status <> 'approved' OR operational_expires_at <= CURRENT_TIMESTAMP OR
     operational_parent <> NEW.program_authorization_id OR
     operational_environment <> program_environment OR
     operational_policy_version <> NEW.policy_version OR
     operational_policy_hash <> NEW.policy_hash THEN
    RAISE EXCEPTION 'ProofHunt operational approval is missing, revoked, expired, or mismatched';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM proofhunt.authorization_revocations r
    WHERE r.project_id = NEW.project_id
      AND r.authorization_record_id IN (NEW.program_authorization_id, NEW.operational_authorization_id)
  ) INTO authorization_revoked;
  IF authorization_revoked THEN
    RAISE EXCEPTION 'ProofHunt authorization has been revoked';
  END IF;

  SELECT preapproved, allowed_checks, effective_at, expires_at, stop_on_scope_violation
  INTO policy_preapproved, policy_checks, policy_effective_at, policy_expires_at,
       policy_stop_on_scope_violation
  FROM proofhunt.assessment_policies
  WHERE project_id = NEW.project_id AND policy_id = NEW.policy_id;
  IF NOT FOUND OR NOT policy_preapproved OR NEW.check_type <> ALL(policy_checks) OR
     policy_effective_at > CURRENT_TIMESTAMP OR policy_expires_at <= CURRENT_TIMESTAMP OR
     NOT policy_stop_on_scope_violation THEN
    RAISE EXCEPTION 'ProofHunt operational policy is not currently active or does not permit this check';
  END IF;

  IF program_kind = 'bug_bounty_program' THEN
    IF NEW.program_scope_hash IS NULL OR NEW.program_scope_hash <> stored_program_scope_hash THEN
      RAISE EXCEPTION 'ProofHunt job does not bind the verified published program scope digest';
    END IF;
    IF program_scope_snapshot ? 'effectiveAt' AND
       (program_scope_snapshot->>'effectiveAt')::TIMESTAMPTZ > CURRENT_TIMESTAMP THEN
      RAISE EXCEPTION 'ProofHunt published program scope is not yet effective';
    END IF;
    IF program_scope_snapshot ? 'expiresAt' AND
       (program_scope_snapshot->>'expiresAt')::TIMESTAMPTZ <= CURRENT_TIMESTAMP THEN
      RAISE EXCEPTION 'ProofHunt published program scope has expired';
    END IF;
    IF NOT (program_scope_snapshot ? 'testingWindow') OR
       (program_scope_snapshot->'testingWindow'->>'startsAt') IS NULL OR
       (program_scope_snapshot->'testingWindow'->>'endsAt') IS NULL OR
       (program_scope_snapshot->'testingWindow'->>'startsAt')::TIMESTAMPTZ > CURRENT_TIMESTAMP OR
       (program_scope_snapshot->'testingWindow'->>'endsAt')::TIMESTAMPTZ <= CURRENT_TIMESTAMP THEN
      RAISE EXCEPTION 'ProofHunt published program testing window is not currently active';
    END IF;

    -- Re-evaluate published scope in the database as a second admission gate.
    -- Host-only plans reject matching path-scoped URL rules rather than guessing.
    SELECT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(program_scope_snapshot->'inScope' || program_scope_snapshot->'outOfScope') AS rules(rule)
      WHERE rule->>'kind' = 'url'
        AND (regexp_match(rule->>'value', '^https?://([^/]+)(/.*)$'))[2] <> '/'
        AND (
          lower(rtrim((regexp_match(rule->>'value', '^https?://([^/]+)(/.*)$'))[1], '.')) = NEW.target_hostname
          OR (
            coalesce((rule->>'includeSubdomains')::BOOLEAN, FALSE)
            AND right(NEW.target_hostname, length(lower(rtrim((regexp_match(rule->>'value', '^https?://([^/]+)(/.*)$'))[1], '.'))) + 1)
              = '.' || lower(rtrim((regexp_match(rule->>'value', '^https?://([^/]+)(/.*)$'))[1], '.'))
          )
        )
    ) INTO program_path_scoped;
    IF program_path_scoped THEN
      RAISE EXCEPTION 'ProofHunt target has unresolved path-scoped program rules';
    END IF;

    SELECT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(program_scope_snapshot->'outOfScope') AS rules(rule)
      WHERE (
        rule->>'kind' = 'domain'
        AND (
          (coalesce((rule->>'includeApex')::BOOLEAN, TRUE) AND lower(rtrim(rule->>'value', '.')) = NEW.target_hostname)
          OR (coalesce((rule->>'includeSubdomains')::BOOLEAN, FALSE)
            AND right(NEW.target_hostname, length(lower(rtrim(rule->>'value', '.'))) + 1)
              = '.' || lower(rtrim(rule->>'value', '.')))
        )
      ) OR (
        rule->>'kind' = 'url'
        AND (regexp_match(rule->>'value', '^https://([^/]+)(/.*)$'))[2] = '/'
        AND (
          lower(rtrim((regexp_match(rule->>'value', '^https://([^/]+)(/.*)$'))[1], '.')) = NEW.target_hostname
          OR (coalesce((rule->>'includeSubdomains')::BOOLEAN, FALSE)
            AND right(NEW.target_hostname, length(lower(rtrim((regexp_match(rule->>'value', '^https://([^/]+)(/.*)$'))[1], '.'))) + 1)
              = '.' || lower(rtrim((regexp_match(rule->>'value', '^https://([^/]+)(/.*)$'))[1], '.')))
        )
      )
    ) INTO program_scope_excluded;
    IF program_scope_excluded THEN
      RAISE EXCEPTION 'ProofHunt target is excluded by the published program policy';
    END IF;

    SELECT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(program_scope_snapshot->'inScope') AS rules(rule)
      WHERE (
        rule->>'kind' = 'domain'
        AND (
          (coalesce((rule->>'includeApex')::BOOLEAN, TRUE) AND lower(rtrim(rule->>'value', '.')) = NEW.target_hostname)
          OR (coalesce((rule->>'includeSubdomains')::BOOLEAN, FALSE)
            AND right(NEW.target_hostname, length(lower(rtrim(rule->>'value', '.'))) + 1)
              = '.' || lower(rtrim(rule->>'value', '.')))
        )
      ) OR (
        rule->>'kind' = 'url'
        AND (regexp_match(rule->>'value', '^https://([^/]+)(/.*)$'))[2] = '/'
        AND (
          lower(rtrim((regexp_match(rule->>'value', '^https://([^/]+)(/.*)$'))[1], '.')) = NEW.target_hostname
          OR (coalesce((rule->>'includeSubdomains')::BOOLEAN, FALSE)
            AND right(NEW.target_hostname, length(lower(rtrim((regexp_match(rule->>'value', '^https://([^/]+)(/.*)$'))[1], '.'))) + 1)
              = '.' || lower(rtrim((regexp_match(rule->>'value', '^https://([^/]+)(/.*)$'))[1], '.')))
        )
      )
    ) INTO program_scope_included;
    IF NOT program_scope_included THEN
      RAISE EXCEPTION 'ProofHunt target is not explicitly included by the published program policy';
    END IF;
  ELSIF program_kind = 'asset_ownership' THEN
    IF NEW.program_scope_hash IS NOT NULL THEN
      RAISE EXCEPTION 'Owned-infrastructure job cannot claim a bounty program scope digest';
    END IF;
  ELSE
    RAISE EXCEPTION 'ProofHunt program authorization kind is unsupported';
  END IF;
  IF NEW.target_hostname <> lower(rtrim(NEW.target_hostname, '.')) OR
     NEW.authorized_target_hostname <> lower(rtrim(NEW.authorized_target_hostname, '.')) THEN
    RAISE EXCEPTION 'ProofHunt job hostnames must be canonical lowercase DNS/IP values';
  END IF;

  SELECT include_subdomains INTO allowed_subdomains
  FROM proofhunt.authorized_targets
  WHERE project_id = NEW.project_id
    AND authorization_record_id = NEW.program_authorization_id
    AND target_id = NEW.authorized_target_id
    AND hostname = NEW.authorized_target_hostname;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'ProofHunt approved job has no matching authorized target record';
  END IF;

  IF NEW.target_hostname <> NEW.authorized_target_hostname AND
     (NOT allowed_subdomains OR
      right(NEW.target_hostname, length(NEW.authorized_target_hostname) + 1)
        <> '.' || NEW.authorized_target_hostname) THEN
    RAISE EXCEPTION 'ProofHunt job target is outside the matched allowlist hostname';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM proofhunt.excluded_targets e
    WHERE e.project_id = NEW.project_id
      AND e.authorization_record_id = NEW.program_authorization_id
      AND (
        e.hostname = NEW.target_hostname OR
        (e.include_subdomains AND
         right(NEW.target_hostname, length(e.hostname) + 1) = '.' || e.hostname)
      )
  ) INTO target_is_excluded;

  IF target_is_excluded THEN
    RAISE EXCEPTION 'ProofHunt job target is explicitly excluded';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER proofhunt_job_target_guard
  BEFORE INSERT ON proofhunt.assessment_jobs
  FOR EACH ROW EXECUTE FUNCTION proofhunt.validate_assessment_job_target();

-- The job's authorization basis is immutable after admission. Only job_status
-- may advance; lifecycle details are appended to assessment_events.
CREATE OR REPLACE FUNCTION proofhunt.protect_assessment_job_basis()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'ProofHunt assessment jobs cannot be deleted';
  END IF;
  IF (to_jsonb(NEW) - 'job_status') IS DISTINCT FROM (to_jsonb(OLD) - 'job_status') THEN
    RAISE EXCEPTION 'ProofHunt assessment job authorization basis is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER proofhunt_job_basis_immutable
  BEFORE UPDATE OR DELETE ON proofhunt.assessment_jobs
  FOR EACH ROW EXECUTE FUNCTION proofhunt.protect_assessment_job_basis();

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
  previous_hash CHAR(64) NOT NULL,
  event_hash CHAR(64) NOT NULL,
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
    'authorization_revocations',
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
    'authorization_revocations',
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
COMMENT ON COLUMN proofhunt.authorization_records.policy_hash IS
  'SHA-256 of project ID, environment, parent authorization ID, canonical operational policy, and exact authorized-target and excluded-target snapshots; any change requires a new approval.';
