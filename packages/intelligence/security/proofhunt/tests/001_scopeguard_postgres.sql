-- Run after 001_proofhunt_scopeguard.sql as a superuser in a disposable database.
\set ON_ERROR_STOP on

CREATE ROLE proofhunt_runtime NOLOGIN NOSUPERUSER NOBYPASSRLS;
GRANT USAGE ON SCHEMA proofhunt TO proofhunt_runtime;
GRANT SELECT, INSERT ON ALL TABLES IN SCHEMA proofhunt TO proofhunt_runtime;
GRANT UPDATE, DELETE ON proofhunt.assessment_jobs TO proofhunt_runtime;
GRANT UPDATE, DELETE ON proofhunt.authorization_records TO proofhunt_runtime;

INSERT INTO proofhunt.authorization_records (
  record_id, project_id, record_kind, environment, subject_id,
  evidence_reference, source_revision, permitted_checks,
  permitted_checks_reviewed_by, permitted_checks_review_reference,
  scope_policy_snapshot, scope_policy_hash, record_status, verified_at, expires_at
) VALUES (
  '00000000-0000-0000-0000-000000000001', 'project-a', 'bug_bounty_program', 'bounty', 'program-a',
  'captured-policy-a', 'revision-a', ARRAY['static_analysis'],
  'reviewer-a', 'review-a',
  '{
    "authorized": false,
    "effectiveAt": "2026-11-01T00:00:00Z",
    "expiresAt": "2026-12-01T00:00:00Z",
    "inScope": [
      {"kind":"domain","value":"example.com","includeApex":true,"includeSubdomains":true}
    ],
    "outOfScope": [
      {"kind":"domain","value":"admin.example.com","includeApex":true,"includeSubdomains":true}
    ],
    "testingWindow": {
      "startsAt":"2026-11-15T00:00:00Z",
      "endsAt":"2026-11-16T00:00:00Z",
      "timezone":"UTC"
    }
  }'::jsonb,
  repeat('a',64), 'verified', '2026-11-15T12:00:00Z', '2026-12-01T00:00:00Z'
);

INSERT INTO proofhunt.authorization_records (
  record_id, project_id, record_kind, environment, subject_id,
  parent_program_authorization_id, evidence_reference, source_revision,
  record_status, policy_version, policy_hash, approved_by, approval_reference,
  signature_reference, approved_at, expires_at
) VALUES (
  '00000000-0000-0000-0000-000000000002', 'project-a', 'operational_approval', 'bounty', 'ops-a',
  '00000000-0000-0000-0000-000000000001', 'operator-approval-a', 'policy-v1',
  'approved', 'policy-v1', repeat('b',64), 'human-a', 'approval-a',
  'signature-a', '2026-11-15T12:00:00Z', '2026-12-01T00:00:00Z'
);

-- A second project proves that RLS does not leak its authorization record.
INSERT INTO proofhunt.authorization_records (
  record_id, project_id, record_kind, environment, subject_id,
  evidence_reference, source_revision, permitted_checks,
  permitted_checks_reviewed_by, permitted_checks_review_reference,
  record_status, verified_at, expires_at
) VALUES (
  '00000000-0000-0000-0000-000000000101', 'project-b', 'asset_ownership', 'owned', 'owned-system-b',
  'ownership-proof-b', 'revision-b', ARRAY['static_analysis'],
  'reviewer-b', 'review-b', 'verified', '2026-11-15T12:00:00Z', '2026-12-01T00:00:00Z'
);

INSERT INTO proofhunt.authorized_targets (
  target_id, project_id, authorization_record_id, hostname, include_subdomains
) VALUES (
  '00000000-0000-0000-0000-000000000003', 'project-a',
  '00000000-0000-0000-0000-000000000001', 'example.com', FALSE
);

INSERT INTO proofhunt.excluded_targets (
  exclusion_id, project_id, authorization_record_id, hostname, include_subdomains, exclusion_reason
) VALUES (
  '00000000-0000-0000-0000-000000000006', 'project-a',
  '00000000-0000-0000-0000-000000000001', 'admin.example.com', TRUE, 'Published program exclusion'
);

INSERT INTO proofhunt.assessment_policies (
  policy_id, project_id, policy_version, policy_hash,
  program_authorization_id, operational_authorization_id,
  preapproved, allowed_checks, max_requests_per_second, max_concurrent_jobs,
  stop_on_scope_violation, effective_at, expires_at
) VALUES (
  '00000000-0000-0000-0000-000000000004', 'project-a', 'policy-v1', repeat('b',64),
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000002',
  TRUE, ARRAY['static_analysis'], 1.0, 1, TRUE,
  '2026-11-15T00:00:00Z', '2026-11-16T00:00:00Z'
);

SET ROLE proofhunt_runtime;
SET app.project_id = 'project-a';

DO $$
DECLARE visible_records INTEGER;
BEGIN
  SELECT count(*) INTO visible_records FROM proofhunt.authorization_records;
  IF visible_records <> 2 THEN
    RAISE EXCEPTION 'RLS expected 2 project-a records, saw %', visible_records;
  END IF;
  IF EXISTS (
    SELECT 1 FROM proofhunt.authorization_records
    WHERE record_id = '00000000-0000-0000-0000-000000000101'
  ) THEN
    RAISE EXCEPTION 'RLS leaked project-b authorization record';
  END IF;
END;
$$;

