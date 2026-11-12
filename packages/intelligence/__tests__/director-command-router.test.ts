import { describe, expect, it } from "vitest";
import { DirectorCommandRouter, parseDirectorCommand } from "../director/DirectorCommandRouter";
import { DirectorCapabilities } from "../director/DirectorCapabilities";
import { MemoryManager } from "../memory/MemoryManager";
import { ToolDirector, InMemoryToolArtifactStore } from "../tooling/ToolDirector";
import { ToolRegistry } from "../security/tools";

describe("DirectorCommandRouter", () => {
  it("accepts only the finite structured command vocabulary", () => {
    expect(parseDirectorCommand({ kind: "research", query: "compare sandbox tools" })).toMatchObject({
      kind: "research", query: "compare sandbox tools"
    });
    expect(() => parseDirectorCommand({ kind: "shell", command: "rm -rf /" })).toThrow(/Unsupported Director command/);
    expect(() => parseDirectorCommand("research tools")).toThrow(/structured object/);
    expect(() => parseDirectorCommand({ kind: "research", query: "x", maxSources: 999 })).toThrow(/maxSources/);
    expect(() => parseDirectorCommand({ kind: "analyze-project", objective: "inspect", paths: ["../secrets"] })).toThrow(/relative project paths/);
  });

  it("routes research through the injected provider and does not interpret arbitrary model text", async () => {
    const capabilities = new DirectorCapabilities({
      memory: new MemoryManager(),
      research: { async search(request) {
        return [{ id: "r1", title: request.query, url: "https://example.com", excerpt: "result", retrievedAt: new Date(0).toISOString() }];
      } }
    });
    const router = new DirectorCommandRouter(capabilities, new ToolDirector({ registry: new ToolRegistry() }));
    const result = await router.dispatch({ taskId: "task-1" }, { kind: "research", query: "find test runners" });
    expect(result).toHaveLength(1);
    await expect(router.dispatch({ taskId: "task-1" }, { kind: "execute-arbitrary-code", code: "..." })).rejects.toThrow(/Unsupported Director command/);
  });

  it("carries task identity into approval-gated device actions", async () => {
    let receivedTask = "";
    const capabilities = new DirectorCapabilities({
      memory: new MemoryManager(),
      devicePermissionBroker: { async authorize(input) {
        receivedTask = input.taskId;
        return true;
      } },
      deviceBridge: { async perform(action) { return action.kind; } }
    });
    const router = new DirectorCommandRouter(capabilities, new ToolDirector({ registry: new ToolRegistry() }));
    await expect(router.dispatch({ taskId: "task-device" }, {
      kind: "use-device", approvalRef: "approved-once", action: { kind: "inspect-storage" }
    })).resolves.toBe("inspect-storage");
    expect(receivedTask).toBe("task-device");
  });

  it("does not activate a tool without the ToolDirector's independent approval verifier", async () => {
    const registry = new ToolRegistry();
    const store = new InMemoryToolArtifactStore();
    const tooling = new ToolDirector({ registry, store });
    const router = new DirectorCommandRouter(new DirectorCapabilities({ memory: new MemoryManager() }), tooling);
    await expect(router.dispatch({ taskId: "task-1" }, {
      kind: "activate-tool", toolId: "new-tool", version: 1, approvalRef: "approval"
    })).rejects.toThrow(/approval is not configured/);
  });
});
