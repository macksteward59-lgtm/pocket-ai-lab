# East Lifecycle Remediation Plan

**Status:** Design/handoff only; not an approved implementation or production contract.
**Scope:** TaskLifecycleCoordinator, its East adapter, the host execution supervisor, and the durable lifecycle store.
**Authority boundary:** This plan does not grant the lifecycle kernel execution permission. APEX/Director approval, BridgeGate authorization, ExploitGym isolation, and signed Evidence verification remain independent.

## Why this must be coordinated

The current codex/east-durable-event-journal head (d00260e4a1c3d0f3e8902b756e67e5cfcaf36bc4) has three related lifecycle hazards documented in PR #187:

1. failStep() derives uncertainty from uncertainOnExpiredLease, although that flag describes lease-expiry policy. An explicitly settled definitive provider failure can be mislabeled uncertain.
2. recoverExpiredLeases() can clear an expired attempt and return a step to pending based on retry count/flag alone. It does not ask whether an external provider execution or side effect settled.
3. refreshTaskStatus() cancels and clears every running sibling when one step fails. With concurrent workers, this can erase a still-live external execution's lifecycle handle before the host has stopped or drained it.

The same ordering issue exists in cancelTask(): a workflow terminal state is written before external execution is proven settled. These are not independent cosmetic defects. They stem from treating workflow state changes as if they were execution-supervisor settlement.

## Required state model

Keep workflow outcome separate from execution-control state.

- Workflow state: dependency/plan progress and eventual completed, failed, or cancelled outcome.
- Attempt state: exact {taskId, stepId, attemptId, ownerId} identity, immutable once issued.
- External execution state: host-issued opaque generation ID, provider/e3 correlation identifiers, idempotency key when supported, dispatch state, cancellation-request state, provider settlement state, e3 stop state, and reconciliation outcome.
- Supervisor state: whether new claims are fenced, which exact attempts are stopping, and which attempts have confirmed settlement versus unknown outcome.

Do not infer provider settlement from worker process exit, expired lease, e3 process-group stop, HTTP disconnect, timeout, or an AbortSignal being raised. These may initiate cancellation but are not proof native/provider work has stopped.

## Implementation sequence

### Gate 0 — preserve current branch and establish contract
- Keep PR #187 draft/unmerged while lifecycle safety remains unresolved.
- Do not make a narrow failStep() change that leaves expiry replay and sibling invalidation unchanged.
- Keep the serial East adapter behavior unchanged until the host supervisor contract is available.
- Do not change e3 platform callback signatures or invent undocumented cancellation parameters.

### Gate 1 — define typed outcomes and retry policy

Replace boolean-shaped failure interpretation with explicit, validated input from the host:
- definitive_failure: provider/operation has settled and reports a definitive failure.
- outcome_unknown: dispatch may have happened, but settlement/result cannot be established.
- Retry eligibility is a separate host decision. It requires a bounded retry budget plus an operation/provider idempotency or exact-settlement guarantee.

uncertainOnExpiredLease may describe legacy lease-expiry behavior only; it must not classify an explicit worker-reported failure. Missing or malformed classification fails closed. Keep compatibility behavior explicit rather than silently reinterpreting existing snapshots.

### Gate 2 — introduce a durable host execution record

Before external dispatch, persist a record correlated to the exact attempt:

{ taskId, stepId, attemptId, ownerId, generationId, provider, e3WorkspaceId?, e3RunId?, idempotencyKey?, dispatchState, cancelState, providerSettlement, e3StopState, reconciliationState, timestamps }

Requirements:
- IDs are opaque, bounded, unique, and validated; they are not authorization credentials.
- Persist dispatch intent before calling the provider. Record dispatch acknowledgement and terminal settlement as separate transitions.
- Cancellation is idempotent and targets the exact generation/attempt. A stale cancellation cannot stop a newer generation.
- Unknown outcome retains the correlation and fences replacement work. Operator reconciliation is explicit and audited.
- Store no unnecessary prompt/output payloads or secrets in this execution-control record.

### Gate 3 — solve the persistence migration before changing stored shape

The current PostgresTaskLifecycleStore declares schema version 1, writes v1, and rejects any other version. It has no v1-to-v2 upgrade path. Do not add fields to JSONB and assume schema compatibility; do not merely bump currentSchemaVersion.

