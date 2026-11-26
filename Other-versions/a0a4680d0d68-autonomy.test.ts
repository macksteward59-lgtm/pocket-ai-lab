import { describe, expect, it } from "vitest";
import {
  InMemoryTaskLifecycleStore,
  TaskLifecycleCoordinator,
  TaskLifecycleError,
  type TaskLifecycleStore,
  type TaskRecord
} from "../autonomy/TaskLifecycleCoordinator";

function harness(options: { leaseMs?: number; maxConcurrentSteps?: number; workerId?: string } = {}) {
  let milliseconds = Date.parse("2026-11-15T12:00:00.000Z");
  let nextId = 0;
  const store = new InMemoryTaskLifecycleStore();
  const now = () => new Date(milliseconds);
  const coordinator = new TaskLifecycleCoordinator({
    store,
    now,
    createId: () => "attempt-" + (++nextId),
    workerId: options.workerId ?? "worker-main",
  });
  const advance = (ms: number) => { milliseconds += ms; };
  const create = () => coordinator.createTask({
    id: "task-1",
    objective: "Build and validate one integrated workflow",
    maxConcurrentSteps: options.maxConcurrentSteps,
    leaseMs: options.leaseMs,
    steps: [
      { id: "inspect", description: "Inspect the current implementation", maxAttempts: 2 },
      { id: "implement", description: "Implement the selected improvement", dependsOn: ["inspect"], maxAttempts: 2 },
      { id: "verify", description: "Verify the integrated result", dependsOn: ["implement"], maxAttempts: 1 }
    ]
  });
  return { coordinator, store, advance, create, now };
}

