import { describe, expect, it } from "vitest";
import { DirectorCapabilities } from "../director/DirectorCapabilities";
import { createDirectorTaskRuntime } from "../director/createDirectorTaskRuntime";
import type { DirectorTaskProvider } from "../director/DirectorTaskRunner";
import { MemoryManager } from "../memory/MemoryManager";
import { ToolDirector } from "../tooling/ToolDirector";
import { ToolRegistry } from "../security/tools";

function makeDependencies(provider: DirectorTaskProvider) {
  const capabilities = new DirectorCapabilities({
    memory: new MemoryManager(),
    research: {
      async search(request) {
        return [{
          id: "source-1",
          title: request.query,
          url: "https://example.com/source",
          excerpt: "host-provided research result",
          retrievedAt: new Date(0).toISOString()
        }];
      }
    }
  });
  const toolDirector = new ToolDirector({ registry: new ToolRegistry() });
  return { capabilities, toolDirector, provider };
}

describe("createDirectorTaskRuntime", () => {
  it("composes the provider, bounded runner, router, and injected capabilities for a multi-step task", async () => {
    let calls = 0;
    const provider: DirectorTaskProvider = {
      async propose(input) {
        calls += 1;
        if (calls === 1) {
          expect(input.availableCommands).toContain("research");
          return { kind: "research", query: "host composition boundaries" };
        }
        expect(input.history).toHaveLength(1);
        expect(input.history[0]).toMatchObject({
          commandKind: "research",
          trust: "untrusted-tool-output",
          result: [{ id: "source-1", title: "host composition boundaries" }]
        });
        return { kind: "complete", summary: "Research completed." };
      }
    };
    const runtime = createDirectorTaskRuntime(makeDependencies(provider));
    const result = await runtime.runTask({ taskId: "composition-test" }, "Check composition boundaries");

    expect(result).toMatchObject({
      status: "completed",
      steps: 1,
      summary: "Research completed."
    });
    expect(calls).toBe(2);
  });

  it("keeps capability authorization authoritative instead of trusting model approval fields", async () => {
    let projections = 0;
    const provider: DirectorTaskProvider = {
      async propose() {
        return {
          kind: "use-device",
          approvalRef: "model-invented-approval",
          action: { kind: "list-apps" }
        };
      }
    };
    const runtime = createDirectorTaskRuntime({ ...makeDependencies(provider), projectResult() {
      projections += 1;
      return { approved: true };
    } });
    await expect(runtime.runTask({ taskId: "authorization-test" }, "List installed apps"))
      .rejects.toThrow(/Permission-controlled device bridge is not configured/);
    expect(projections).toBe(0);
  });

  it("rejects missing host dependencies", () => {
    expect(() => createDirectorTaskRuntime(null as never)).toThrow(/DirectorCapabilities/);
    const dependencies = makeDependencies({ async propose() { return { kind: "complete", summary: "done" }; } });
    expect(() => createDirectorTaskRuntime({ ...dependencies, provider: null as never }))
      .toThrow(/task provider/);
  });

  it("forwards the host command subset through composition and enforces it before dispatch", async () => {
    const runtime = createDirectorTaskRuntime({
      ...makeDependencies({
        async propose(input) {
          expect(input.availableCommands).toEqual(["develop-tool", "complete", "blocked", "needs-input"]);
          return { kind: "research", query: "not enabled for this runtime" };
        }
      }),
      availableCommands: ["develop-tool"]
    });
    await expect(runtime.runTask({ taskId: "composition-subset" }, "Develop a candidate"))
      .rejects.toThrow(/not available in this runtime: research/);
  });

  it("forwards an optional synchronous host projector through the composed runtime", async () => {
    let projections = 0;
    const runtime = createDirectorTaskRuntime({
      ...makeDependencies({
        async propose(input) {
          if (!input.history.length) return { kind: "research", query: "project the dispatched source" };
          expect(input.history[0]).toEqual({ step: 1, commandKind: "research", trust: "untrusted-tool-output",
            result: { sourceCount: 1, title: "project the dispatched source", accessToken: "[redacted]" } });
          expect(Object.isFrozen(input.history[0].result)).toBe(true);
          return { kind: "complete", summary: "Projected host result observed." };
        }
      }),
      availableCommands: ["research"],
      projectResult({ command, result }) {
        projections += 1;
        expect(command.kind).toBe("research");
        const sources = result as Array<{ title: string }>;
        return { sourceCount: sources.length, title: sources[0].title, accessToken: "do-not-forward" };
      }
    });
    const result = await runtime.runTask({ taskId: "composition-projection" }, "Read the compact source result");
    expect(result).toMatchObject({ status: "completed", steps: 1 });
    expect(projections).toBe(1);
  });

  it("rejects an invalid projector forwarded by composition", () => {
    const dependencies = makeDependencies({ async propose() { return { kind: "complete", summary: "done" }; } });
    expect(() => createDirectorTaskRuntime({ ...dependencies, projectResult: true as never }))
      .toThrow(/projector must be a function/);
  });
});
