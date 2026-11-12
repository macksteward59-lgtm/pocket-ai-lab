import { describe, expect, it } from "vitest";
import { ToolRegistry } from "../security/tools";
import {
  InMemoryToolArtifactStore,
  ToolDirector,
  type ToolBuildSpec,
  type ToolBuilder,
  type ToolSandbox
} from "../tooling/ToolDirector";

const spec: ToolBuildSpec = {
  id: "artifact-inspector",
  name: "Artifact Inspector",
  purpose: "Inspect local project artifacts and produce structured metadata.",
  specialists: ["reverse-engineering"],
  change: "create",
  requirements: ["Read only files supplied by the host", "Return a validated JSON summary"]
};

const builder: ToolBuilder = {
  async build() {
    return { files: { "src/index.ts": "export function inspect(input: string) { return input.length; }" } };
  }
};
const passingSandbox: ToolSandbox = {
  async test() {
    return { passed: true, testsRun: 3, testsPassed: 3, findings: [], completedAt: new Date(0).toISOString() };
  }
};

describe("ToolDirector", () => {
  it("builds and tests a draft without registering or executing it", async () => {
    const registry = new ToolRegistry();
    const director = new ToolDirector({ registry, builder, sandbox: passingSandbox });
    const artifact = await director.develop(spec);
    expect(artifact.status).toBe("ready");
    expect(artifact.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(artifact.version).toBe(1);
    expect(registry.has(spec.id)).toBe(false);
    expect(registry.isAvailable(spec.id)).toBe(false);
    expect("execute" in director).toBe(false);
  });

  it("quarantines a candidate when tests fail", async () => {
    const registry = new ToolRegistry();
    const sandbox: ToolSandbox = {
      async test() {
        return { passed: false, testsRun: 2, testsPassed: 1, findings: ["Regression detected"], completedAt: new Date(0).toISOString() };
      }
    };
    const director = new ToolDirector({ registry, builder, sandbox, approvalVerifier: { verify: () => true } });
    const artifact = await director.develop(spec);
    expect(artifact.status).toBe("quarantined");
    expect(artifact.testSummary?.findings).toContain("Regression detected");
    await expect(director.activate({
      taskId: "task-1", toolId: spec.id, version: 1, approvalRef: "approval-1"
    })).rejects.toThrow(/fully tested ready artifact/);
  });

  it("requires digest-bound independent approval before activation", async () => {
    const registry = new ToolRegistry();
    const store = new InMemoryToolArtifactStore();
    const approvals: string[] = [];
    const director = new ToolDirector({
      registry, store, builder, sandbox: passingSandbox,
      approvalVerifier: { async verify(input) { approvals.push(input.digest); return input.approvalRef === "human-ok"; } }
    });
    const artifact = await director.develop(spec);
    await expect(director.activate({
      taskId: "task-1", toolId: spec.id, version: 1, approvalRef: "no"
    })).rejects.toThrow(/approval was denied/);
    const descriptor = await director.activate({
      taskId: "task-1", toolId: spec.id, version: 1, approvalRef: "human-ok"
    });
    expect(approvals).toEqual([artifact.digest, artifact.digest]);
    expect(descriptor.mode).toBe("active");
    expect(descriptor.specialists).toEqual(["reverse-engineering"]);
    expect(registry.has(spec.id)).toBe(true);
    expect(registry.mayRequest("reverse-engineering", spec.id)).toBe(true);
    expect(registry.mayRequest("network-protocols", spec.id)).toBe(false);
    // Activation registers metadata only; the host must separately detect/install the adapter.
    expect(registry.isAvailable(spec.id)).toBe(false);
  });

  it("supports revision of Director-managed tools while preserving version history", async () => {
    const registry = new ToolRegistry();
    const director = new ToolDirector({
      registry, builder, sandbox: passingSandbox,
      approvalVerifier: { verify: () => true }
    });
    const first = await director.develop(spec);
    await director.activate({ taskId: "task-1", toolId: spec.id, version: 1, approvalRef: "ok" });
    const second = await director.develop({ ...spec, change: "extend", requirements: [...spec.requirements, "Add checksum metadata"] });
    expect(second.version).toBe(2);
    expect(second.previousDigest).toBe(first.digest);
    expect((await director.listArtifacts()).map(item => item.version)).toEqual([1, 2]);
    const updated = await director.activate({ taskId: "task-2", toolId: spec.id, version: 2, approvalRef: "ok" });
    expect(updated.application).toBe(spec.purpose);
  });


  it("quarantines malformed sandbox summaries", async () => {
    const malformedSandbox = {
      async test() {
        return { passed: true, testsRun: 0, testsPassed: 0, findings: [], completedAt: "not-a-date" } as never;
      }
    };
    const director = new ToolDirector({ registry: new ToolRegistry(), builder, sandbox: malformedSandbox });
    const artifact = await director.develop(spec);
    expect(artifact.status).toBe("quarantined");
    expect(artifact.testSummary?.findings).toContain("Sandbox returned a malformed test summary");
  });

  it("refuses to revise built-in catalog tools", async () => {
    const director = new ToolDirector({ registry: new ToolRegistry(), builder, sandbox: passingSandbox });
    await expect(director.develop({
      ...spec, id: "ghidra", change: "revise"
    })).rejects.toThrow(/Built-in tools cannot be revised/);
  });

  it("rejects unsafe generated file paths before sandboxing", async () => {
    const sandbox: ToolSandbox = { async test() { throw new Error("must not run"); } };
    const unsafeBuilder: ToolBuilder = { async build() { return { files: { "../escape.ts": "bad" } }; } };
    const director = new ToolDirector({ registry: new ToolRegistry(), builder: unsafeBuilder, sandbox });
    await expect(director.develop(spec)).rejects.toThrow(/Unsafe tool bundle path/);
  });


  it("serializes competing creates for the same tool id", async () => {
    const director = new ToolDirector({ registry: new ToolRegistry(), builder, sandbox: passingSandbox });
    const results = await Promise.allSettled([director.develop(spec), director.develop(spec)]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter(result => result.status === "rejected")).toHaveLength(1);
  });

  it("requires approval to retire a managed tool and preserves its history", async () => {
    const registry = new ToolRegistry();
    const director = new ToolDirector({
      registry, builder, sandbox: passingSandbox,
      approvalVerifier: { verify: input => input.approvalRef === "retire-ok" }
    });
    await director.develop(spec);
    await director.activate({ taskId: "task-1", toolId: spec.id, version: 1, approvalRef: "activate-ok" });
    await expect(director.retire({ taskId: "task-2", toolId: spec.id, approvalRef: "no" }))
      .rejects.toThrow(/retirement approval was denied/);
    await director.retire({ taskId: "task-2", toolId: spec.id, approvalRef: "retire-ok" });
    expect(registry.has(spec.id)).toBe(false);
    expect((await director.listArtifacts()).map(item => item.status)).toEqual(["active", "retired"]);
  });

  it("fails closed when builder or isolated sandbox adapters are missing", async () => {
    const director = new ToolDirector({ registry: new ToolRegistry() });
    await expect(director.develop(spec)).rejects.toThrow(/builder is not configured/);
  });
});
