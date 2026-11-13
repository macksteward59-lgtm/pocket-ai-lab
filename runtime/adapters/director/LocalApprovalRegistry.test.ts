import { describe, expect, it } from "vitest";
import { LocalApprovalRegistry } from "./LocalApprovalRegistry";

const digestA = "a".repeat(64);
const digestB = "b".repeat(64);

describe("LocalApprovalRegistry", () => {
  it("verifies an exact device action scope once and rejects replay", () => {
    const registry = new LocalApprovalRegistry();
    const approvalRef = registry.grant({
      kind: "device-action",
      taskId: "task-1",
      permission: "files.write",
      resourceId: "file-7",
      actionDigest: digestA
    });

    expect(registry.authorize({
      approvalRef, taskId: "task-1", permission: "files.write",
      resourceId: "file-7", actionDigest: digestA
    })).toBe(true);
    expect(registry.verify({
      approvalRef, taskId: "task-1", permission: "files.write",
      resourceId: "file-7", actionDigest: digestA
    })).toBe(false);
  });

  it("does not consume a grant when the task, resource, or digest differs", () => {
    const registry = new LocalApprovalRegistry();
    const approvalRef = registry.grant({
      kind: "device-action", taskId: "task-1",
      permission: "files.read", resourceId: "file-1", actionDigest: digestA
    });

    expect(registry.verify({
      approvalRef, taskId: "task-2", permission: "files.read",
      resourceId: "file-1", actionDigest: digestA
    })).toBe(false);
    expect(registry.verify({
      approvalRef, taskId: "task-1", permission: "files.read",
      resourceId: "file-2", actionDigest: digestA
    })).toBe(false);
    expect(registry.verify({
      approvalRef, taskId: "task-1", permission: "files.read",
      resourceId: "file-1", actionDigest: digestB
    })).toBe(false);
    expect(registry.verify({
      approvalRef, taskId: "task-1", permission: "files.read",
      resourceId: "file-1", actionDigest: digestA
    })).toBe(true);
  });

  it("binds tool approvals to operation, tool, version, and artifact digest", () => {
    const registry = new LocalApprovalRegistry();
    const approvalRef = registry.grant({
      kind: "tool-change", operation: "activate", taskId: "task-2",
      toolId: "research-helper", version: 3, digest: digestA
    });

    expect(registry.verify({
      operation: "retire", taskId: "task-2", toolId: "research-helper",
      version: 3, digest: digestA, approvalRef
    })).toBe(false);
    expect(registry.verify({
      operation: "activate", taskId: "task-2", toolId: "research-helper",
      version: 2, digest: digestA, approvalRef
    })).toBe(false);
    expect(registry.verify({
      operation: "activate", taskId: "task-2", toolId: "research-helper",
      version: 3, digest: digestA, approvalRef
    })).toBe(true);
  });

  it("binds memory approvals to the exact proposal and change index", () => {
    const registry = new LocalApprovalRegistry();
    const approvalRef = registry.grant({
      kind: "memory-change", taskId: "task-3",
      proposalId: "proposal-1", changeIndex: 0, changeDigest: digestA
    });

    expect(registry.verify({
      taskId: "task-3", proposalId: "proposal-1", changeIndex: 1,
      changeDigest: digestA, approvalRef
    })).toBe(false);
    expect(registry.verify({
      taskId: "task-3", proposalId: "proposal-1", changeIndex: 0,
      changeDigest: digestA, approvalRef
    })).toBe(true);
  });

  it("expires grants and removes them during pruning", () => {
    let now = 10_000;
    const registry = new LocalApprovalRegistry({ ttlMs: 1_000, now: () => now });
    const approvalRef = registry.grant({
      kind: "device-action", taskId: "task-4",
      permission: "apps.list", actionDigest: digestA
    });
    now += 1_000;

    expect(registry.verify({
      approvalRef, taskId: "task-4", permission: "apps.list", actionDigest: digestA
    })).toBe(false);
    expect(registry.pendingCount).toBe(0);
  });

  it("supports revocation, capacity limits, and concurrent one-time consumption", async () => {
    const registry = new LocalApprovalRegistry({ maxPending: 1 });
    const revoked = registry.grant({
      kind: "device-action", taskId: "task-5",
      permission: "apps.list", actionDigest: digestA
    });
    expect(registry.revoke(revoked)).toBe(true);

    const approvalRef = registry.grant({
      kind: "device-action", taskId: "task-5",
      permission: "apps.list", actionDigest: digestA
    });
    expect(() => registry.grant({
      kind: "device-action", taskId: "task-6",
      permission: "apps.list", actionDigest: digestB
    })).toThrow(/full/);

    const attempts = await Promise.all(Array.from({ length: 8 }, async () => registry.verify({
      approvalRef, taskId: "task-5", permission: "apps.list", actionDigest: digestA
    })));
    expect(attempts.filter(Boolean)).toHaveLength(1);
  });

  it("requires exact resource IDs only for resource-scoped device permissions", () => {
    const registry = new LocalApprovalRegistry();
    expect(() => registry.grant({
      kind: "device-action", taskId: "task-resource",
      permission: "files.read", actionDigest: digestA
    })).toThrow(/requires an exact resourceId/);
    expect(() => registry.grant({
      kind: "device-action", taskId: "task-resource",
      permission: "apps.list", resourceId: "unexpected-app", actionDigest: digestA
    })).toThrow(/does not accept a resourceId/);
    expect(() => registry.grant({
      kind: "device-action", taskId: "task-resource",
      permission: "files.delete", resourceId: "file-9", actionDigest: digestA
    })).not.toThrow();
    expect(() => registry.grant({
      kind: "device-action", taskId: "task-resource",
      permission: "apps.list", actionDigest: digestA
    })).not.toThrow();
  });

  it("rejects malformed scope data and invalid constructor limits", () => {
    expect(() => new LocalApprovalRegistry({ ttlMs: 500 })).toThrow(/TTL/);
    expect(() => new LocalApprovalRegistry({ maxPending: 0 })).toThrow(/capacity/);
    const registry = new LocalApprovalRegistry();
    expect(() => registry.grant({
      kind: "device-action", taskId: "task-7",
      permission: "files.delete", actionDigest: "not-a-digest"
    })).toThrow(/SHA-256/);
  });
});
