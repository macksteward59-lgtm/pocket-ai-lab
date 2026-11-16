\set ON_ERROR_STOP on

-- The migration owner seeds trusted authorization data. The runtime role is
-- deliberately NOBYPASSRLS and cannot mint or revoke authorization records.
CREATE ROLE proofhunt_app NOLOGIN NOBYPASSRLS;
GRANT USAGE ON SCHEMA proofhunt TO proofhunt_app;
GRANT SELECT ON ALL TABLES IN SCHEMA proofhunt TO proofhunt_app;
GRANT INSERT ON proofhunt.assessment_jobs, proofhunt.assessment_events TO proofhunt_app;

DO $
DECLARE bypass_rls BOOLEAN;
BEGIN
  SELECT rolbypassrls INTO bypass_rls
    FROM pg_roles
   WHERE rolname = 'proofhunt_app';
  IF bypass_rls IS DISTINCT FROM FALSE THEN
    RAISE EXCEPTION 'Runtime role must not have BYPASSRLS';
  END IF;
  IF has_table_privilege('proofhunt_app', 'proofhunt.authorization_records', 'INSERT')
     OR has_table_privilege('proofhunt_app', 'proofhunt.authorization_revocations', 'INSERT')
     OR has_table_privilege('proofhunt_app', 'proofhunt.authorized_targets', 'INSERT')
     OR has_table_privilege('proofhunt_app', 'proofhunt.excluded_targets', 'INSERT')
     OR has_table_privilege('proofhunt_app', 'proofhunt.assessment_policies', 'INSERT') THEN
    RAISE EXCEPTION 'Runtime role has an unauthorized authorization-state INSERT grant';
  END IF;
END
$;

-- Seed a second tenant to prove forced project RLS isolation.
INSERT INTO proofhunt.authorization_records (
  record_id, project_id, record_kind, environment, subject_id,
  evidence_reference, source_revision, permitted_checks,
  permitted_checks_reviewed_by, permitted_checks_review_reference,
  scope_policy_snapshot, scope_policy_hash, record_status, expires_at
) VALUES (
  '10000000-0000-0000-0000-000000000001', 'project-b',
  'bug_bounty_program', 'bounty', 'tenant-b',
  'evidence://tenant-b', 'revision-b', ARRAY['static_analysis'],
  'reviewer-b', 'review://tenant-b', '{"authorized": false}'::jsonb,
  repeat('a', 64), 'verified', CURRENT_TIMESTAMP + INTERVAL '1 day'
);

-- Trusted, pre-verified project-A authorization and policy fixtures.
INSERT INTO proofhunt.authorization_records (
  record_id, project_id, record_kind, environment, subject_id,
  evidence_reference, source_revision, permitted_checks,
  permitted_checks_reviewed_by, permitted_checks_review_reference,
  scope_policy_snapshot, scope_policy_hash, record_status, expires_at
) VALUES (
  '20000000-0000-0000-0000-000000000001', 'project-a',
  'bug_bounty_program', 'bounty', 'program-a',
  'evidence://program-a', 'revision-a', ARRAY['static_analysis'],
  'human-reviewer', 'review://program-a', '{"authorized": false}'::jsonb,
  repeat('a', 64), 'verified', CURRENT_TIMESTAMP + INTERVAL '1 day'
);

INSERT INTO proofhunt.authorization_records (
  record_id, project_id, record_kind, environment, subject_id,
  parent_program_authorization_id, evidence_reference, source_revision,
  record_status, policy_version, policy_hash, target_scope_hash,
  approved_by, approval_reference, signature_reference, approved_at, expires_at
) VALUES (
  '20000000-0000-0000-0000-000000000002', 'project-a',
  'operational_approval', 'bounty', 'program-a',
  '20000000-0000-0000-0000-000000000001',
  'evidence://operational-a', 'revision-a', 'approved', 'policy-1',
  repeat('b', 64), repeat('c', 64), 'human-approver',
  'approval://operational-a', 'signature://operational-a',
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP + INTERVAL '1 day'
);

INSERT INTO proofhunt.authorized_targets (
  target_id, project_id, authorization_record_id, hostname
) VALUES (
  '20000000-0000-0000-0000-000000000003', 'project-a',
  '20000000-0000-0000-0000-000000000002', 'app.example.com'
), (
  '20000000-0000-0000-0000-000000000006', 'project-a',
  '20000000-0000-0000-0000-000000000002', 'private.admin.example.com'
);

INSERT INTO proofhunt.excluded_targets (
  exclusion_id, project_id, authorization_record_id, hostname,
  include_subdomains, exclusion_reason
) VALUES (
  '20000000-0000-0000-0000-000000000005', 'project-a',
  '20000000-0000-0000-0000-000000000002',
  'admin.example.com', TRUE, 'excluded by program'
);