-- Exact allowlist target is admitted.
INSERT INTO proofhunt.assessment_jobs (
  job_id, project_id, program_authorization_id, operational_authorization_id,
  policy_id, policy_version, policy_hash, check_type,
  authorized_target_id, authorized_target_hostname, target_hostname, program_scope_hash,
  decision, decision_reason, job_status, decision_at
) VALUES (
  '00000000-0000-0000-0000-000000000005', 'project-a',
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000002',
  '00000000-0000-0000-0000-000000000004', 'policy-v1', repeat('b',64), 'static_analysis',
  '00000000-0000-0000-0000-000000000003', 'example.com', 'example.com', repeat('a',64),
  'approved_plan', 'Approved non-destructive local analysis plan', 'planned', CURRENT_TIMESTAMP
);

-- Job lifecycle may advance, but its authorization basis cannot be rewritten.
UPDATE proofhunt.assessment_jobs SET job_status = 'queued'
WHERE job_id = '00000000-0000-0000-0000-000000000005';

DO $$
BEGIN
  BEGIN
    UPDATE proofhunt.assessment_jobs
      SET target_hostname = 'attacker.example.net'
      WHERE job_id = '00000000-0000-0000-0000-000000000005';
    RAISE EXCEPTION 'expected immutable job-basis trigger to reject target mutation';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'ProofHunt assessment job authorization basis is immutable' THEN
      RAISE;
    END IF;
  END;
  BEGIN
    DELETE FROM proofhunt.assessment_jobs
      WHERE job_id = '00000000-0000-0000-0000-000000000005';
    RAISE EXCEPTION 'expected immutable job-basis trigger to reject deletion';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'ProofHunt assessment jobs cannot be deleted' THEN
      RAISE;
    END IF;
  END;
END;
$$;

-- A child host is in the published policy but not in this exact operational
-- allowlist; it must be rejected by the allowlist/subdomain control.
DO $$
BEGIN
  BEGIN
    INSERT INTO proofhunt.assessment_jobs (
      job_id, project_id, program_authorization_id, operational_authorization_id,
      policy_id, policy_version, policy_hash, check_type,
      authorized_target_id, authorized_target_hostname, target_hostname, program_scope_hash,
      decision, decision_reason, job_status, decision_at
    ) VALUES (
      '00000000-0000-0000-0000-000000000007', 'project-a',
      '00000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000002',
      '00000000-0000-0000-0000-000000000004', 'policy-v1', repeat('b',64), 'static_analysis',
      '00000000-0000-0000-0000-000000000003', 'example.com', 'app.example.com', repeat('a',64),
      'approved_plan', 'Should be denied by exact allowlist', 'planned', CURRENT_TIMESTAMP
    );
    RAISE EXCEPTION 'expected subdomain scope to be denied';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'ProofHunt job target is outside the matched allowlist hostname' THEN
      RAISE;
    END IF;
  END;
END;
$$;

-- Published out-of-scope exclusions override otherwise matching inclusion.
DO $$
BEGIN
  BEGIN
    INSERT INTO proofhunt.assessment_jobs (
      job_id, project_id, program_authorization_id, operational_authorization_id,
      policy_id, policy_version, policy_hash, check_type,
      authorized_target_id, authorized_target_hostname, target_hostname, program_scope_hash,
      decision, decision_reason, job_status, decision_at
    ) VALUES (
      '00000000-0000-0000-0000-000000000008', 'project-a',
      '00000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000002',
      '00000000-0000-0000-0000-000000000004', 'policy-v1', repeat('b',64), 'static_analysis',
      '00000000-0000-0000-0000-000000000003', 'example.com', 'admin.example.com', repeat('a',64),
      'approved_plan', 'Should be denied by published exclusion', 'planned', CURRENT_TIMESTAMP
    );
    RAISE EXCEPTION 'expected published program exclusion to deny target';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'ProofHunt target is excluded by the published program policy' THEN
      RAISE;
    END IF;
  END;
END;
$$;

-- A revocation and a concurrent admission are serialized by transaction locks;
-- subsequent approved jobs using the revoked record are rejected.
INSERT INTO proofhunt.authorization_revocations (
  revocation_id, project_id, authorization_record_id, revoked_at, revoked_by, reason, evidence_reference
) VALUES (
  '00000000-0000-0000-0000-000000000009', 'project-a',
  '00000000-0000-0000-0000-000000000001', CURRENT_TIMESTAMP,
  'security-owner', 'Emergency revocation', 'revocation-proof-a'
);

DO $$
BEGIN
  BEGIN
    INSERT INTO proofhunt.assessment_jobs (
      job_id, project_id, program_authorization_id, operational_authorization_id,
      policy_id, policy_version, policy_hash, check_type,
      authorized_target_id, authorized_target_hostname, target_hostname, program_scope_hash,
      decision, decision_reason, job_status, decision_at
    ) VALUES (
      '00000000-0000-0000-0000-000000000010', 'project-a',
      '00000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000002',
      '00000000-0000-0000-0000-000000000004', 'policy-v1', repeat('b',64), 'static_analysis',
      '00000000-0000-0000-0000-000000000003', 'example.com', 'example.com', repeat('a',64),
      'approved_plan', 'Should be denied after revocation', 'planned', CURRENT_TIMESTAMP
    );
    RAISE EXCEPTION 'expected revoked authorization to deny target';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'ProofHunt authorization has been revoked' THEN
      RAISE;
    END IF;
  END;
END;
$$;

RESET ROLE;
