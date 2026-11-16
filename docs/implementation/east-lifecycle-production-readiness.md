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

The coordinator and East adapter provide an injectable store boundary, bounded leases, task-scoped expiry recovery, and idempotent completed-step resumption. The East task map and MessageBus remain in-memory, but the adapter serializes a validated task snapshot plus the new message delta into each successfully completed lifecycle step result. A fresh East runtime and fresh coordinator can rehydrate the task and full message thread from the shared lifecycle store without repeating completed inference; the adapter test now uses distinct runtime instances to prove that boundary.

This is checkpoint-based recovery, not a durable per-message event log. If inference succeeds but the process fails before `completeStep` commits the checkpoint, the output may be unavailable after restart. Inference steps remain single-attempt and must fail closed for operator reconciliation rather than silently regenerate. A provider idempotency/result-retrieval contract or transactional outbox is still required to close that crash window. The restart test uses the shared in-memory store interface; the PostgreSQL adapter's atomicity/version-conflict tests are separate, and no live production database integration is claimed. A durable `MemoryStore` must also be injected if episodic memory is expected to survive a process restart. Active provider cancellation propagation and production database/RLS configuration remain open work.
