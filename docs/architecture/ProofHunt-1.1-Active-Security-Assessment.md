# ProofHunt AI 1.1 — Active Security Assessment Architecture

## Status and integration decision

ProofHunt belongs inside Pocket AI Lab's existing security-intelligence subsystem. It extends the bug-bounty program-intelligence foundation proposed in PR #42 and the existing Security Division, delegation gate, tool registry, Evidence Synthesizer, and hash-linked AuditLedger. It is not an unrestricted agent and does not replace APEX/Director or East/e3.

The first implementation slice is ScopeGuard: a deterministic authorization gate that produces a preapproved assessment plan. It does not run scanners, make target network requests, exploit vulnerabilities, access sensitive data, or submit reports.

## Two supported environments

- Bug bounty: the program authorization record identifies the program, captured rules source, source revision, verification status, and expiry.
- Owned infrastructure: the program authorization record represents independently verified ownership/control evidence for the named asset or project.

The two environments share an operational policy engine, but their evidence types are not interchangeable. A bounty policy does not prove ownership, and an ownership assertion does not prove bounty permission.

## Two independent authorization records

1. Program authorization record: evidence that the bounty program or asset owner permits assessment in principle. It is independently verified and versioned.
2. Operational authorization record: a human-approved, signed configuration binding a project, program authorization ID, exact policy version, expiry, and approval provenance.

Both verifiers must succeed. The program/ownership record must also contain a human-reviewed list of permitted check types and the review provenance; ScopeGuard intersects this list with the separately signed operational policy. For bounty assessments, the program record must additionally carry the exact normalized policy snapshot and its SHA-256 digest; ScopeGuard recomputes the digest and invokes the existing deterministic bug-bounty ScopeEvaluator for the requested host. A broader operational allowlist cannot override a published-program exclusion or an unmatched program scope. Owned-asset assessments instead require an ownership verifier and do not infer bounty permission. Neither record is inferred from the other. An AI agent cannot create, modify, sign, renew, or verify either record. APEX/Director remains the approval authority; the operational signature verifier must be supplied by the trusted host.

Preapproval means the workflow can run the exact checks listed in the signed policy without asking for a separate prompt for each check. It does not widen target scope, introduce new check types, or authorize exploit execution.

## Scope semantics

- Exact hostnames and exact IP addresses only in this first slice.
- Subdomains are excluded unless includeSubdomains=true is explicitly recorded for that entry.
- Wildcards, CIDR ranges, ports, URL paths, queries, and fragments are rejected as requested target identifiers. If a verified bounty policy contains a matching path-scoped URL rule, the host-only gate returns a denial rather than guessing which path is covered. IP ranges require a future dedicated evaluator and explicit approval.
- Exclusions are evaluated before inclusions and always win.
- Malformed target entries reject the entire configuration rather than being ignored.
- Both program and operational records expire independently.
- A policy-version mismatch, revoked/pending record, failed verifier, unknown check, or failed audit write denies the plan.
- stopOnScopeViolation is mandatory and cannot be disabled.
- A required host-supplied emergency-stop provider is checked for both global and per-project stop state before a plan is emitted. A stop denies new plans; active-job cancellation, queued-job cancellation, and worker credential revocation remain mandatory responsibilities of a future scheduler/adapter control plane.

## Assessment types in this implementation

The allowlist is intentionally limited to local, non-destructive work:
- Static source analysis
- API specification review
- Configuration review of supplied artifacts
- Dependency review
- Security metadata/header review of supplied artifacts

Human-reviewed authentication and business-logic analysis may be represented as review tasks but are not preapproved automated checks. Network scanning, intrusive validation, exploit execution, credential attacks, sensitive-data access, and report submission are not implemented.

## Architecture and responsibility split

Research Dashboard
  Projects / Targets / Assessments / Findings
       |
Bug Bounty Adapter -------- Owned Asset Adapter
       |                            |
Program Evidence Verifier     Ownership Evidence Verifier
       \                            /
        Program Authorization Record
                     |
         Operational Approval Verifier
                     |
                ScopeGuard
     exact target + exclusions + expiry +
     policy version + approved check type
                     |
           Approved Assessment Plan
                     |
      APEX/Director admission + East/e3
                     |
      Isolated non-destructive adapters
                     |
       Evidence / counter-evidence review
                     |
         Validator + Critic + reporting

