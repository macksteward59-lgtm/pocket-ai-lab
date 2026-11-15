-- Run after 001_proofhunt_scopeguard.sql as a superuser in a disposable database.
\set ON_ERROR_STOP on
SET TIME ZONE 'UTC';

DO $$
DECLARE url_parts TEXT[];
BEGIN
  url_parts := regexp_match('https://restricted.example.org/admin', '^https?://([^/]+)(/.*)$');
  IF url_parts[1] <> 'restricted.example.org' OR url_parts[2] <> '/admin' THEN
    RAISE EXCEPTION 'PostgreSQL URL regex capture groups are not as expected: %', url_parts;
  END IF;
END;
$$;

CREATE ROLE proofhunt_runtime NOLOGIN NOSUPERUSER NOBYPASSRLS;
GRANT USAGE ON SCHEMA proofhunt TO proofhunt_runtime;
GRANT SELECT, INSERT ON ALL TABLES IN SCHEMA proofhunt TO proofhunt_runtime;
GRANT UPDATE, DELETE ON proofhunt.assessment_jobs TO proofhunt_runtime;

INSERT INTO proofhunt.authorization_records (
  record_id, project_id, record_kind, environment, subject_id,
  evidence_reference, source_revision, permitted_checks,
  permitted_checks_reviewed_by, permitted_checks_review_reference,
  scope_policy_snapshot, scope_policy_hash, record_status, verified_at, expires_at
) VALUES (
  '00000000-0000-0000-0000-000000000001', 'project-a', 'bug_bounty_program', 'bounty', 'program-a',
  'captured-policy-a', 'revision-a', ARRAY['static_analysis'],
  'reviewer-a', 'review-a',
  jsonb_build_object(
    'authorized', FALSE,
    'effectiveAt', to_char(CURRENT_TIMESTAMP - INTERVAL '1 day', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'expiresAt', to_char(CURRENT_TIMESTAMP + INTERVAL '30 days', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'inScope', jsonb_build_array(
      jsonb_build_object('kind','domain','value','example.com','includeApex',TRUE,'includeSubdomains',TRUE),
      jsonb_build_object('kind','domain','value','exact.example.net','includeApex',TRUE,'includeSubdomains',TRUE),
      jsonb_build_object('kind','domain','value','restricted.example.org','includeApex',TRUE,'includeSubdomains',TRUE),
      jsonb_build_object('kind','url','value','https://restricted.example.org/admin','includeSubdomains',FALSE)
    ),
    'outOfScope', jsonb_build_array(
      jsonb_build_object('kind','domain','value','admin.example.com','includeApex',TRUE,'includeSubdomains',TRUE)
    ),
    'testingWindow', jsonb_build_object(
      'startsAt', to_char(CURRENT_TIMESTAMP - INTERVAL '1 day', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'endsAt', to_char(CURRENT_TIMESTAMP + INTERVAL '30 days', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'timezone','UTC'
    )
  ),
  repeat('a',64), 'verified', CURRENT_TIMESTAMP - INTERVAL '1 hour', CURRENT_TIMESTAMP + INTERVAL '30 days'
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
  'signature-a', CURRENT_TIMESTAMP - INTERVAL '1 hour', CURRENT_TIMESTAMP + INTERVAL '30 days'
);

INSERT INTO proofhunt.authorization_records (
  record_id, project_id, record_kind, environment, subject_id,
  evidence_reference, source_revision, permitted_checks,
  permitted_checks_reviewed_by, permitted_checks_review_reference,
  record_status, verified_at, expires_at
) VALUES (
  '00000000-0000-0000-0000-000000000101', 'project-b', 'asset_ownership', 'owned', 'owned-system-b',
  'ownership-proof-b', 'revision-b', ARRAY['static_analysis'],
  'reviewer-b', 'review-b', 'verified', CURRENT_TIMESTAMP - INTERVAL '1 hour',
  CURRENT_TIMESTAMP + INTERVAL '30 days'
);

INSERT INTO proofhunt.authorized_targets (
  target_id, project_id, authorization_record_id, hostname, include_subdomains
) VALUES
(
  '00000000-0000-0000-0000-000000000003', 'project-a',
  '00000000-0000-0000-0000-000000000001', 'example.com', TRUE
),
(
  '00000000-0000-0000-0000-000000000011', 'project-a',
  '00000000-0000-0000-0000-000000000001', 'exact.example.net', FALSE
),
(
  '00000000-0000-0000-0000-000000000016', 'project-a',
  '00000000-0000-0000-0000-000000000001', 'restricted.example.org', TRUE
);

INSERT INTO proofhunt.excluded_targets (
  exclusion_id, project_id, authorization_record_id, hostname, include_subdomains, exclusion_reason
) VALUES
(
  '00000000-0000-0000-0000-000000000006', 'project-a',
  '00000000-0000-0000-0000-000000000001', 'admin.example.com', TRUE, 'Published program exclusion'
),
(
  '00000000-0000-0000-0000-000000000012', 'project-a',
  '00000000-0000-0000-0000-000000000001', 'billing.example.com', FALSE, 'Operational exclusion'
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
  CURRENT_TIMESTAMP - INTERVAL '1 hour', CURRENT_TIMESTAMP + INTERVAL '30 days'
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

-- The composite foreign key prevents a job from pairing a valid row ID with a
-- different claimed allowlist hostname.
DO $$
BEGIN
  BEGIN
    INSERT INTO proofhunt.assessment_jobs (
      job_id, project_id, program_authorization_id, operational_authorization_id,
      policy_id, policy_version, policy_hash, check_type,
      authorized_target_id, authorized_target_hostname, target_hostname, program_scope_hash,
      decision, decision_reason, job_status, decision_at
    ) VALUES (
      '00000000-0000-0000-0000-000000000014', 'project-a',
      '00000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000002',
      '00000000-0000-0000-0000-000000000004', 'policy-v1', repeat('b',64), 'static_analysis',
      '00000000-0000-0000-0000-000000000003', 'exact.example.net', 'exact.example.net', repeat('a',64),
      'approved_plan', 'Should be denied by composite FK', 'planned', CURRENT_TIMESTAMP
    );
    RAISE EXCEPTION 'expected composite allowlist FK to reject mismatched hostname';
  EXCEPTION WHEN foreign_key_violation THEN
    NULL;
  END;
END;
$$;

-- A child hostname explicitly covered by the approved subdomain flag is admitted.
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
  '00000000-0000-0000-0000-000000000003', 'example.com', 'app.example.com', repeat('a',64),
  'approved_plan', 'Approved non-destructive plan', 'planned', CURRENT_TIMESTAMP
);

-- The policy allows one concurrent job; a second otherwise-valid plan is denied.
DO $$
BEGIN
  BEGIN
    INSERT INTO proofhunt.assessment_jobs (
      job_id, project_id, program_authorization_id, operational_authorization_id,
      policy_id, policy_version, policy_hash, check_type,
      authorized_target_id, authorized_target_hostname, target_hostname, program_scope_hash,
      decision, decision_reason, job_status, decision_at
    ) VALUES (
      '00000000-0000-0000-0000-000000000015', 'project-a',
      '00000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000002',
      '00000000-0000-0000-0000-000000000004', 'policy-v1', repeat('b',64), 'static_analysis',
      '00000000-0000-0000-0000-000000000003', 'example.com', 'app.example.com', repeat('a',64),
      'approved_plan', 'Should be denied by concurrency limit', 'planned', CURRENT_TIMESTAMP
    );
    RAISE EXCEPTION 'expected concurrency limit to deny second job';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'ProofHunt policy maximum concurrent jobs reached' THEN
      RAISE;
    END IF;
  END;
END;
$$;

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

-- The program includes this child, but the operational target row does not
-- permit subdomains, so admission must fail at the operational allowlist.
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
      '00000000-0000-0000-0000-000000000011', 'exact.example.net', 'child.exact.example.net', repeat('a',64),
      'approved_plan', 'Should be denied by exact allowlist', 'planned', CURRENT_TIMESTAMP
    );
    RAISE EXCEPTION 'expected exact allowlist to deny child host';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'ProofHunt job target is outside the matched allowlist hostname' THEN
      RAISE;
    END IF;
  END;
END;
$$;

-- A matching path-scoped URL rule cannot be flattened into a host-only plan.
DO $$
BEGIN
  BEGIN
    INSERT INTO proofhunt.assessment_jobs (
      job_id, project_id, program_authorization_id, operational_authorization_id,
      policy_id, policy_version, policy_hash, check_type,
      authorized_target_id, authorized_target_hostname, target_hostname, program_scope_hash,
      decision, decision_reason, job_status, decision_at
    ) VALUES (
      '00000000-0000-0000-0000-000000000017', 'project-a',
      '00000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000002',
      '00000000-0000-0000-0000-000000000004', 'policy-v1', repeat('b',64), 'static_analysis',
      '00000000-0000-0000-0000-000000000016', 'restricted.example.org', 'restricted.example.org', repeat('a',64),
      'approved_plan', 'Should be denied by path-scoped URL rule', 'planned', CURRENT_TIMESTAMP
    );
    RAISE EXCEPTION 'expected path-scoped URL rule to deny host-only plan';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'ProofHunt target has unresolved path-scoped program rules' THEN
      RAISE;
    END IF;
  END;
END;
$$;

-- Published exclusions override matching inclusions.
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

DO $$
DECLARE excluded_rows INTEGER;
BEGIN
  SELECT count(*) INTO excluded_rows
  FROM proofhunt.excluded_targets
  WHERE project_id = 'project-a'
    AND authorization_record_id = '00000000-0000-0000-0000-000000000001'
    AND hostname = 'billing.example.com';
  IF excluded_rows <> 1 THEN
    RAISE EXCEPTION 'RLS/test fixture expected one billing exclusion, saw %', excluded_rows;
  END IF;
END;
$$;

-- Operational exclusions are enforced independently of published program scope.
DO $$
BEGIN
  BEGIN
    INSERT INTO proofhunt.assessment_jobs (
      job_id, project_id, program_authorization_id, operational_authorization_id,
      policy_id, policy_version, policy_hash, check_type,
      authorized_target_id, authorized_target_hostname, target_hostname, program_scope_hash,
      decision, decision_reason, job_status, decision_at
    ) VALUES (
      '00000000-0000-0000-0000-000000000013', 'project-a',
      '00000000-0000-0000-0000-000000000001',
      '00000000-0000-0000-0000-000000000002',
      '00000000-0000-0000-0000-000000000004', 'policy-v1', repeat('b',64), 'static_analysis',
      '00000000-0000-0000-0000-000000000003', 'example.com', 'billing.example.com', repeat('a',64),
      'approved_plan', 'Should be denied by operational exclusion', 'planned', CURRENT_TIMESTAMP
    );
    RAISE EXCEPTION 'expected operational exclusion to deny target';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'ProofHunt job target is explicitly excluded' THEN
      RAISE;
    END IF;
  END;
END;
$$;

-- A revocation and job admission use the same transaction-scoped lock; once
-- the revocation commits, later jobs using that authorization are denied.
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
