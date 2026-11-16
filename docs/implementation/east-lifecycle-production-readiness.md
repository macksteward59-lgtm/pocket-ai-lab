# East lifecycle production-readiness gate

This checklist is an implementation gate, not a statement that the current in-memory East runtime is production durable.

## Required persistence contract

A production `TaskLifecycleStore` must provide all of the following:

1. Atomic snapshot replacement: a failed write leaves the prior committed snapshot readable.
2. Cross-process compare-and-swap or row-level locking for claims, completion, cancellation, and lease recovery. The coordinator's in-process mutation queue is not a distributed lock.
3. Monotonic record versions. A write based on an older version must fail as a conflict rather than overwrite a newer worker's state.
4. Durable lease owner identity, attempt identity, expiry, and bounded attempt count.
5. Explicit schema versioning and validated migrations. Unknown future versions fail closed.
6. Encryption and access control appropriate to task prompts, agent outputs, and evidence references; logs must not copy secrets or full sensitive payloads.
7. A transactional outbox or equivalent when lifecycle completion must trigger another durable subsystem.

The current `InMemoryTaskLifecycleStore` is for tests and ephemeral execution only.

## Recovery and duplicate-effect rules

- Recover only expired leases. Never steal a live lease.
- Scope recovery to the selected task when resuming one East task; global startup recovery is a separate host operation.
- Preserve the original attempt identifier and failure reason in the audit trail.
- Inference-bearing steps remain single-attempt unless the provider exposes a durable idempotency key and a verifiable result-retrieval contract.
- If a provider may have completed but the result was not durably committed, mark the step uncertain and require reconciliation. Do not blindly generate again.
- Persist bounded deliberation output before advancing to the evidence-gate step. Treat it as untrusted proposal text.
- A completed lifecycle must be returned idempotently without re-running assignment, inference, deliberation, or evidence submission.
- A failed or cancelled lifecycle is terminal until an explicit, separately audited operator action creates a new attempt/workflow.

## Cancellation and shutdown

Production cancellation must flow from the task coordinator through East, the inference provider, and the concrete runtime request. Cancellation is not complete merely because the lifecycle record says `cancelled`.

Before releasing a model lease or allowing a replacement generation, the host must await the provider's cancellation/drain contract. A timeout should leave the resource marked busy or quarantined; it must not free a lease while native work may still use the session.

On process shutdown, stop new claims, persist cancellation intent, allow bounded drain, and leave leases recoverable only after their persisted expiry. Startup must reconcile incomplete attempts before accepting new work.

## Authorization and evidence boundary

- East lifecycle completion is workflow state, not permission.
- Evidence references and model-generated synthesis are untrusted proposals.
- The evidence gate must remain non-authorizing.
- APEX/Director alone retains approval authority under its existing policy.
- BridgeGate continues to enforce trusted-origin/message authorization.
- Signed Evidence verification remains distinct from APEX approval.
- ExploitGym isolation and its execution policy are not bypassed by lifecycle recovery.

## Required production validation before enabling restart recovery

- Concurrent claims from two independent processes cannot both own one step.
- A stale version cannot overwrite a newer committed snapshot.
- Crash injection before and after every persistence boundary preserves the documented state machine.
- A provider success followed by a persistence failure enters an uncertain state without duplicate inference.
- Expired lease recovery is scoped and bounded; live leases remain owned.
- Cancellation waits for native generation drain before lease release.
- Schema migration, corruption, disk-full, permission, and key-unavailable cases fail closed.
- Audit events are durable and redact sensitive payloads.
- Physical-device tests cover memory pressure, thermal pressure, process termination, and restart.

## Current status

The coordinator and East adapter provide an injectable store boundary, bounded leases, task-scoped expiry recovery, and idempotent completed-step resumption. A PostgreSQL snapshot adapter is now included at `packages/intelligence/autonomy/PostgresTaskLifecycleStore.ts`. It uses a namespaced JSONB snapshot, a database transaction with `SELECT ... FOR UPDATE`, monotonic record versions, compare-and-swap rejection of stale writers, and explicit schema-version checks. After a `store_conflict`, the host must call `coordinator.reload()` and reconcile before retrying a worker result.

The adapter does not provision or execute migrations, provide a PostgreSQL driver, enforce tenant authorization/RLS, encrypt payloads itself, provision keys, or implement a transactional outbox. The host must configure database TLS, least-privilege credentials, encryption at rest, tenant/namespace authorization, backup/restore, and reviewed migration execution. A dedicated GitHub Actions job now applies the migration to an ephemeral PostgreSQL 16 service and exercises the real table constraints, `SELECT ... FOR UPDATE`, versioned compare-and-swap, stale-writer zero-row behavior, namespace isolation, and transaction rollback. A second two-session PostgreSQL test holds a row lock in writer A while writer B attempts the same stale version; writer B waits and then updates zero rows after writer A commits. This validates the database-level concurrent stale-writer exclusion. It still does not run the TypeScript adapter through a production PostgreSQL driver or exercise a full multi-process East worker lifecycle. The in-memory store remains test/ephemeral only. Active provider cancellation propagation and end-to-end production integration remain open work.