The diagram describes the target integration. The current ScopeGuard code only verifies records and emits a plan; no assessment adapter is connected.

## Audit and persistence

The current implementation accepts an injected audit writer. It can be connected to the existing JSONL AuditLedger, which hash-links events, but that ledger is tamper-evident rather than immutable and its current read-then-append implementation is not a multi-process transaction coordinator. Do not share it between concurrent worker processes as the sole production audit store.

A proposed PostgreSQL migration is provided at packages/intelligence/security/proofhunt/migrations/001_proofhunt_scopeguard.sql. It creates the project-scoped records below, forces row-level security using the transaction-local app.project_id setting, and makes authorization, target, policy, event, audit, and validation history append-only. It has not been applied to a live database. The application must set app.project_id with SET LOCAL inside every transaction; the runtime role must not have BYPASSRLS. Hash-chain sequence allocation and append must be serialized transactionally, and periodic signed checkpoints must be anchored outside the database. The production persistence layer should use transactional PostgreSQL with at least:

| Table | Purpose |
|---|---|
| authorization_records | Program/ownership evidence and independent operational approvals |
| authorized_targets | Exact allowlist entries and explicit subdomain flags |
| excluded_targets | Exclusions, which always override |
| assessment_policies | Immutable, versioned preapproved policy snapshots |
| assessment_jobs | Job binds authorization IDs, policy version, target, and requested check |
| assessment_events | Ordered lifecycle events and stop reasons |
| audit_events | Append-only, hash-linked security decisions |
| validation_results | Detected/corroborated/reproduced/confirmed/rejected outcomes |

Every job must persist both authorization record IDs, the program-level permitted-check review reference, exact policy version, the allowlist row ID that matched (for an approved plan), target canonicalization, and the decision timestamp. Database composite foreign keys bind the job's authorization IDs and policy version to the exact immutable policy and bind its approved target to the relevant project's authorized-target row. A replay must reproduce why that job was permitted at that time. Authorization revocation/expiry and emergency stop must be checked again at job admission and before each adapter boundary.

## Validation state model

- Detected: a scanner or static analyzer emitted a candidate.
- Corroborated: independent evidence supports the candidate.
- Reproduced: an independent validator demonstrated the expected behavior within permitted checks.
- Confirmed: evidence and review satisfy the finding's confirmation criteria.
- Rejected: counter-evidence disproves the original hypothesis.

A scanner alert is not automatically a vulnerability. Confidence must be tied to evidence provenance, independent validation, and reproducibility. Pocket AI Lab generation Evidence is not a substitute for target evidence.

## Required production controls before any live assessment adapter

- Default-deny scope and operation authorization at every adapter boundary.
- Global and per-project emergency stop; cancel queued work, terminate active non-destructive jobs, revoke worker credentials, and reject new jobs.
- Central rate and concurrency budgets; per-host limits cannot be raised by the model.
- Isolated workers with CPU, memory, filesystem, and wall-clock limits.
- Treat uploaded source, API specs, logs, and scanner exports as untrusted data; parse without executing.
- Secret redaction, credential isolation, retention/deletion policy, and least-privilege worker identities.
- Independent authorization verifiers and signed policy snapshots.
- External audit anchoring and transactional writes before production claims of immutability.
- Human review for authentication/business-logic conclusions and disclosure/report submission.

## Current implementation and limitations

The ScopeGuard module checks global and per-project emergency stops, independent program and operational authorization verifiers, the hash-bound normalized bounty scope snapshot (using the existing bug-bounty ScopeEvaluator), expiry, policy version, exact targets, exclusions, the human-reviewed program check allowlist, approved check names, rate/concurrency bounds, and mandatory stop-on-scope-violation. It emits an approved plan with executionPerformed=false. Audit persistence failure changes an otherwise approved result to denied.

This is an authorization foundation, not a scanner. It does not claim real-world authorization unless the trusted host supplies verifiers backed by authoritative evidence and APEX/Director. No live network assessment or exploit functionality is present.