describe("TaskLifecycleCoordinator", () => {
  it("reloads the authoritative snapshot after a durable store conflict", async () => {
    const backing = new InMemoryTaskLifecycleStore();
    let conflictNextSave = false;
    const store: TaskLifecycleStore = {
      load: () => backing.load(),
      save: records => {
        if (conflictNextSave) {
          conflictNextSave = false;
          throw new TaskLifecycleError("store_conflict", "A concurrent writer advanced the snapshot");
        }
        backing.save(records);
      }
    };
    const coordinator = new TaskLifecycleCoordinator({ store });
    await coordinator.init();

    const concurrentWriter = new TaskLifecycleCoordinator({ store: backing });
    await concurrentWriter.init();
    await concurrentWriter.createTask({
      id: "remote-task", objective: "Written by another coordinator",
      steps: [{ id: "one", description: "Remote work" }]
    });

    conflictNextSave = true;
    await expect(coordinator.createTask({
      id: "local-task", objective: "Must not overwrite the concurrent writer",
      steps: [{ id: "one", description: "Local work" }]
    })).rejects.toMatchObject({ code: "store_conflict" });
    expect(coordinator.listTasks()).toHaveLength(0);

    await coordinator.reload();
    expect(coordinator.listTasks().map(task => task.id)).toEqual(["remote-task"]);
    await coordinator.createTask({
      id: "local-task", objective: "Retry after reconciling the latest snapshot",
      steps: [{ id: "one", description: "Local work" }]
    });
    expect(coordinator.listTasks().map(task => task.id).sort()).toEqual(["local-task", "remote-task"]);
  });

  it("requires initialization and validates dependency graphs before persisting", async () => {
    const store = new InMemoryTaskLifecycleStore();
    const coordinator = new TaskLifecycleCoordinator({ store });
    expect(() => coordinator.listTasks()).toThrow(/Call init/);
    await coordinator.init();
    await expect(coordinator.createTask({
      id: "cycle", objective: "Invalid graph",
      steps: [
        { id: "a", description: "A", dependsOn: ["b"] },
        { id: "b", description: "B", dependsOn: ["a"] }
      ]
    })).rejects.toMatchObject({ code: "cyclic_plan" });
    expect(coordinator.listTasks()).toHaveLength(0);
  });

  it("claims dependency-ready steps and completes the whole task in order", async () => {
    const h = harness();
    await h.coordinator.init();
    await h.create();
    const first = await h.coordinator.claimNextStep("task-1");
    expect(first?.stepId).toBe("inspect");
    expect(await h.coordinator.claimNextStep("task-1")).toBeNull();

    await h.coordinator.completeStep({
      taskId: "task-1", stepId: "inspect", attemptId: first!.attemptId,
      result: "Repository inventory complete", evidenceRefs: ["commit:abc"]
    });
    const second = await h.coordinator.claimNextStep("task-1");
    expect(second?.stepId).toBe("implement");
    expect(second?.completedDependencies[0]).toMatchObject({
      stepId: "inspect", result: "Repository inventory complete", evidenceRefs: ["commit:abc"]
    });
    await h.coordinator.completeStep({
      taskId: "task-1", stepId: "implement", attemptId: second!.attemptId, result: "Change implemented"
    });
    const third = await h.coordinator.claimNextStep("task-1");
    expect(third?.stepId).toBe("verify");
    const completed = await h.coordinator.completeStep({
      taskId: "task-1", stepId: "verify", attemptId: third!.attemptId, result: "Acceptance checks passed"
    });
    expect(completed.status).toBe("completed");
    expect(completed.completedAt).toBeTruthy();
    expect(await h.coordinator.claimNextStep("task-1")).toBeNull();
  });

  it("enforces bounded concurrency and serializes concurrent claims", async () => {
    const h = harness({ maxConcurrentSteps: 2 });
    await h.coordinator.init();
    await h.coordinator.createTask({
      id: "parallel", objective: "Run independent checks",
      maxConcurrentSteps: 2,
      steps: [
        { id: "lint", description: "Run lint" },
        { id: "unit", description: "Run unit tests" },
        { id: "report", description: "Combine results", dependsOn: ["lint", "unit"] }
      ]
    });
    const claims = await Promise.all([
      h.coordinator.claimNextStep("parallel"),
      h.coordinator.claimNextStep("parallel")
    ]);
    expect(claims.filter(Boolean)).toHaveLength(2);
    expect(new Set(claims.map(claim => claim?.stepId))).toEqual(new Set(["lint", "unit"]));
    expect(await h.coordinator.claimNextStep("parallel")).toBeNull();
    const [lint, unit] = claims as NonNullable<(typeof claims)[number]>[];
    await h.coordinator.completeStep({
      taskId: "parallel", stepId: lint.stepId, attemptId: lint.attemptId, result: "lint clean"
    });
    await h.coordinator.completeStep({
      taskId: "parallel", stepId: unit.stepId, attemptId: unit.attemptId, result: "tests pass"
    });
    expect((await h.coordinator.claimNextStep("parallel"))?.stepId).toBe("report");
  });

  it("retries only retryable failures within the configured attempt budget", async () => {
    const h = harness();
    await h.coordinator.init();
    await h.create();
    const first = await h.coordinator.claimNextStep("task-1");
    const retry = await h.coordinator.failStep({
      taskId: "task-1", stepId: "inspect", attemptId: first!.attemptId,
      error: "Transient provider failure", retryable: true
    });
    expect(retry.status).toBe("ready");
    const second = await h.coordinator.claimNextStep("task-1");
    expect(second?.attemptNumber).toBe(2);
    const failed = await h.coordinator.failStep({
      taskId: "task-1", stepId: "inspect", attemptId: second!.attemptId,
      error: "Repeated failure", retryable: true
    });
    expect(failed.status).toBe("failed");
    expect(failed.steps.find(step => step.id === "implement")?.status).toBe("cancelled");
    expect(failed.steps.some(step => step.currentAttempt !== null)).toBe(false);
  });

  it("recovers expired leases and rejects stale completion attempts", async () => {
    const h = harness({ leaseMs: 1_000 });
    await h.coordinator.init();
    await h.create();
    const claim = await h.coordinator.claimNextStep("task-1");
    h.advance(1_001);
    await expect(h.coordinator.completeStep({
      taskId: "task-1", stepId: claim!.stepId, attemptId: claim!.attemptId, result: "late"
    })).rejects.toMatchObject({ code: "expired_attempt" });
    expect(await h.coordinator.recoverExpiredLeases()).toBe(1);
    const retried = await h.coordinator.claimNextStep("task-1");
    expect(retried?.attemptNumber).toBe(2);
    await expect(h.coordinator.completeStep({
      taskId: "task-1", stepId: claim!.stepId, attemptId: claim!.attemptId, result: "stale"
    })).rejects.toMatchObject({ code: "stale_attempt" });
  });

  it("marks expired single-attempt work uncertain and never auto-replays it after restart", async () => {
    let milliseconds = Date.parse("2026-11-17T12:00:00.000Z");
    const now = () => new Date(milliseconds);
    const store = new InMemoryTaskLifecycleStore();
    const coordinator = new TaskLifecycleCoordinator({
      store,
      now,
      workerId: "worker-side-effect"
    });
    await coordinator.init();
    await coordinator.createTask({
      id: "uncertain-side-effect",
      objective: "Do not duplicate a side effect after an ambiguous provider outcome",
      leaseMs: 1_000,
      steps: [{ id: "publish", description: "Perform one non-idempotent external side effect", maxAttempts: 1 }]
    });

    const claim = await coordinator.claimNextStep("uncertain-side-effect");
    expect(claim?.ownerId).toBe("worker-side-effect");
    milliseconds += 1_001;

    expect(await coordinator.recoverExpiredLeases("uncertain-side-effect")).toBe(1);
    const recovered = coordinator.getTask("uncertain-side-effect");
    expect(recovered.steps[0]).toMatchObject({
      status: "failed",
      uncertain: true,
      uncertainOnExpiredLease: true,
      currentAttempt: null
    });
    expect(recovered.steps[0].lastError).toContain("outcome is uncertain");
    expect(await coordinator.claimNextStep("uncertain-side-effect")).toBeNull();

    const persisted = await store.load();
    expect(persisted[0].steps[0].uncertain).toBe(true);
    const restarted = new TaskLifecycleCoordinator({
      store,
      now,
      workerId: "worker-after-restart"
    });
    await restarted.init();
    expect(restarted.getTask("uncertain-side-effect").steps[0].uncertain).toBe(true);
    expect(await restarted.claimNextStep("uncertain-side-effect")).toBeNull();
  });

  it("binds a live lease to its claiming worker and rejects foreign completion or failure", async () => {
    const h = harness();
    await h.coordinator.init();
    await h.create();
    const claim = await h.coordinator.claimNextStep("task-1");
    const foreign = new TaskLifecycleCoordinator({
      store: h.store,
      now: h.now,
      workerId: "worker-foreign"
    });
    await foreign.init();

    await expect(foreign.completeStep({
      taskId: "task-1", stepId: claim!.stepId, attemptId: claim!.attemptId, result: "foreign completion"
    })).rejects.toMatchObject({ code: "lease_owner_mismatch" });
    await expect(foreign.failStep({
      taskId: "task-1", stepId: claim!.stepId, attemptId: claim!.attemptId, error: "foreign failure"
    })).rejects.toMatchObject({ code: "lease_owner_mismatch" });

    const completed = await h.coordinator.completeStep({
      taskId: "task-1", stepId: claim!.stepId, attemptId: claim!.attemptId, result: "owner completion"
    });
    expect(completed.steps[0].status).toBe("succeeded");
    expect(claim?.ownerId).toBe("worker-main");
  });

  it("does not let a restarted worker adopt a live lease and recovers it only after expiry", async () => {
    const h = harness({ leaseMs: 1_000 });
    await h.coordinator.init();
    await h.create();
    const original = await h.coordinator.claimNextStep("task-1");
    const restarted = new TaskLifecycleCoordinator({
      store: h.store,
      now: h.now,
      workerId: "worker-restarted"
    });
    await restarted.init();

    await expect(restarted.completeStep({
      taskId: "task-1", stepId: original!.stepId, attemptId: original!.attemptId, result: "adopted"
    })).rejects.toMatchObject({ code: "lease_owner_mismatch" });

    h.advance(1_001);
    expect(await restarted.recoverExpiredLeases("task-1")).toBe(1);
    const replacement = await restarted.claimNextStep("task-1");
    expect(replacement?.attemptNumber).toBe(2);
    expect(replacement?.ownerId).toBe("worker-restarted");
  });

  it("fails closed on a legacy active lease without owner identity until it expires", async () => {
    const h = harness({ leaseMs: 1_000 });
    await h.coordinator.init();
    await h.create();
    const original = await h.coordinator.claimNextStep("task-1");
    const persisted = await h.store.load();
    delete persisted[0].steps[0].currentAttempt!.ownerId;
    await h.store.save(persisted);

    const restarted = new TaskLifecycleCoordinator({
      store: h.store,
      now: h.now,
      workerId: "worker-after-legacy"
    });
    await restarted.init();
    await expect(restarted.completeStep({
      taskId: "task-1", stepId: original!.stepId, attemptId: original!.attemptId, result: "legacy adoption"
    })).rejects.toMatchObject({ code: "unowned_attempt" });

    h.advance(1_001);
    expect(await restarted.recoverExpiredLeases("task-1")).toBe(1);
    expect((await restarted.claimNextStep("task-1"))?.attemptNumber).toBe(2);
  });

  it("rejects malformed persisted worker owner identities", async () => {
    const h = harness();
    await h.coordinator.init();
    await h.create();
    await h.coordinator.claimNextStep("task-1");
    const persisted = await h.store.load();
    persisted[0].steps[0].currentAttempt!.ownerId = "x".repeat(257);
    await h.store.save(persisted);

    const restarted = new TaskLifecycleCoordinator({ store: h.store, now: h.now, workerId: "worker-validated" });
    await expect(restarted.init()).rejects.toMatchObject({ code: "corrupt_store" });
  });

  it("persists state across coordinator recreation and recovers exhausted leases as failure", async () => {
    let milliseconds = Date.parse("2026-11-15T12:00:00.000Z");
    let id = 0;
    const store = new InMemoryTaskLifecycleStore();
    const options = { store, now: () => new Date(milliseconds), createId: () => "persist-" + (++id) };
    const first = new TaskLifecycleCoordinator(options);
    await first.init();
    await first.createTask({
      id: "persisted", objective: "Survive restart", leaseMs: 1_000,
      steps: [{ id: "only", description: "One step", maxAttempts: 1 }]
    });
    await first.claimNextStep("persisted");
    milliseconds += 1_001;
    const restarted = new TaskLifecycleCoordinator(options);
    await restarted.init();
    expect(await restarted.recoverExpiredLeases()).toBe(1);
    expect(restarted.getTask("persisted").status).toBe("failed");
  });

  it("recovers only the requested task when scoped lease recovery is used", async () => {
    let milliseconds = Date.parse("2026-11-16T00:00:00.000Z");
    let nextId = 0;
    const store = new InMemoryTaskLifecycleStore();
    const coordinator = new TaskLifecycleCoordinator({
      store,
      now: () => new Date(milliseconds),
      createId: () => "scoped-attempt-" + (++nextId)
    });
    await coordinator.init();
    for (const id of ["task-one", "task-two"]) {
      await coordinator.createTask({
        id, objective: "Recover one task without disturbing another",
        leaseMs: 1_000,
        steps: [{ id: "work", description: "Work", maxAttempts: 2 }]
      });
      await coordinator.claimNextStep(id);
    }
    milliseconds += 1_001;

    expect(await coordinator.recoverExpiredLeases("task-one")).toBe(1);
    expect(coordinator.getTask("task-one").steps[0].status).toBe("pending");
    expect(coordinator.getTask("task-two").steps[0].status).toBe("running");

    expect(await coordinator.recoverExpiredLeases()).toBe(1);
    expect(coordinator.getTask("task-two").steps[0].status).toBe("pending");
    await expect(coordinator.recoverExpiredLeases("missing-task"))
      .rejects.toMatchObject({ code: "unknown_task" });
  });

  it("cancels live leases and ignores late worker results", async () => {
    const h = harness();
    await h.coordinator.init();
    await h.create();
    const claim = await h.coordinator.claimNextStep("task-1");
    const cancelled = await h.coordinator.cancelTask("task-1");
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.steps[0].currentAttempt).toBeNull();
    await expect(h.coordinator.completeStep({
      taskId: "task-1", stepId: claim!.stepId, attemptId: claim!.attemptId, result: "too late"
    })).rejects.toMatchObject({ code: "stale_attempt" });
  });

  it("does not publish in-memory state when durable save fails", async () => {
    let records: TaskRecord[] = [];
    const store: TaskLifecycleStore = {
      load: () => records,
      save: () => { throw new Error("disk unavailable"); }
    };
    const coordinator = new TaskLifecycleCoordinator({ store });
    await coordinator.init();
    await expect(coordinator.createTask({
      id: "atomic", objective: "Atomic save", steps: [{ id: "one", description: "One" }]
    })).rejects.toThrow("disk unavailable");
    expect(coordinator.listTasks()).toHaveLength(0);
    expect(records).toHaveLength(0);
  });

  it("rejects reuse of an attempt identifier across steps", async () => {
    const coordinator = new TaskLifecycleCoordinator({
      store: new InMemoryTaskLifecycleStore(),
      createId: () => "same-attempt"
    });
    await coordinator.init();
    await coordinator.createTask({
      id: "unique-attempts", objective: "Attempt IDs must never repeat",
      maxConcurrentSteps: 2,
      steps: [
        { id: "first", description: "First independent step" },
        { id: "second", description: "Second independent step" }
      ]
    });
    await coordinator.claimNextStep("unique-attempts");
    await expect(coordinator.claimNextStep("unique-attempts"))
      .rejects.toMatchObject({ code: "duplicate_attempt_id" });
  });

  it("does not mutate live state when a claim cannot be durably saved", async () => {
    let fail = false;
    const backing = new InMemoryTaskLifecycleStore();
    const store: TaskLifecycleStore = {
      load: () => backing.load(),
      save: records => {
        if (fail) throw new Error("write failed");
        backing.save(records);
      }
    };
    const coordinator = new TaskLifecycleCoordinator({ store, createId: () => "attempt-atomic" });
    await coordinator.init();
    await coordinator.createTask({
      id: "atomic-claim", objective: "Claim must be atomic",
      steps: [{ id: "one", description: "One step" }]
    });
    fail = true;
    await expect(coordinator.claimNextStep("atomic-claim")).rejects.toThrow("write failed");
    fail = false;
    expect(coordinator.getTask("atomic-claim").steps[0]).toMatchObject({
      status: "pending", attempts: 0, attemptIds: [], currentAttempt: null
    });
  });

  it("preserves retry history when a pending task is restored", async () => {
    const store = new InMemoryTaskLifecycleStore();
    const coordinator = new TaskLifecycleCoordinator({ store, createId: () => "retry-attempt" });
    await coordinator.init();
    await coordinator.createTask({
      id: "retry-restore", objective: "Restore a retryable failure",
      steps: [{ id: "one", description: "One step", maxAttempts: 2 }]
    });
    const claim = await coordinator.claimNextStep("retry-restore");
    await coordinator.failStep({
      taskId: "retry-restore", stepId: "one", attemptId: claim!.attemptId,
      error: "Transient failure", retryable: true
    });

    const restarted = new TaskLifecycleCoordinator({ store, createId: () => "retry-attempt-2" });
    await restarted.init();
    expect(restarted.getTask("retry-restore").steps[0]).toMatchObject({
      status: "pending", attempts: 1, lastError: "Transient failure"
    });
    expect((await restarted.claimNextStep("retry-restore"))?.attemptNumber).toBe(2);
  });

  it("rejects a persisted active attempt whose id is not the latest issued id", async () => {
    const store = new InMemoryTaskLifecycleStore();
    const coordinator = new TaskLifecycleCoordinator({ store, createId: () => "issued-attempt" });
    await coordinator.init();
    await coordinator.createTask({
      id: "tampered-attempt", objective: "Reject forged persisted lease identity",
      steps: [{ id: "one", description: "One step" }]
    });
    await coordinator.claimNextStep("tampered-attempt");

    const snapshot = store.load();
    snapshot[0].steps[0].currentAttempt!.id = "forged-attempt";
    store.save(snapshot);

    const restarted = new TaskLifecycleCoordinator({ store });
    await expect(restarted.init()).rejects.toMatchObject({ code: "corrupt_store" });
  });

  it("rejects duplicate attempt identities across persisted tasks", async () => {
    const store = new InMemoryTaskLifecycleStore();
    let nextAttempt = 0;
    const coordinator = new TaskLifecycleCoordinator({
      store, createId: () => "unique-attempt-" + (++nextAttempt)
    });
    await coordinator.init();
    for (const id of ["first-task", "second-task"]) {
      await coordinator.createTask({
        id, objective: "Create independent task " + id,
        steps: [{ id: "one", description: "One step" }]
      });
      await coordinator.claimNextStep(id);
    }

    const snapshot = store.load();
    snapshot[1].steps[0].attemptIds[0] = snapshot[0].steps[0].attemptIds[0];
    snapshot[1].steps[0].currentAttempt!.id = snapshot[0].steps[0].attemptIds[0];
    store.save(snapshot);

    const restarted = new TaskLifecycleCoordinator({ store });
    await expect(restarted.init()).rejects.toMatchObject({ code: "corrupt_store" });
  });

  it("rejects malformed persisted timestamps and evidence references", async () => {
    const store = new InMemoryTaskLifecycleStore();
    const coordinator = new TaskLifecycleCoordinator({ store });
    await coordinator.init();
    await coordinator.createTask({
      id: "bad-record", objective: "Reject malformed persisted data",
      steps: [{ id: "one", description: "One step" }]
    });

    const snapshot = store.load();
    snapshot[0].createdAt = "not-a-timestamp";
    snapshot[0].steps[0].evidenceRefs = [""];
    store.save(snapshot);

    const restarted = new TaskLifecycleCoordinator({ store });
    await expect(restarted.init()).rejects.toMatchObject({ code: "corrupt_store" });
  });

  it("rejects persisted attempt budgets exhausted while pending and impossible task completion chronology", async () => {
    const store = new InMemoryTaskLifecycleStore();
    const coordinator = new TaskLifecycleCoordinator({ store, createId: () => "chronology-attempt" });
    await coordinator.init();
    await coordinator.createTask({
      id: "invalid-pending-budget", objective: "Reject exhausted pending work",
      steps: [{ id: "one", description: "One step", maxAttempts: 2 }]
    });

    const exhausted = store.load();
    exhausted[0].steps[0].attempts = 2;
    exhausted[0].steps[0].attemptIds = ["attempt-one", "attempt-two"];
    store.save(exhausted);
    const restartedAfterBudgetTamper = new TaskLifecycleCoordinator({ store });
    await expect(restartedAfterBudgetTamper.init()).rejects.toMatchObject({ code: "corrupt_store" });

    const chronologyStore = new InMemoryTaskLifecycleStore();
    const valid = new TaskLifecycleCoordinator({ store: chronologyStore, createId: () => "chronology-success" });
    await valid.init();
    await valid.createTask({
      id: "invalid-completion-time", objective: "Reject impossible completion chronology",
      steps: [{ id: "one", description: "One step" }]
    });
    const claim = await valid.claimNextStep("invalid-completion-time");
    await valid.completeStep({
      taskId: "invalid-completion-time", stepId: "one", attemptId: claim!.attemptId,
      result: "Completed"
    });
    const completed = chronologyStore.load();
    completed[0].completedAt = new Date(Date.parse(completed[0].createdAt) - 1).toISOString();
    chronologyStore.save(completed);
    const restartedAfterChronologyTamper = new TaskLifecycleCoordinator({ store: chronologyStore });
    await expect(restartedAfterChronologyTamper.init()).rejects.toMatchObject({ code: "corrupt_store" });

    const stepChronologyStore = new InMemoryTaskLifecycleStore();
    const stepChronologyCoordinator = new TaskLifecycleCoordinator({
      store: stepChronologyStore, createId: () => "step-chronology-attempt"
    });
    await stepChronologyCoordinator.init();
    await stepChronologyCoordinator.createTask({
      id: "completion-before-step", objective: "Task completion cannot predate its final step",
      steps: [{ id: "one", description: "One step" }]
    });
    const stepClaim = await stepChronologyCoordinator.claimNextStep("completion-before-step");
    await stepChronologyCoordinator.completeStep({
      taskId: "completion-before-step", stepId: "one", attemptId: stepClaim!.attemptId,
      result: "Completed"
    });
    const stepChronology = stepChronologyStore.load();
    stepChronology[0].completedAt = new Date(
      Date.parse(stepChronology[0].steps[0].completedAt!) - 1
    ).toISOString();
    stepChronologyStore.save(stepChronology);
    await expect(new TaskLifecycleCoordinator({ store: stepChronologyStore }).init())
      .rejects.toMatchObject({ code: "corrupt_store" });
  });

  it("rejects persisted cancellation states that the coordinator cannot produce", async () => {
    const completedStore = new InMemoryTaskLifecycleStore();
    const completedCoordinator = new TaskLifecycleCoordinator({ store: completedStore });
    await completedCoordinator.init();
    await completedCoordinator.createTask({
      id: "completed-then-cancelled", objective: "A completed task cannot become cancelled",
      steps: [{ id: "one", description: "One step" }]
    });
    const completedClaim = await completedCoordinator.claimNextStep("completed-then-cancelled");
    await completedCoordinator.completeStep({
      taskId: "completed-then-cancelled", stepId: "one",
      attemptId: completedClaim!.attemptId, result: "Done"
    });
    const completedSnapshot = completedStore.load();
    completedSnapshot[0].status = "cancelled";
    completedStore.save(completedSnapshot);
    await expect(new TaskLifecycleCoordinator({ store: completedStore }).init())
      .rejects.toMatchObject({ code: "corrupt_store" });

    const readyStore = new InMemoryTaskLifecycleStore();
    const readyCoordinator = new TaskLifecycleCoordinator({ store: readyStore });
    await readyCoordinator.init();
    await readyCoordinator.createTask({
      id: "ready-with-cancelled-step", objective: "Ready work cannot contain cancelled steps",
      steps: [{ id: "one", description: "One step" }]
    });
    await readyCoordinator.cancelTask("ready-with-cancelled-step");
    const readySnapshot = readyStore.load();
    readySnapshot[0].status = "ready";
    readySnapshot[0].completedAt = null;
    readyStore.save(readySnapshot);
    await expect(new TaskLifecycleCoordinator({ store: readyStore }).init())
      .rejects.toMatchObject({ code: "corrupt_store" });

    const mixedStore = new InMemoryTaskLifecycleStore();
    const mixedCoordinator = new TaskLifecycleCoordinator({ store: mixedStore, createId: () => "mixed-attempt" });
    await mixedCoordinator.init();
    await mixedCoordinator.createTask({
      id: "cancelled-with-failure", objective: "Cancellation cannot conceal a failed step",
      steps: [
        { id: "first", description: "First step" },
        { id: "second", description: "Second step" }
      ]
    });
    const active = await mixedCoordinator.claimNextStep("cancelled-with-failure");
    await mixedCoordinator.cancelTask("cancelled-with-failure");
    const mixedSnapshot = mixedStore.load();
    mixedSnapshot[0].steps[0].status = "failed";
    mixedSnapshot[0].steps[0].lastError = "Forged failure";
    mixedSnapshot[0].steps[0].attempts = 1;
    mixedSnapshot[0].steps[0].attemptIds = [active!.attemptId];
    mixedStore.save(mixedSnapshot);
    await expect(new TaskLifecycleCoordinator({ store: mixedStore }).init())
      .rejects.toMatchObject({ code: "corrupt_store" });

    const resultStore = new InMemoryTaskLifecycleStore();
    const resultCoordinator = new TaskLifecycleCoordinator({ store: resultStore });
    await resultCoordinator.init();
    await resultCoordinator.createTask({
      id: "cancelled-with-result", objective: "Cancelled steps cannot claim a result",
      steps: [{ id: "one", description: "One step" }]
    });
    await resultCoordinator.cancelTask("cancelled-with-result");
    const resultSnapshot = resultStore.load();
    resultSnapshot[0].steps[0].result = "Forged completion";
    resultStore.save(resultSnapshot);
    await expect(new TaskLifecycleCoordinator({ store: resultStore }).init())
      .rejects.toMatchObject({ code: "corrupt_store" });
  });

  it("rejects unknown and duplicate dependencies and out-of-range controls", async () => {
    const h = harness();
    await h.coordinator.init();
    await expect(h.coordinator.createTask({
      id: "bad", objective: "Bad dependency",
      steps: [{ id: "one", description: "One", dependsOn: ["missing"] }]
    })).rejects.toMatchObject({ code: "invalid_dependency" });
    await expect(h.coordinator.createTask({
      id: "bad2", objective: "Bad attempts",
      steps: [{ id: "one", description: "One", maxAttempts: 9 }]
    })).rejects.toBeInstanceOf(TaskLifecycleError);
  });
});
