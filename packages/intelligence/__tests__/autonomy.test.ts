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
    await h.create();
    const claims = await Promise.all([
      h.coordinator.claimNextStep("task-1"),
      h.coordinator.claimNextStep("task-1")
    ]);
    expect(claims.filter(Boolean)).toHaveLength(1); // only one step is initially dependency-ready
    const first = claims[0]!;
    await h.coordinator.completeStep({
      taskId: "task-1", stepId: first.stepId, attemptId: first.attemptId, result: "done"
    });
    const parallel = await Promise.all([
      h.coordinator.claimNextStep("task-1"),
      h.coordinator.claimNextStep("task-1")
    ]);
    expect(parallel.filter(Boolean)).toHaveLength(1);
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
