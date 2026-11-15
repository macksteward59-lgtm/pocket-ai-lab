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

Hosts inject a `TaskLifecycleStore`. Its `save` operation must atomically replace the full snapshot or leave the prior snapshot intact. The included `InMemoryTaskLifecycleStore` is for tests and ephemeral use only; it is not durable across process restarts.

On startup, call `init()`, then `recoverExpiredLeases()`. Expired attempts are requeued only while the step's bounded attempt budget remains; otherwise they fail and outstanding work is cancelled. The kernel does not start work merely because it was recovered. A host scheduler must explicitly claim the next ready step.

The in-process mutation queue prevents races among callers using one coordinator instance. A production store shared by multiple processes needs its own transactional compare-and-swap, row locking, or equivalent cross-process claim mechanism. The in-memory queue is not a distributed lock.

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
