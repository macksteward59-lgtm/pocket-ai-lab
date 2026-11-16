# Autonomous Task Lifecycle Kernel

**Status:** Implemented foundation; host integration and production persistence remain open.  
**Package:** `packages/intelligence/autonomy/TaskLifecycleCoordinator.ts`

## Purpose

The lifecycle kernel gives Pocket AI Lab a durable, inspectable control loop for multi-step objectives. It owns task plans, dependency readiness, bounded worker leases, retry budgets, cancellation, restart recovery, and evidence references. It is provider-neutral and does not call a model or execute a tool.

This is an autonomy foundation, not a claim that the complete product can yet operate unattended. A host runner must connect real inference and approved capabilities through explicit adapters. Persisted task state, a successful model response, agent consensus, or a completed step is never an APEX approval or authorization receipt.

## Lifecycle

Task states:

- `ready`: at least one step can be claimed or is waiting for dependencies.
- `running`: one or more step leases are active.
- `completed`: every step succeeded.
- `failed`: a step exhausted its retry budget or failed non-retryably.
- `cancelled`: the task was explicitly cancelled.

Step states:

- `pending`: not yet claimed.
- `running`: claimed by one attempt with an expiring lease.
- `succeeded`: completed with a non-empty result and optional evidence references.
- `failed`: retry budget exhausted or failure marked non-retryable.
- `cancelled`: no longer eligible to run because the task was cancelled or failed.

A plan is a directed acyclic graph. A step can be claimed only after all dependencies succeeded. Claims are serialized, concurrency is bounded, and each claim receives a unique attempt ID. Completion and failure calls must present that exact active attempt ID. Late, expired, duplicate, and stale worker results are rejected.

## Persistence and recovery

Hosts inject a `TaskLifecycleStore`. Its `save` operation must atomically replace the full snapshot or leave the prior snapshot intact. The included `InMemoryTaskLifecycleStore` is for tests and ephemeral use only; it is not durable across process restarts. `PostgresTaskLifecycleStore` provides a namespaced transactional JSONB adapter with row locks and record-version compare-and-swap, but the host must inject a real PostgreSQL transaction implementation and deploy the reviewed migration.

On startup, call `init()`, then `recoverExpiredLeases()` to recover all tasks, or pass a task ID to recover only that task. Task-scoped recovery validates that the task exists and leaves unrelated task leases untouched. Expired attempts are requeued only while the step's bounded attempt budget remains; otherwise they fail and outstanding work is cancelled. The kernel does not start work merely because it was recovered. A host scheduler must explicitly claim the next ready step.

The in-process mutation queue prevents races among callers using one coordinator instance. A production store shared by multiple processes needs its own transactional compare-and-swap, row locking, or equivalent cross-process claim mechanism. The PostgreSQL adapter provides this contract but does not provision the database, driver, credentials, TLS, tenant RLS, encryption, backups, or migration deployment. The in-memory queue is not a distributed lock. If a save returns `store_conflict`, call `reload()` to replace the coordinator's in-memory snapshot with the authoritative stored state, then reconcile the intended change before retrying; never blindly replay a possibly side-effecting step.

## Example

```ts
import {
  InMemoryTaskLifecycleStore,
  TaskLifecycleCoordinator
} from "./packages/intelligence";

const tasks = new TaskLifecycleCoordinator({
  store: new InMemoryTaskLifecycleStore()
});
await tasks.init();

await tasks.createTask({
  id: "release-readiness",
  objective: "Validate a release candidate",
  maxConcurrentSteps: 2,
  steps: [
    { id: "inspect", description: "Inspect the change set" },
    { id: "tests", description: "Run the required test suite" },
    { id: "review", description: "Independently review evidence", dependsOn: ["inspect", "tests"] }
  ]
});

const claim = await tasks.claimNextStep("release-readiness");
if (claim) {
  // Host runner must independently authorize any consequential operation.
  // Call completeStep/failStep with claim.attemptId after the real attempt.
}
```

## Autonomy and authorization boundary

- The kernel records intent, plans, leases, attempts, results, and evidence references.
- It does not invoke arbitrary callbacks, tools, shells, network clients, models, or device actions.
- A host runner must enforce least privilege and call the existing Director/APEX path for consequential operations.
- East/e3 remains the durable execution foundation; this kernel does not replace it or claim East/APEX integration.
- Failed validation is not success. Evidence references are pointers, not verified evidence.
- Retryable failures are bounded. Side-effecting host adapters must be idempotent or independently deduplicate attempts before retry.
- Cancellation invalidates active leases; hosts must propagate cancellation to workers and stop side effects where possible.
- The system must stop when authorization, dependencies, resource budgets, or safety conditions are unresolved.

## Acceptance and remaining work

The focused tests cover DAG validation, dependency order, concurrent claims, bounded retry, stale/expired attempt rejection, cancellation, restart recovery, and atomic-store failure behavior.

Still required before production autonomy:

1. A production transactional store with cross-process lease claims and migrations.
2. A host scheduler with budgets, deadlines, backoff, fairness, and cancellation propagation.
3. Real inference/provider adapters and bounded agent delegation.
4. A governed action adapter that checks exact-scope authorization before each consequential effect.
5. East/e3 workflow integration and correlated execution evidence.
6. Fault-injection, multi-process concurrency, restart, and end-to-end acceptance tests.
7. Native iOS lifecycle, background execution constraints, resource/thermal budgets, and physical-device acceptance.

Do not describe the product as fully autonomous until these integrations are implemented and verified.


## East integration bridge

`packages/intelligence/autonomy/EastTaskLifecycleAdapter.ts` connects the lifecycle kernel to the existing East eight-agent deliberation API. It creates a serial dependency plan for assignment, each of the eight permanent agent executions, deliberation, and the non-authorizing evidence-gate result. Every stage is claimed and completed through the lifecycle coordinator.

The bridge deliberately uses one attempt for each inference-bearing step. Re-entering the adapter with the same lifecycle ID and a compatible task definition resumes from persisted lifecycle state; completed assignment, agent, and deliberation steps are not repeated. The actual deliberation text is stored as the bounded result of the `deliberate` step so a resumed invocation can complete the final evidence-gate stage without generating it again. A completed lifecycle is idempotently returned. A failed or cancelled lifecycle is terminal and requires operator review rather than implicit replay. If a provider call may have happened but its completion was not durably recorded, the adapter does not blindly repeat generation; expired leases are recovered according to the lifecycle retry policy, while the East bridge keeps inference steps single-attempt. An unexpired lease remains owned by its original attempt: a concurrent or premature re-entry cannot claim the next step and will report that the lifecycle has not completed. The host must wait for that attempt to finish or for its lease to expire before recovery; the adapter does not steal a live lease.

The bridge returns `authorized: false` and surfaces East's current APEX decision/evidence-gate states. Each successful lifecycle step now stores a versioned East task/thread checkpoint. When a fresh East runtime no longer has the task, the adapter restores the latest validated checkpoint, including the message thread, without notifying listeners or repeating completed agent calls. Checkpoint step IDs are checked against their lifecycle step before restoration. East memory remains a separate injected MemoryStore concern: the host must supply durable memory storage if unverified synthesis memory must survive process restart. Re-entry is only as durable as the injected lifecycle store and memory store. The coordinator's injected store must be a production transactional implementation before this bridge is used for production recovery. It also does not cancel an already-running provider request when a task is cancelled; cancellation propagation requires a cancellable East/InferenceProvider contract.

The bridge is an integration milestone and test seam, not the final production scheduler. It must not be interpreted as APEX authorization, accepted evidence, or a release-ready end-to-end workflow.
