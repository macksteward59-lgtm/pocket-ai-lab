import { describe, expect, it } from "vitest";
import { DirectorCapabilities } from "../director/DirectorCapabilities";
import { DirectorCommandRouter } from "../director/DirectorCommandRouter";
import { DirectorTaskRunner, type DirectorTaskProvider, type DirectorTaskRunnerOptions } from "../director/DirectorTaskRunner";
import { MemoryManager } from "../memory/MemoryManager";
import { ToolDirector } from "../tooling/ToolDirector";
import { ToolRegistry } from "../security/tools";

function makeRunner(options: DirectorTaskRunnerOptions & { research?: (query: string) => Promise<unknown> } = {}) {
  const capabilities = new DirectorCapabilities({
    memory: new MemoryManager(),
    research: options.research ? {
      async search(request) {
        return await options.research!(request.query) as never;
      }
    } : {
      async search(request) {
        return [{
          id: "source-1",
          title: request.query,
          url: "https://example.com",
          excerpt: "bounded evidence",
          retrievedAt: new Date(0).toISOString()
        }];
      }
    }
  });
  return new DirectorTaskRunner(
    new DirectorCommandRouter(capabilities, new ToolDirector({ registry: new ToolRegistry() })),
    { maxSteps: options.maxSteps, availableCommands: options.availableCommands }
  );
}

describe("DirectorTaskRunner", () => {
  it("executes multiple allowlisted commands and feeds bounded results into the next model turn", async () => {
    const runner = makeRunner();
    const observed: number[] = [];
    let calls = 0;
    const provider: DirectorTaskProvider = {
      async propose(input) {
        calls += 1;
        observed.push(input.history.length);
        if (calls === 1) return { kind: "research", query: "inspect sandbox isolation" };
        expect(input.history[0]).toMatchObject({
          step: 1,
          commandKind: "research",
          trust: "untrusted-tool-output",
          result: [{ id: "source-1", title: "inspect sandbox isolation" }]
        });
        return { kind: "complete", summary: "Research completed with one source." };
      }
    };

    const result = await runner.run(provider, { taskId: "task-loop-1" }, "Research sandbox options");
    expect(result).toMatchObject({ status: "completed", steps: 1, summary: "Research completed with one source." });
    expect(observed).toEqual([0, 1]);
    expect(Object.isFrozen(result.history)).toBe(true);
  });

  it("returns an explicit needs-input outcome without dispatching another command", async () => {
    const runner = makeRunner();
    const result = await runner.run({
      async propose() { return { kind: "needs-input", question: "Which target platform should be tested?" }; }
    }, { taskId: "task-input" }, "Prepare a platform test");
    expect(result).toMatchObject({ status: "needs-input", steps: 0, question: "Which target platform should be tested?" });
  });

  it("stops at the configured maximum and never asks for an unbounded next step", async () => {
    const runner = makeRunner({ maxSteps: 2 });
    let calls = 0;
    const result = await runner.run({
      async propose() {
        calls += 1;
        return { kind: "research", query: "repeat bounded request" };
      }
    }, { taskId: "task-limit" }, "Run bounded research");
    expect(result).toMatchObject({ status: "blocked", steps: 2 });
    expect(calls).toBe(2);
    expect(result.status === "blocked" && result.reason).toMatch(/Maximum Director task steps/);
  });

  it("rejects malformed controls and unsupported model commands", async () => {
    const runner = makeRunner();
    await expect(runner.run({
      async propose() { return { kind: "complete", summary: "done", extra: "not allowed" }; }
    }, { taskId: "task-control" }, "Complete task")).rejects.toThrow(/only kind and summary/);
    await expect(runner.run({
      async propose() { return { kind: "shell", command: "unsafe" }; }
    }, { taskId: "task-command" }, "Do work")).rejects.toThrow(/Unsupported Director command/);
  });

  it("redacts sensitive result fields and truncates oversized output before model reuse", async () => {
    const runner = makeRunner({
      research: async query => Array.from({ length: 5 }, (_, index) => ({
        id: query + "-" + index,
        title: "x".repeat(1_500),
        url: "https://example.com/source",
        retrievedAt: new Date(0).toISOString(),
        accessToken: "do-not-forward",
        excerpt: "y".repeat(8_000)
      }))
    });
    let nextHistory: unknown;
    const result = await runner.run({
      async propose(input) {
        if (input.history.length === 0) return { kind: "research", query: "sensitive source" };
        nextHistory = input.history[0].result;
        return { kind: "complete", summary: "done" };
      }
    }, { taskId: "task-redaction" }, "Inspect a source");
    expect(result.status).toBe("completed");
    const serialized = JSON.stringify(nextHistory);
    expect(serialized).not.toContain("do-not-forward");
    expect(serialized).toContain("[redacted]");
    expect(serialized).toContain("truncated");
  });

  it("rejects invalid step limits", () => {
    expect(() => makeRunner({ maxSteps: 21 })).toThrow(/between 1 and 20/);
    expect(() => makeRunner({ maxSteps: 0 })).toThrow(/between 1 and 20/);
  });

  it("advertises a snapshotted host command subset and retains the fixed task controls", async () => {
    const commands: Array<"research" | "use-device"> = ["research"];
    const runner = makeRunner({ availableCommands: commands });
    commands.push("use-device");
    const result = await runner.run({
      async propose(input) {
        expect(input.availableCommands).toEqual(["research", "complete", "blocked", "needs-input"]);
        expect(Object.isFrozen(input.availableCommands)).toBe(true);
        if (!input.history.length) return { kind: "research", query: "configured capability" };
        expect(input.history[0].result).toMatchObject([{ title: "configured capability" }]);
        return { kind: "complete", summary: "Used the configured research adapter." };
      }
    }, { taskId: "subset" }, "Research the task");
    expect(result).toMatchObject({ status: "completed", steps: 1 });
  });

  it("rejects an unavailable command before invoking an otherwise configured capability", async () => {
    let researchCalls = 0;
    const runner = makeRunner({
      availableCommands: ["analyze-project"],
      research: async () => { researchCalls += 1; return []; }
    });
    await expect(runner.run({
      async propose() { return { kind: "research", query: "provider ignored the advertised subset" }; }
    }, { taskId: "enforced-subset" }, "Inspect the project"))
      .rejects.toThrow(/not available in this runtime: research/);
    expect(researchCalls).toBe(0);
  });

  it("supports a control-only host without claiming that tools are configured", async () => {
    const result = await makeRunner({ availableCommands: [] }).run({
      async propose(input) {
        expect(input.availableCommands).toEqual(["complete", "blocked", "needs-input"]);
        return { kind: "blocked", reason: "No tools are configured for this task." };
      }
    }, { taskId: "control-only" }, "Review capability availability");
    expect(result).toMatchObject({ status: "blocked", steps: 0 });
  });

  it("rejects invalid, duplicate, and control names in the host command subset", () => {
    for (const availableCommands of [["run-shell"], ["research", "research"], ["complete"], null, "research"]) {
      expect(() => makeRunner({ availableCommands: availableCommands as never }))
        .toThrow(/unique subset of canonical Director commands/);
    }
  });
});
