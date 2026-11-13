# APEX / RLS v3.12 reconciliation checkpoint

**Repository baseline:** main at 9dde1ee16874b4b4802dd92e94605dd5fb92bc2d  
**Work branch:** codex/apex-rls-contract-reconciliation  
**Status:** Requirements reconciliation only. Not an implementation specification.

## Why this checkpoint exists

The owner-authored **RLS Architecture Specification v3.12 — SQL and Concurrency Corrections** was supplied in an earlier conversation on 2026-10-31. The present review recovered its title, date, a summary of its governing principles, and selected correction details, but not the complete verbatim specification or SQL body. The original source therefore must not be described as never having been supplied.

This checkpoint records only details that are currently recoverable. It does not reconstruct missing SQL, invent policy names, or infer undocumented semantics. The complete v3.12 text, including all eleven corrections and their exact clauses, remains necessary before implementation.

## Preserved requirements

The following are binding architectural constraints from the previously established v3.12 design and Pocket AI Lab governance:

1. **Exact-scope approval binding.** An approval is bound to the exact operation, resource, scope, principal/context, and other approval dimensions defined by the authoritative v3.12 contract. A broader, stale, replayed, or merely similar approval must not satisfy a narrower or different operation.
2. **Per-edge authorization accumulation.** Every edge in a multi-step execution/authorization path contributes its own required authorization constraints. The effective permission is the accumulated intersection/meet of the constraints along the path; a downstream edge cannot widen authority granted upstream. The exact algebra, edge identity, and persistence semantics must be copied from v3.12, not re-derived here.
3. **Independent repair authorization.** A repair, remediation, retry that changes protected state, or compensating operation cannot inherit the authorization of the failed/original operation. It requires its own independently scoped authorization as defined by v3.12.
4. **Broker provenance.** Database authorization must be based on authenticated, server-controlled broker provenance, not caller-supplied identity, tenant, role, scope, or session variables.
5. **Database authorization.** The database remains an enforcement boundary. Application checks alone do not replace database-side authorization or row-level security.
6. **Transaction discipline.** Identity/provenance context must be transaction-scoped and established using the approved transaction-local mechanism. Transaction-pool reuse must not leak one request's authorization context into another request.
7. **WORM / append-only retention.** Security-relevant approvals, execution attempts, evidence, decisions, and audit events must preserve the immutability/retention guarantees specified by v3.12. Application-level conventions alone are not proof of WORM enforcement.

## Recovered v3.12 correction themes

The conversation summary preserves three structural changes associated with v3.12. These are recorded as correction themes, not as a substitute for the missing eleven exact correction clauses:

1. **Transactional outbox in place of `RAISE LOG`.** Durable event publication is to be represented through a transactional outbox rather than relying on database log emission as the event-delivery mechanism. Exact event schema, atomicity boundary, dispatcher behavior, retries, and deduplication must come from the original specification.
2. **Column-level privilege matrix.** Authorization must account for privileges at column granularity, not merely table-level access. The exact matrix, role assignments, protected columns, and audit queries must be recovered from v3.12.
3. **Signed-manifest publications bound to deployments.** Publications must be associated with signed manifests and their deployment context. Signing format, trusted keys, canonical payload, environment/target binding, verification timing, and failure behavior remain unspecified here and must not be invented.

## Known implementation blockers to resolve against the source

The prior technical review identified the following implementation questions. They are audit prompts, not new policy decisions:

- Deterministic locking of active rows under the specified concurrency model.
- Typed outbox events, dispatcher claims, retry semantics, and deduplication.
- Authenticated deployment binding, including environment and PostgreSQL target identity.
- Complete definer-function privilege boundaries and ownership.
- Table- and column-level privilege matrix, including actual ACL auditing.
- Repair write boundary and proof that repair authorization is independent.
- Full migration preflight and safe failure/rollback behavior.
- Required positive, negative, and concurrency test coverage. The prior discussion referenced test families V1–V80 and M1–M31; their exact cases and expected outcomes must be checked against the original specification rather than recreated from their identifiers.

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
| Transactional outbox | Exact event types, schema, transaction boundary, dispatcher claims, retries, and deduplication | **Theme recovered; exact clauses required** |
| Column-level privilege matrix | Exact role/column grants, protected columns, ownership, and ACL audit | **Theme recovered; exact matrix required** |
| Signed-manifest publication | Canonical manifest, signing/verification contract, deployment/environment/DB-target binding | **Theme recovered; exact clauses required** |
| Remaining concurrency corrections | All eleven v3.12 corrections, locking/isolation levels, uniqueness constraints, race handling, and retry behavior | **Source required** |
| Evidence and receipts | Signed payload, verification result, receipt schema, issuer, scope, and distinction from approval | **Source required** |

## Safe implementation order after source recovery

1. Restore the complete authoritative v3.12 specification verbatim into version-controlled documentation, retaining its version and correction history.
2. Build a clause-by-clause traceability matrix: each requirement → schema object → policy/function → transaction boundary → positive test → negative/concurrency test.
3. Compare the matrix against the actual repository and identify conflicts before changing code.
4. Have the owner approve any unresolved interpretation. Do not silently choose among ambiguous SQL semantics.
5. Implement schema and database policies in isolated migrations, with least-privilege roles and explicit denial tests.
6. Implement broker provenance and transaction-local context so pooled connections cannot retain identity across requests.
7. Implement the transactional outbox and signed-manifest publication flow exactly as specified, including dispatcher concurrency, deduplication, deployment binding, and failure behavior.
8. Add concurrency tests for every v3.12 race correction, including parallel approval use, nonce consumption, retries, and repair attempts.
9. Add WORM/append-only enforcement and test that ordinary application roles cannot update or delete protected records.
10. Implement trust verification and receipts only after their key lifecycle and canonical payload contracts are defined.
11. Integrate East only after the database and APEX tests demonstrate the full authorization contract. Evidence verification remains distinct from authorization.

## Explicit non-goals for this checkpoint

- No CREATE POLICY, SQL function, table, migration, role, grant, or database connection code is authored.
- No trust root, key ID, signature algorithm, canonical payload, receipt, or attestation semantics are invented.
- No application-provided tenant or user identifier is promoted to trusted broker provenance.
- No East/APEX behavior is changed; authorized remains false.
- No candidate evidence is persisted or described as verified.
- No authorization is inferred from a model response, agent consensus, successful test, valid signature alone, or open decision constant.

## Owner input required

**@owner:** Please restore the complete original RLS Architecture Specification v3.12, including all eleven SQL/concurrency corrections and the exact approved transaction/RLS/WORM clauses, or identify its canonical repository path. The source was supplied in the 2026-10-31 conversation; this request is for the full verbatim text because only a summary and selected correction themes are presently recoverable. Until the complete source is restored, this branch remains documentation-only and the East/APEX handoff remains fail-closed.