Choose one reviewed strategy:
1. Versioned aggregate v2: { schemaVersion: 2, recordVersion, tasks, externalExecutions }, with an explicit v1-array-to-v2-envelope migration, atomic CAS, and same-transaction updates of lifecycle state, execution records, and events; or
2. Separate execution table: explicit table schema/version, foreign/correlation constraints, and writes in the same database transaction as lifecycle snapshot/event transitions.

Either strategy must test rollback so a lifecycle event cannot commit without its matching execution state and vice versa. Existing schema-v1 snapshots must be read/migrated without data loss. Unknown future versions fail closed. Preserve namespace isolation, record-version CAS, and production RLS/tenant authorization requirements.

### Gate 4 — make cancellation and failure host-supervised

The host supervisor must:
1. Fence new claims for the affected task.
2. Snapshot the exact active attempt set, including owner and generation IDs.
3. Persist cancellation/stop intent.
4. Signal each exact provider/e3 execution through the documented host API.
5. Await confirmed settlement within a bounded policy.
6. Keep unresolved executions busy/quarantined and reconciliation-required on timeout or unknown outcome.
7. Commit sibling cancellation and terminal workflow state only after required settlements are confirmed, or record a nonterminal/unknown state without erasing active correlations.

A single failed step must not erase a still-running sibling attempt. A late result from a stale attempt remains fenced and cannot overwrite a newer state.

### Gate 5 — make recovery settlement-aware

Lease expiry is not retry authorization. Recovery must consult the durable execution supervisor for the exact expired attempt:
- No dispatch record: safe recovery may be allowed by explicit local-operation policy.
- Confirmed terminal provider settlement: retry only if operation idempotency/result-retrieval policy permits it.
- Provider/e3 execution still running, unknown, missing correlation after possible dispatch, or supervisor unavailable: retain reconciliation-required state and do not issue a replacement claim.
- Never infer safe retry from maxAttempts, uncertainOnExpiredLease, or elapsed wall-clock time alone.

### Gate 6 — integrate e3 without undocumented assumptions

The deployed e3 task declaration currently does not expose the in-process AbortSignal contract used by the direct East adapter. The host supervisor must own correlation and cancellation around the documented e3 execution surface. Process termination may be one stop request, but provider drain confirmation must come from the provider/runtime contract. Do not claim end-to-end cancellation until the actual deployed e3 path is wired and tested.

## Required regression matrix

| Scenario | Required invariant |
|---|---|
| Explicit definitive provider rejection | Failed, not uncertain; retry only when host policy explicitly permits |
| Worker lost after external dispatch | Attempt remains correlated; no second claim until exact settlement/reconciliation |
| Provider succeeded, checkpoint write failed | Unknown/reconcilable; no duplicate inference |
| Provider still running after host disconnect | Lease/resource remains busy or quarantined |
| Cancellation requested then process restart | Supervisor reconciles same generation before new work |
| Stale cancellation arrives after new generation | New generation is unaffected |
| Two concurrent steps; one fails | Sibling attempt remains correlated until its own settlement |
| Sibling settlement unknown | Task does not falsely claim all work stopped |
| Crash between intent, dispatch, ack, settlement, and snapshot writes | Atomic recovery or explicit unknown; never silent replay |
| v1 snapshot migration | Existing tasks/events preserved and upgraded transactionally |
| Unknown future schema | Fail closed |
| Event journal full / DB rollback | No partial state or execution-record commit |
| Two processes claim/recover concurrently | CAS/locking permits one owner and prevents stale overwrite |

Run unit tests, PostgreSQL integration tests against a real PostgreSQL service, crash/fault-injection tests, and host/e3 integration tests. Simulator CI is not physical iPhone acceptance; physical-device process termination, backgrounding, memory/thermal pressure, and native provider drain remain separate acceptance.

## Completion criteria

This work is not production-ready until all gates above are implemented and independently reviewed. PR #187's current event journal is useful audit metadata but is not itself an execution journal or supervisor. PR #188's direct adapter cancellation tests do not prove deployed e3 cancellation. No step in this plan changes APEX authority, Evidence signing, runtime attestation, BridgeGate authorization, or ExploitGym policy.
