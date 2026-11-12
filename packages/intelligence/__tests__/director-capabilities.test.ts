import { describe, expect, it } from "vitest";
import { MemoryManager } from "../memory/MemoryManager";
import { DirectorCapabilities } from "../director/DirectorCapabilities";

describe("DirectorCapabilities", () => {
  it("researches and analyzes through injected providers", async () => {
    const capabilities = new DirectorCapabilities({
      memory: new MemoryManager(),
      research: { async search() {
        return [{ id: "src-1", title: "Tool comparison", url: "https://example.com", excerpt: "Evidence", retrievedAt: new Date(0).toISOString() }];
      } },
      projectInspector: { async inspect() {
        return { summary: "Project inspected", findings: [], inspectedAt: new Date(0).toISOString() };
      } }
    });
    const sources = await capabilities.research({ query: "compare local code analysis tools" });
    expect(sources).toHaveLength(1);
    expect((await capabilities.analyzeProject({ objective: "Find missing project capabilities" })).summary).toBe("Project inspected");
  });

  it("fails closed when internet research or project inspection adapters are absent", async () => {
    const capabilities = new DirectorCapabilities({ memory: new MemoryManager() });
    await expect(capabilities.research({ query: "research tools" })).rejects.toThrow(/not configured/);
    await expect(capabilities.analyzeProject({ objective: "inspect" })).rejects.toThrow(/not configured/);
  });

  it("requires independent approval before applying proposed memory improvements", async () => {
    const memory = new MemoryManager();
    let approved = false;
    const capabilities = new DirectorCapabilities({
      memory,
      memoryAdvisor: { async propose() {
        return { id: "proposal-1", rationale: "Add a verified workflow note", changes: [{
          operation: "add", layer: "procedural", content: "Use reproducible tests before activation", sourceRefs: ["src-1"]
        }] };
      } },
      memoryApproval: { verify: () => approved }
    });
    const proposal = await capabilities.proposeMemoryImprovements({
      objective: "Improve tool development memory",
      research: [],
      project: { summary: "ok", findings: [], inspectedAt: new Date(0).toISOString() }
    });
    await expect(capabilities.applyMemoryImprovement({
      proposal, changeIndex: 0, taskId: "task-1", approvalRef: "no"
    })).rejects.toThrow(/approval was denied/);
    approved = true;
    const id = await capabilities.applyMemoryImprovement({
      proposal, changeIndex: 0, taskId: "task-1", approvalRef: "yes"
    });
    expect(typeof id).toBe("string");
    expect(memory.list()).toHaveLength(1);
    expect(memory.list()[0].provenance.verified).toBe(false);
  });

  it("requires scoped permission for each device action", async () => {
    const calls: string[] = [];
    let allowed = false;
    const capabilities = new DirectorCapabilities({
      memory: new MemoryManager(),
      devicePermissionBroker: { async authorize(input) {
        calls.push(input.permission + ":" + (input.resourceId ?? ""));
        return allowed;
      } },
      deviceBridge: { async perform(action) { return { completed: action.kind }; } }
    });
    await expect(capabilities.useDevice({
      taskId: "task-1", approvalRef: "approval-1", action: { kind: "open-app", appId: "com.example.app" }
    })).rejects.toThrow(/permission was denied/);
    allowed = true;
    await expect(capabilities.useDevice({
      taskId: "task-1", approvalRef: "approval-2", action: { kind: "open-app", appId: "com.example.app" }
    })).resolves.toEqual({ completed: "open-app" });
    expect(calls).toEqual(["apps.open:com.example.app", "apps.open:com.example.app"]);
  });

  it("requires explicit destructive confirmation before deleting files", async () => {
    const capabilities = new DirectorCapabilities({
      memory: new MemoryManager(),
      devicePermissionBroker: { verify: undefined, async authorize() { return true; } },
      deviceBridge: { async perform() { return "deleted"; } }
    });
    await expect(capabilities.useDevice({
      taskId: "task-1", approvalRef: "approval",
      action: { kind: "delete-file", fileId: "file-1", confirmDestructive: false as true }
    })).rejects.toThrow(/explicit destructive confirmation/);
  });
});
