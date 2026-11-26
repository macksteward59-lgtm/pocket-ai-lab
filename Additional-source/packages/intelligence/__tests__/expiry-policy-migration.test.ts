import { describe, expect, it } from "vitest";
import { InMemoryTaskLifecycleStore, TaskLifecycleCoordinator } from "../autonomy/TaskLifecycleCoordinator";

describe("expired-lease policy versioning", () => {
  it("persists the current version and preserves a new explicit retry opt-in after restart", async () => {
    const store = new InMemoryTaskLifecycleStore();
    const original = new TaskLifecycleCoordinator({ store, workerId: "worker-policy-writer" });
    await original.init();
    const created = await original.createTask({
      id: "versioned-expiry-opt-in",
      objective: "Preserve only a current, explicit safe-retry declaration",
      steps: [{
        id: "idempotent",
        description: "An operation with a separately documented idempotency contract",
        maxAttempts: 2,
        uncertainOnExpiredLease: false
      }]
    });

    expect(created.expiryPolicyVersion).toBe(1);
    expect(created.steps[0].uncertainOnExpiredLease).toBe(false);

    const restarted = new TaskLifecycleCoordinator({ store, workerId: "worker-policy-restart" });
    await restarted.init();
    expect(restarted.getTask("versioned-expiry-opt-in")).toMatchObject({
      expiryPolicyVersion: 1,
      steps: [{ uncertainOnExpiredLease: false }]
    });
  });

  it("rejects unknown task-level expiry policy versions", async () => {
    const store = new InMemoryTaskLifecycleStore();
    const writer = new TaskLifecycleCoordinator({ store });
    await writer.init();
    await writer.createTask({
      id: "unknown-expiry-version",
      objective: "Unknown policy versions must fail closed",
      steps: [{ id: "one", description: "One bounded step" }]
    });
    const snapshot = await store.load();
    snapshot[0].expiryPolicyVersion = 99;
    store.save(snapshot);

    await expect(new TaskLifecycleCoordinator({ store }).init())
      .rejects.toMatchObject({ code: "corrupt_store" });
  });
});
