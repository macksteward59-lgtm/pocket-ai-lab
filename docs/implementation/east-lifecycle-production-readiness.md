# East lifecycle production-readiness gate

This checklist is an implementation gate, not a statement that the current in-memory East runtime is production durable.

## Required persistence contract

A production `TaskLifecycleStore` must provide all of the following:

1. Atomic snapshot replacement: a failed write leaves the prior committed snapshot readable.
2. Cross-process compare-and-swap or row-level locking for claims, completion, cancellation, and lease recovery. The coordinator's in-process mutation queue is not a distributed lock.
3. Monotonic record versions. A write based on an older version must fail as a conflict rather than overwrite a newer worker's state.
4. Durable lease owner identity, attempt identity, expiry, and bounded attempt count.
5. Explicit schema versioning and validated migrations. Unknown future versions fail closed. Expiry-policy version 1 is stored on each task; unversioned legacy snapshots migrate every step to `uncertainOnExpiredLease: true`, including records that previously persisted `false` as an implicit multi-attempt default.
6. Encryption and access control appropriate to task prompts, agent outputs, and evidence references; logs must not copy secrets or full sensitive payloads.
7. A transactional outbox or equivalent when lifecycle completion must trigger another durable subsystem.

The current `InMemoryTaskLifecycleStore` is for tests and ephemeral execution only.

## Worker ownership and stale-process fencing

Each new step lease records a bounded `ownerId` alongside its unique attempt ID and expiry. The coordinator returns that owner identity in the claim and requires the completing/failing coordinator instance to match it. A different process cannot adopt or finish a live lease merely because it can read the attempt ID.

A restarted coordinator receives a new worker identity by default. It must wait for the prior lease to expire, then use task-scoped recovery before claiming replacement work. Historical active attempts without an owner identity remain readable for compatibility, but completion and failure are rejected; they must expire and be recovered rather than being silently adopted.

This is concurrency fencing, not authentication or authorization. A worker ID is not a credential, model output is not permission, and the host must still enforce tenant isolation, database access controls, RLS context, and APEX approval independently.

## Recovery and duplicate-effect rules

- Recover only expired leases. Never steal a live lease. Expiry is an unknown external outcome by default for every step; retry after expiry requires an explicit `uncertainOnExpiredLease: false` declaration backed by an idempotency/settlement argument.
- Scope recovery to the selected task when resuming one East task; global startup recovery is a separate host operation.
- Preserve the original attempt identifier and failure reason in the audit trail.
- Inference-bearing steps remain single-attempt unless the provider exposes a durable idempotency key and a verifiable result-retrieval contract.
- Every worker-reported failure must classify its outcome as `definitive` or `unknown`. Only a definitive failure may consume retry budget; an unknown outcome is terminal and requires reconciliation, regardless of retryability or the step's expiry policy. The East adapter treats only its synchronous in-memory core-agent assignment stage as definitive; provider execution, deliberation, and evidence submission failures are unknown.
- If a provider may have completed but the result was not durably committed, mark the step uncertain and require reconciliation. Do not blindly generate again.
- Once any step fails, stop issuing new claims but retain all already-running sibling leases until each owner reports completion/failure or its lease expires and is reconciled. Do not erase a live sibling attempt as a side effect of terminalizing its task.
- Persist bounded deliberation output before advancing to the evidence-gate step. Treat it as untrusted proposal text.
- A completed lifecycle must be returned idempotently without re-running assignment, inference, deliberation, or evidence submission.
- A failed or cancelled lifecycle is terminal until an explicit, separately audited operator action creates a new attempt/workflow.

## Cancellation and shutdown

The lifecycle coordinator records cancellation as durable intent, not as proof that an external operation stopped. A cancellation request immediately blocks new claims and cancels pending steps, but it preserves every active attempt ID and owner lease. The task remains `running` while the durable `task.cancel_requested` event is present and active owners have not settled.

A successful owner settlement allows the requested cancellation to become terminal once no active leases remain. A definitive or unknown worker failure leaves the task failed; an expired lease during cancellation is always uncertain and must not be requeued, even if an older step policy opted into expiry retry. Repeated cancellation requests are idempotent.

The host must separately invoke the provider/runtime cancellation contract and await its drain before releasing a model lease or allowing a replacement generation. Only after that confirmation may the owning worker call `settleCancelledStep`; the coordinator records that owner assertion but cannot verify the provider drain itself. A timeout should leave the resource marked busy or quarantined; the lifecycle intent alone never frees it.

On process shutdown, stop new claims, persist cancellation intent, allow bounded provider drain, and leave unresolved leases recoverable only after their persisted expiry. Startup must reconcile incomplete attempts before accepting new work.

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
- Definitive worker failures and unknown external outcomes are distinct; only definitive failures can retry.
- A failure in one concurrent step cannot clear another live sibling lease; task failure becomes terminal only after active siblings settle.
- Cancellation waits for native generation drain before lease release.
- Schema migration, corruption, disk-full, permission, and key-unavailable cases fail closed. Legacy expiry-policy migration and East adapter failure-stage tests cover the previous persisted-false shape and each provider/evidence boundary.
- Audit events are durable and redact sensitive payloads.
- Physical-device tests cover memory pressure, thermal pressure, process termination, and restart.

## Lifecycle event journal

The coordinator now records ordered task/step transition events in the same durable snapshot as the corresponding state change. Event sequence and deterministic task-local IDs are validated on load; the journal is bounded at 2,048 events and refuses new transitions rather than pruning when full. Legacy snapshots without event history remain readable with an empty journal. This gives restart-visible transition history but is not a separate append-only SQL event table, tamper-evident hash chain, signed Evidence, or APEX authorization. Production audit retention, access controls, redaction, and tamper-evidence still require an explicit design.

## Current status

The coordinator and East adapter provide an injectable store boundary, bounded leases, task-scoped expiry recovery, and idempotent completed-step resumption. The East task map and MessageBus remain in-memory, but the adapter serializes a validated task snapshot plus the new message delta into each successfully completed lifecycle step result. A fresh East runtime and fresh coordinator can rehydrate the task and full message thread from the shared lifecycle store without repeating completed inference; the adapter test now uses distinct runtime instances to prove that boundary.

This is checkpoint-based recovery, not a durable per-message event log. If inference succeeds but the process fails before `completeStep` commits the checkpoint, the output may be unavailable after restart. Inference steps remain single-attempt and must fail closed for operator reconciliation rather than silently regenerate. A provider idempotency/result-retrieval contract or transactional outbox is still required to close that crash window. The restart test uses the shared in-memory store interface; the PostgreSQL adapter's atomicity/version-conflict tests are separate, and no live production database integration is claimed. New leases now persist a worker owner identity and reject completion/failure from a different coordinator; legacy ownerless attempts remain readable but must expire before recovery. A deterministic fake PostgreSQL adapter test verifies that concurrent workers cannot both claim the same step and that the losing worker cannot complete the winner's lease. No live PostgreSQL deployment, tenant RLS policy, transaction-pooling integration, or production credentials are configured. A durable `MemoryStore` must also be injected if episodic memory is expected to survive a process restart. Provider cancellation propagation/drain and production database/RLS configuration remain open work; the new cancellation marker is lifecycle intent only, not provider settlement.
