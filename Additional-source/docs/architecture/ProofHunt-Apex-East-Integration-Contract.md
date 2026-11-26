# ProofHunt 1.1 — APEX and East/e3 integration contract

## Purpose

This document defines how the ProofHunt ScopeGuard foundation is intended to integrate with Pocket AI Lab governance and workflow execution. It deliberately does **not** claim that the current repository can issue trusted execution receipts or run live assessments.

ProofHunt's preapproval model means a human approves one immutable operational policy for a bounded assessment. It does not mean an AI agent can grant itself permission, broaden scope, or bypass APEX.

## Current implementation boundary

The current ProofHunt 1.1 ScopeGuard:

- Independently verifies program/ownership evidence and operational approval through host-supplied verifier interfaces.
- Binds the operational approval to the project, environment, parent authorization ID, complete policy, exact allowlist, and exclusions.
- Rechecks the published bounty scope, effective/expiry dates, active testing window, exact target, permitted check, exclusions, revocation, emergency stop, and concurrency limits.
- Emits an `approved_plan` or `denied` decision with `executionPerformed: false`.
- Writes a hash-linked audit decision and the PostgreSQL schema persists an immutable job authorization basis and sequenced lifecycle events.

An `approved_plan` is a plan, **not an APEX authorization receipt** and not permission for an adapter to execute.

## Why the APEX/East connection is not enabled yet

### APEX trust is incomplete

- `packages/director/src/lib/apex/trust.ts` currently contains only a placeholder.
- `packages/director/src/lib/apex/rls.ts` and `packages/director/src/lib/apex/schema.ts` are absent on the current integration baseline.
- `packages/intelligence/policies/apexPolicies.ts` currently treats `tool-use-active` as requiring `delegation-voucher`, `scope-reference`, and `human-approval`. It separately forbids agent target authorization, scope expansion, self-approval, human override, and manufactured trusted evidence.
- The existing `OPEN_DECISIONS` constant is pending state, not approval.

Therefore, ProofHunt must not weaken the existing active-tool human-approval rule or treat ScopeGuard's plan as an APEX receipt. The missing APEX trust, RLS, schema, signature verification, and receipt contracts must be implemented and reviewed first.

### East/e3 is not yet the durable assessment scheduler

The current `src/east/platform.ts` keeps task records in an in-memory `Map`. Its `authorized` field is constant false; device evidence is candidate-only; and its APEX decision is a read-only pending/closed view. The compiled `src/east/index.ts` binding returns false for authorization. This is not a durable job queue, worker scheduler, revocation service, or scanner runtime.

Do not describe the current East adapter as production East/e3 persistence or route live assessments through it.

## Required preapproval flow

1. A human reviews the published program rules or ownership evidence. The program/ownership verifier records the source, revision, permitted methods, expiry, and (for bounty programs) normalized scope snapshot and digest.
2. A human configures and approves one operational policy: exact targets, exclusions, permitted non-destructive checks, request rate, concurrency, stop-on-scope-violation, start/expiry, and environment.
3. A trusted operational approval verifier checks the signed approval and its digest. The AI cannot create, edit, sign, renew, or verify this approval.
4. ScopeGuard evaluates each proposed job against both independent authorization records and emits a plan only.
5. Once the APEX receipt service exists, APEX may issue a signed, narrowly scoped job receipt derived from the human-approved policy. The receipt is bound to one project, authorization pair, policy version/hash, program scope hash, exact target/allowlist row, check type, job ID, issue/expiry time, and nonce.
6. East/e3 may enqueue the plan only after validating the APEX receipt and rechecking authorization/revocation state.
7. The worker revalidates the receipt, expiry, revocation, emergency stop, target, check type, rate budget, and concurrency immediately before each adapter boundary.

The user approves the policy once. Individual checks within that unchanged policy do not require a new human prompt **only after** APEX can prove that the policy approval is valid and the job receipt is current. Any policy, target, exclusion, check, or authorization change invalidates the prior digest and requires a new approval.

## Future APEX receipt contract

The eventual signed receipt should bind at least:

| Field | Purpose |
|---|---|
| `receiptId`, `nonce` | Unique, replay-resistant receipt |
| `projectId`, `environment` | Tenant and assessment context |
| `programAuthorizationId`, `operationalAuthorizationId` | Both independent authorization records |
| `policyVersion`, `operationalPolicyHash` | Exact approved operational policy |
| `programScopeHash` | Published bounty scope snapshot, when applicable |
| `targetId`, `targetHostname` | Exact matched allowlist entry and canonical target |
| `checkType` | One permitted non-destructive assessment type |
| `issuedAt`, `expiresAt` | Receipt lifetime |
| `jobId` | One scheduled job, not a blanket permission |
| `revocationSequence` | Detects stale/revoked authorization state |
| `signature`, `keyId` | Verified by the APEX trust root, never by the model |

No LLM output, consensus, policy parser, ScopeGuard result, or database row by itself may mint this receipt.

## Worker and kill-switch requirements

Before any scanner adapter is connected, East/e3 must provide:

- Durable job/event persistence with transactional admission.
- Per-project and global emergency stop.
- Cancellation of queued jobs and termination of active non-destructive workers.
- Worker credential revocation and denial of new work after stop/revocation.
- Central request-rate and concurrency budgets that the model cannot raise.
- Isolated workers with CPU, memory, filesystem, and wall-clock limits.
- Revalidation before every adapter invocation, not only when a job is first created.
- Immutable job authorization basis and append-only lifecycle/audit events.
- Evidence provenance, counter-evidence, confidence, and reproducibility separate from Pocket AI Lab model-generation Evidence.

## Release gates

| Gate | Required proof | Current status |
|---|---|---|
| ScopeGuard | Independent program + operational verification; exact scope; deny-by-default | Implemented in PR #143 |
| Database admission | PostgreSQL RLS, scope/exclusion recheck, revocation, concurrency, immutable job basis, lifecycle events | Validated in PostgreSQL 16 CI |
| APEX trust/receipt | Real trust root, RLS/schema, signed receipt issue/verify/revoke | Blocked; trust/RLS/schema incomplete |
| East/e3 durable scheduler | Persistent jobs, stop/revoke semantics, per-adapter revalidation | Not implemented |
| Non-destructive adapters | Strict contracts, sandboxing, rate/concurrency, evidence capture | Not implemented |
| Live assessment | Explicit configured scope, policy, and independent authorization proof | Not enabled |

## Security invariant

**Preapproval authorizes only the exact policy that the human approved.** The AI may propose a plan and summarize evidence; it cannot create authority, widen scope, alter the approved policy, issue an APEX receipt, or convert an assessment result into permission. Until the APEX and East/e3 release gates pass, ProofHunt remains a plan-only authorization foundation.
