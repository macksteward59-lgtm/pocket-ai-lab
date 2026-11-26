import { describe, expect, it } from "vitest";
import { MemoryManager } from "../memory/MemoryManager";
import { DirectorCapabilities, type DeviceAction } from "../director/DirectorCapabilities";

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
    const sources = await capabilities.research({ query: "compare local code analysis tools", allowedDomains: ["EXAMPLE.com."] });
    expect(sources).toHaveLength(1);
    expect((await capabilities.analyzeProject({ objective: "Find missing project capabilities" })).summary).toBe("Project inspected");
  });

  it("keeps the caller's research allowlist private from provider mutation", async () => {
    const capabilities = new DirectorCapabilities({
      memory: new MemoryManager(),
      research: { async search(request) {
        request.allowedDomains?.push("evil.example");
        return [{ id: "bad", title: "Untrusted", url: "https://evil.example/path", excerpt: "outside original allowlist", retrievedAt: new Date(0).toISOString() }];
      } }
    });
    await expect(capabilities.research({
      query: "find a tool", allowedDomains: ["example.com"]
    })).rejects.toThrow(/outside the allowed domain list/);
  });

  it("normalizes trailing DNS dots on returned research hostnames", async () => {
    const capabilities = new DirectorCapabilities({
      memory: new MemoryManager(),
      research: { async search() {
        return [{ id: "src", title: "Allowed", url: "https://example.com./article", excerpt: "valid", retrievedAt: new Date(0).toISOString() }];
      } }
    });
    await expect(capabilities.research({
      query: "find a tool", allowedDomains: ["example.com"]
    })).resolves.toHaveLength(1);
  });

  it("rejects non-string research URLs instead of returning malformed source records", async () => {
    const capabilities = new DirectorCapabilities({
      memory: new MemoryManager(),
      research: { async search() {
        return [{ id: "src", title: "Malformed", url: ["https://example.com"], excerpt: "bad", retrievedAt: new Date(0).toISOString() }] as never;
      } }
    });
    await expect(capabilities.research({ query: "find a tool" })).rejects.toThrow(/invalid or unsafe source/);
  });

  it("enforces research domain allowlists and rejects project path traversal", async () => {
    const capabilities = new DirectorCapabilities({
      memory: new MemoryManager(),
      research: { async search() {
        return [{ id: "bad", title: "Untrusted", url: "https://evil.example.net/path", excerpt: "outside allowlist", retrievedAt: new Date(0).toISOString() }];
      } },
      projectInspector: { async inspect() {
        throw new Error("inspector must not receive traversal paths");
      } }
    });
    await expect(capabilities.research({
      query: "find a tool", allowedDomains: ["example.com"]
    })).rejects.toThrow(/outside the allowed domain list/);
    await expect(capabilities.analyzeProject({
      objective: "inspect", paths: ["..\\secrets"]
    })).rejects.toThrow(/relative paths/);
  });

  it("fails closed when internet research or project inspection adapters are absent", async () => {
    const capabilities = new DirectorCapabilities({ memory: new MemoryManager() });
    await expect(capabilities.research({ query: "research tools" })).rejects.toThrow(/not configured/);
    await expect(capabilities.analyzeProject({ objective: "inspect" })).rejects.toThrow(/not configured/);
  });

  it("requires independent approval before applying proposed memory improvements", async () => {
    const memory = new MemoryManager();
    let approvedDigest = "";
    const capabilities = new DirectorCapabilities({
      memory,
      memoryAdvisor: { async propose() {
        return { id: "proposal-1", rationale: "Add a verified workflow note", changes: [{
          operation: "add", layer: "procedural", content: "Use reproducible tests before activation", sourceRefs: ["src-1"]
        }] };
      } },
      memoryApproval: { verify(input) {
        if (input.approvalRef === "capture") {
          approvedDigest = input.changeDigest;
          return false;
        }
        return input.taskId === "task-1" && input.approvalRef === "yes" && input.changeDigest === approvedDigest;
      } }
    });
    const proposal = await capabilities.proposeMemoryImprovements({
      objective: "Improve tool development memory",
      research: [],
      project: { summary: "ok", findings: [], inspectedAt: new Date(0).toISOString() }
    });
    const originalContent = proposal.changes[0].content;
    const capture = capabilities.applyMemoryImprovement({
      proposal, changeIndex: 0, taskId: "task-1", approvalRef: "capture"
    });
    // Mutating caller-owned data after dispatch must not change the approved snapshot.
    proposal.changes[0].content = "Unapproved replacement content";
    await expect(capture).rejects.toThrow(/approval was denied/);
    await expect(capabilities.applyMemoryImprovement({
      proposal, changeIndex: 0, taskId: "task-1", approvalRef: "yes"
    })).rejects.toThrow(/approval was denied/);
    proposal.changes[0].content = originalContent;
    const id = await capabilities.applyMemoryImprovement({
      proposal, changeIndex: 0, taskId: "task-1", approvalRef: "yes"
    });
    expect(typeof id).toBe("string");
    expect(memory.list()).toHaveLength(1);
    expect(memory.list()[0].content).toBe(originalContent);
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

  it("binds device permission to the action-specific resource and strips unrelated fields", async () => {
    let approval: { permission: string; resourceId?: string; actionDigest: string } | undefined;
    let performed: unknown;
    const capabilities = new DirectorCapabilities({
      memory: new MemoryManager(),
      devicePermissionBroker: { async authorize(input) {
        approval = input;
        return true;
      } },
      deviceBridge: { async perform(action) {
        performed = action;
        return action.kind;
      } }
    });
    const supplied = { kind: "read-file", fileId: "file-actual", appId: "app-decoy" } as never;
    await expect(capabilities.useDevice({
      taskId: "task-1", approvalRef: "approval", action: supplied
    })).resolves.toBe("read-file");
    expect(approval?.permission).toBe("files.read");
    expect(approval?.resourceId).toBe("file-actual");
    expect(approval?.actionDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(performed).toEqual({ kind: "read-file", fileId: "file-actual" });
    await expect(capabilities.useDevice({
      taskId: "task-1", approvalRef: "approval", action: { kind: "read-file" } as never
    })).rejects.toThrow(/fileId/);
  });

  it("executes the immutable device action snapshot that was authorized", async () => {
    let resolveApproval!: (value: boolean) => void;
    let signalAuthorization!: () => void;
    const authorizationStarted = new Promise<void>(resolve => { signalAuthorization = resolve; });
    const approvalWait = new Promise<boolean>(resolve => { resolveApproval = resolve; });
    let performed: DeviceAction | undefined;
    const capabilities = new DirectorCapabilities({
      memory: new MemoryManager(),
      devicePermissionBroker: { async authorize() {
        signalAuthorization();
        return approvalWait;
      } },
      deviceBridge: { async perform(action) {
        performed = action;
        return action.kind;
      } }
    });
    const supplied: DeviceAction = { kind: "read-file", fileId: "file-before-approval" };
    const pending = capabilities.useDevice({ taskId: "task-1", approvalRef: "approval", action: supplied });
    await authorizationStarted;
    (supplied as { kind: "read-file"; fileId: string }).fileId = "file-after-approval";
    resolveApproval(true);
    await expect(pending).resolves.toBe("read-file");
    expect(performed).toEqual({ kind: "read-file", fileId: "file-before-approval" });
    expect(Object.isFrozen(performed)).toBe(true);
  });

  it("requires explicit destructive confirmation before deleting files", async () => {
    const capabilities = new DirectorCapabilities({
      memory: new MemoryManager(),
      devicePermissionBroker: { async authorize() { return true; } },
      deviceBridge: { async perform() { return "deleted"; } }
    });
    await expect(capabilities.useDevice({
      taskId: "task-1", approvalRef: "approval",
      action: { kind: "delete-file", fileId: "file-1", confirmDestructive: false } as never
    })).rejects.toThrow(/explicit destructive confirmation/);
  });
});