INSERT INTO proofhunt.assessment_policies (
  policy_id, project_id, policy_version, policy_hash,
  program_authorization_id, operational_authorization_id,
  preapproved, allowed_checks, max_requests_per_second,
  max_concurrent_jobs, stop_on_scope_violation, effective_at, expires_at
) VALUES (
  '20000000-0000-0000-0000-000000000004', 'project-a',
  'policy-1', repeat('b', 64),
  '20000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000002',
  TRUE, ARRAY['static_analysis'], 1, 1, TRUE,
  CURRENT_TIMESTAMP - INTERVAL '1 minute',
  CURRENT_TIMESTAMP + INTERVAL '1 day'
);

SET ROLE proofhunt_app;
SELECT set_config('app.project_id', 'project-a', false);

DO $$
DECLARE visible_count INTEGER;
BEGIN
  SELECT count(*) INTO visible_count
    FROM proofhunt.authorization_records
   WHERE project_id = 'project-b';
  IF visible_count <> 0 THEN
    RAISE EXCEPTION 'RLS tenant isolation failed: project-b row was visible';
  END IF;
END
$$;

-- The runtime role may consume authorization state, not mint or revoke it.
DO $$
BEGIN
  BEGIN
    INSERT INTO proofhunt.authorization_records (
      record_id, project_id, record_kind, environment, subject_id,
      evidence_reference, source_revision, permitted_checks,
      permitted_checks_reviewed_by, permitted_checks_review_reference,
      scope_policy_snapshot, scope_policy_hash, record_status, expires_at
    ) VALUES (
      '20000000-0000-0000-0000-000000000030', 'project-a',
      'bug_bounty_program', 'bounty', 'forged-program',
      'evidence://forged', 'revision-forged', ARRAY['static_analysis'],
      'runtime', 'review://forged', '{"authorized": false}'::jsonb,
      repeat('a', 64), 'verified', CURRENT_TIMESTAMP + INTERVAL '1 day'
    );
    RAISE EXCEPTION 'Expected runtime authorization minting to be rejected';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END
$$;

-- A currently valid plan is admitted.
INSERT INTO proofhunt.assessment_jobs (
  job_id, project_id, program_authorization_id, operational_authorization_id,
  policy_id, policy_version, policy_hash, authorized_target_id,
  target_hostname, check_type, decision, decision_reason, job_status, decision_at
) VALUES (
  '20000000-0000-0000-0000-000000000010', 'project-a',
  '20000000-0000-0000-0000-000000000001',
  '20000000-0000-0000-0000-000000000002',
  '20000000-0000-0000-0000-000000000004', 'policy-1', repeat('b', 64),
  '20000000-0000-0000-0000-000000000003',
  'app.example.com', 'static_analysis', 'approved_plan',
  'integration test', 'planned', CURRENT_TIMESTAMP
);

-- The database admission trigger rejects checks outside the approved policy.
DO $$
BEGIN
  BEGIN
    INSERT INTO proofhunt.assessment_jobs (
      job_id, project_id, program_authorization_id, operational_authorization_id,
      policy_id, policy_version, policy_hash, authorized_target_id,
      target_hostname, check_type, decision, decision_reason, job_status, decision_at
    ) VALUES (
      '20000000-0000-0000-0000-000000000011', 'project-a',
      '20000000-0000-0000-0000-000000000001',
      '20000000-0000-0000-0000-000000000002',
      '20000000-0000-0000-0000-000000000004', 'policy-1', repeat('b', 64),
      '20000000-0000-0000-0000-000000000003',
      'app.example.com', 'intrusive_testing', 'approved_plan',
      'must be rejected', 'planned', CURRENT_TIMESTAMP
    );
    RAISE EXCEPTION 'Expected disallowed check to be rejected';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'Expected disallowed check to be rejected' THEN RAISE; END IF;
    IF SQLERRM <> 'ProofHunt assessment policy is not currently effective' THEN RAISE; END IF;
  END;
END
$$;

-- Exact and subdomain exclusions are rejected even when a target row exists.
DO $$
BEGIN
  BEGIN
    INSERT INTO proofhunt.assessment_jobs (
      job_id, project_id, program_authorization_id, operational_authorization_id,
      policy_id, policy_version, policy_hash, authorized_target_id,
      target_hostname, check_type, decision, decision_reason, job_status, decision_at
    ) VALUES (
      '20000000-0000-0000-0000-000000000012', 'project-a',
      '20000000-0000-0000-0000-000000000001',
      '20000000-0000-0000-0000-000000000002',
      '20000000-0000-0000-0000-000000000004', 'policy-1', repeat('b', 64),
      '20000000-0000-0000-0000-000000000006',
      'private.admin.example.com', 'static_analysis', 'approved_plan',
      'must be rejected', 'planned', CURRENT_TIMESTAMP
    );
    RAISE EXCEPTION 'Expected excluded subdomain to be rejected';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'Expected excluded subdomain to be rejected' THEN RAISE; END IF;
    IF SQLERRM <> 'ProofHunt target is explicitly excluded' THEN RAISE; END IF;
  END;
