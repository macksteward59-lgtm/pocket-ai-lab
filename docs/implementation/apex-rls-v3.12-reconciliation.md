# APEX / RLS v3.12 reconciliation checkpoint

**Repository baseline:** main at 9dde1ee16874b4b4802dd92e94605dd5fb92bc2d  
**Work branch:** codex/apex-rls-contract-reconciliation  
**Status:** Requirements reconciliation only. Not an implementation specification.

## Why this checkpoint exists

The current repository does not contain the authoritative full text of the user's RLS Architecture Specification v3.12 — SQL and Concurrency Corrections. The earlier discussion establishes several binding design decisions, but the complete v3.12 text (including its eleven corrections and detailed SQL/concurrency clauses) was not recoverable from the current repository tree or the available Library search.

This document therefore records only the requirements that are already known. It deliberately does not reconstruct missing SQL, invent policy names, or infer undocumented semantics. The full v3.12 source must be restored to the repository or supplied as the canonical source before implementation begins.

## Preserved requirements

The following are binding architectural constraints from the previously established v3.12 design and Pocket AI Lab governance:

1. **Exact-scope approval binding.** An approval is bound to the exact operation, resource, scope, principal/context, and other approval dimensions defined by the authoritative v3.12 contract. A broader, stale, replayed, or merely similar approval must not satisfy a narrower or different operation.
2. **Per-edge authorization accumulation.** Every edge in a multi-step execution/authorization path contributes its own required authorization constraints. The effective permission is the accumulated intersection/meet of the constraints along the path; a downstream edge cannot widen authority granted upstream. The exact algebra, edge identity, and persistence semantics must be copied from v3.12, not re-derived here.
3. **Independent repair authorization.** A repair, remediation, retry that changes protected state, or compensating operation cannot inherit the authorization of the failed/original operation. It requires its own independently scoped authorization as defined by v3.12.
4. **Broker provenance.** Database authorization must be based on authenticated, server-controlled broker provenance, not caller-supplied identity, tenant, role, scope, or session variables.
5. **Database authorization.** The database remains an enforcement boundary. Application checks alone do not replace database-side authorization or row-level security.
6. **Transaction discipline.** Identity/provenance context must be transaction-scoped and established using the approved transaction-local mechanism. Transaction-pool reuse must not leak one request's authorization context into another request.
7. **WORM / append-only retention.** Security-relevant approvals, execution attempts, evidence, decisions, and audit events must preserve the immutability/retention guarantees specified by v3.12. Application-level conventions alone are not proof of WORM enforcement.

## Current repository observations

Verified against the stated main commit:

| Area | Repository evidence | Reconciliation |
|---|---|---|
| APEX decision constants | packages/director/src/lib/apex/decisions.ts exports three pending gates | Not an approval system or receipt |
| Trust registry | packages/director/src/lib/apex/trust.ts contains only a placeholder string | No usable trust contract |
| RLS/schema | No rls.ts, schema.ts, SQL migration, Prisma schema, or database migration path exists in the recursive tree | No database contract to reconcile in code |
| Evidence candidate | validateDeviceEvidenceCandidate checks exact attempt bindings and nonce reuse against caller-supplied rows | Candidate validation only; no signature verification or durable nonce ledger |
| East | src/east/platform.ts stores a read-only APEX decision view and keeps authorized: false; compiled binding also returns false | Fail-closed behavior must remain |
| Existing product invariant | README and acceptance docs state repair operations require independent authorization and unauthorized actions are denied by APEX | Invariant is documented, not implemented as the full v3.12 DB policy |

## Required reconciliation matrix

| v3.12 concern | Required source text / implementation evidence | Current status |
|---|---|---|
| Exact approval tuple and canonical scope | Exact field list, canonicalization, equality semantics, and stale/replay handling | **Source required** |
| Per-edge accumulation | Exact edge model, composition operator, deny precedence, and proof that no downstream widening occurs | **Source required** |
| Independent repair | Exact repair operation identity, scope derivation, and non-inheritance rule | **Invariant known; SQL/source required** |
| Broker provenance | Authenticated broker identity, signed/verified provenance contract, and trust-root ownership | **Source required** |
| DB authorization | Roles, grants, policy functions, table ownership, and bypass restrictions | **Source required** |
| Transaction-local identity | Exact transaction setup/cleanup and transaction-pool semantics | **Source required** |
| RLS policy semantics | Per-table policies, USING/WITH CHECK behavior, tenant isolation, and denial cases | **Source required** |
| WORM retention | Append-only role permissions, retention controls, deletion/compaction policy, and audit verification | **Source required** |
| Concurrency corrections | All eleven v3.12 corrections, locking/isolation levels, uniqueness constraints, race handling, and retry behavior | **Source required** |
| Evidence and receipts | Signed payload, verification result, receipt schema, issuer, scope, and distinction from approval | **Source required** |

## Safe implementation order after source recovery

1. Import the complete authoritative v3.12 specification verbatim into version-controlled documentation, retaining its version and correction history.
2. Build a clause-by-clause traceability matrix: each requirement → schema object → policy/function → transaction boundary → positive test → negative/concurrency test.
3. Compare the matrix against the actual repository and identify conflicts before changing code.
4. Have the owner approve any unresolved interpretation. Do not silently choose among ambiguous SQL semantics.
5. Implement schema and database policies in isolated migrations, with least-privilege roles and explicit denial tests.
6. Implement broker provenance and transaction-local context so pooled connections cannot retain identity across requests.
7. Add concurrency tests for every v3.12 race correction, including parallel approval use, nonce consumption, retries, and repair attempts.
8. Add WORM/append-only enforcement and test that ordinary application roles cannot update or delete protected records.
9. Implement trust verification and receipts only after their key lifecycle and canonical payload contracts are defined.
10. Integrate East only after the database and APEX tests demonstrate the full authorization contract. Evidence verification remains distinct from authorization.

## Explicit non-goals for this checkpoint

- No CREATE POLICY, SQL function, table, migration, role, grant, or database connection code is authored.
- No trust root, key ID, signature algorithm, canonical payload, receipt, or attestation semantics are invented.
- No application-provided tenant or user identifier is promoted to trusted broker provenance.
- No East/APEX behavior is changed; authorized remains false.
- No candidate evidence is persisted or described as verified.
- No authorization is inferred from a model response, agent consensus, successful test, valid signature alone, or open decision constant.

## Owner input required

**@owner:** Please provide the complete RLS Architecture Specification v3.12, including the eleven SQL/concurrency corrections and the exact approved transaction/RLS/WORM clauses, or identify its canonical repository path. The full text is required to complete reconciliation accurately. Until then, this branch remains documentation-only and the East/APEX handoff remains fail-closed.
