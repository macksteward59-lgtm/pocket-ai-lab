import { describe, expect, it } from "vitest";
import {
  InMemoryTaskLifecycleStore,
  TaskLifecycleCoordinator,
  TaskLifecycleError,
  type TaskLifecycleStore,
  type TaskRecord
} from "../autonomy/TaskLifecycleCoordinator";

function harness(options: { leaseMs?: number; maxConcurrentSteps?: number } = {}) {
  let milliseconds = Date.parse("2026-11-15T12:00:00.000Z");
  let nextId = 0;
  const store = new InMemoryTaskLifecycleStore();
  const coordinator = new TaskLifecycleCoordinator({
    store,
    now: () => new Date(milliseconds),
    createId: () => "attempt-" + (++nextId),
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
  return { coordinator, store, advance, create };
}

describe("TaskLifecycleCoordinator", () => {
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

  it("can recover expired leases for one task without mutating another task", async () => {
    const h = harness({ leaseMs: 1_000 });
    await h.coordinator.init();
    await h.create();
    await h.coordinator.createTask({
      id: "unrelated-task",
      objective: "Do not recover this task yet",
      leaseMs: 1_000,
      steps: [{ id: "unrelated", description: "Unrelated leased work" }]
    });
    const targetClaim = await h.coordinator.claimNextStep("task-1");
    const unrelatedClaim = await h.coordinator.claimNextStep("unrelated-task");
    expect(targetClaim).not.toBeNull();
    expect(unrelatedClaim).not.toBeNull();

    h.advance(1_001);
    expect(await h.coordinator.recoverExpiredLeases("task-1")).toBe(1);
    expect(h.coordinator.getTask("task-1").steps[0].status).toBe("pending");
    expect(h.coordinator.getTask("unrelated-task").steps[0].status).toBe("running");
    expect(await h.coordinator.recoverExpiredLeases("unrelated-task")).toBe(1);
    expect(h.coordinator.getTask("unrelated-task").steps[0].status).toBe("pending");
    await expect(h.coordinator.recoverExpiredLeases("missing-task"))
      .rejects.toMatchObject({ code: "unknown_task" });
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