END
$$;

-- A job cannot substitute a hostname for the host bound to its target ID.
DO $$
BEGIN
  BEGIN
    INSERT INTO proofhunt.assessment_jobs (
      job_id, project_id, program_authorization_id, operational_authorization_id,
      policy_id, policy_version, policy_hash, authorized_target_id,
      target_hostname, check_type, decision, decision_reason, job_status, decision_at
    ) VALUES (
      '20000000-0000-0000-0000-000000000013', 'project-a',
      '20000000-0000-0000-0000-000000000001',
      '20000000-0000-0000-0000-000000000002',
      '20000000-0000-0000-0000-000000000004', 'policy-1', repeat('b', 64),
      '20000000-0000-0000-0000-000000000003',
      'other.example.net', 'static_analysis', 'approved_plan',
      'must be rejected', 'planned', CURRENT_TIMESTAMP
    );
    RAISE EXCEPTION 'Expected target hostname mismatch to be rejected';
  EXCEPTION WHEN foreign_key_violation THEN
    NULL;
  END;
END
$$;

-- Without project context, the trigger cannot see authorization rows and
-- therefore fails closed before a plan can be admitted.
SELECT set_config('app.project_id', '', false);
DO $$
BEGIN
  BEGIN
    INSERT INTO proofhunt.assessment_jobs (
      job_id, project_id, program_authorization_id, operational_authorization_id,
      policy_id, policy_version, policy_hash, authorized_target_id,
      target_hostname, check_type, decision, decision_reason, job_status, decision_at
    ) VALUES (
      '20000000-0000-0000-0000-000000000015', 'project-a',
      '20000000-0000-0000-0000-000000000001',
      '20000000-0000-0000-0000-000000000002',
      '20000000-0000-0000-0000-000000000004', 'policy-1', repeat('b', 64),
      '20000000-0000-0000-0000-000000000003',
      'app.example.com', 'static_analysis', 'approved_plan',
      'must fail closed', 'planned', CURRENT_TIMESTAMP
    );
    RAISE EXCEPTION 'Expected missing project context to reject plan admission';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'Expected missing project context to reject plan admission' THEN RAISE; END IF;
    IF SQLERRM <> 'ProofHunt program authorization is not active' THEN RAISE; END IF;
  END;
END
$$;

RESET ROLE;

-- Append-only triggers also protect against the privileged migration owner.
DO $$
BEGIN
  BEGIN
    UPDATE proofhunt.authorization_records
       SET subject_id = 'tampered'
     WHERE project_id = 'project-a'
       AND record_id = '20000000-0000-0000-0000-000000000001';
    RAISE EXCEPTION 'Expected append-only update to be rejected';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'Expected append-only update to be rejected' THEN RAISE; END IF;
    IF SQLERRM <> 'ProofHunt history records are append-only' THEN RAISE; END IF;
  END;
END
$$;

-- Only the trusted authorization process inserts the revocation event.
INSERT INTO proofhunt.authorization_revocations (
  revocation_id, project_id, authorization_record_id,
  revoked_by, revocation_reference, reason
) VALUES (
  '20000000-0000-0000-0000-000000000020', 'project-a',
  '20000000-0000-0000-0000-000000000002',
  'human-reviewer', 'revocation://operational-a', 'approval withdrawn'
);

SET ROLE proofhunt_app;
SELECT set_config('app.project_id', 'project-a', false);

DO $$
BEGIN
  BEGIN
    INSERT INTO proofhunt.assessment_jobs (
      job_id, project_id, program_authorization_id, operational_authorization_id,
      policy_id, policy_version, policy_hash, authorized_target_id,
      target_hostname, check_type, decision, decision_reason, job_status, decision_at
    ) VALUES (
      '20000000-0000-0000-0000-000000000014', 'project-a',
      '20000000-0000-0000-0000-000000000001',
      '20000000-0000-0000-0000-000000000002',
      '20000000-0000-0000-0000-000000000004', 'policy-1', repeat('b', 64),
      '20000000-0000-0000-0000-000000000003',
      'app.example.com', 'static_analysis', 'approved_plan',
      'must be rejected after revocation', 'planned', CURRENT_TIMESTAMP
    );
    RAISE EXCEPTION 'Expected revoked approval to be rejected';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM = 'Expected revoked approval to be rejected' THEN RAISE; END IF;
    IF SQLERRM <> 'ProofHunt operational authorization is not active' THEN RAISE; END IF;
  END;
END
$$;

RESET ROLE;
SELECT 'ProofHunt PostgreSQL integration checks passed' AS result;
