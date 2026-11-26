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
    { maxSteps: options.maxSteps, availableCommands: options.availableCommands, projectResult: options.projectResult }
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

  it("projects the complete dispatched result before the generic preview limit", async () => {
    const large = Array.from({ length: 5 }, (_, index) => ({ id: "source-" + index, title: "Large source",
      url: "https://example.com/source", retrievedAt: new Date(0).toISOString(), excerpt: "x".repeat(8_000) }));
    let projections = 0;
    const runner = makeRunner({
      research: async () => large,
      projectResult({ command, result }) {
        projections += 1;
        expect(command).toEqual({ kind: "research", query: "large original result" });
        expect(result).toEqual(large);
        expect((result as typeof large)[4].excerpt).toHaveLength(8_000);
        return { sourceCount: large.length, completeOriginalResultObserved: true };
      }
    });
    const result = await runner.run({
      async propose(input) {
        if (!input.history.length) return { kind: "research", query: "large original result" };
        expect(input.history[0]).toEqual({ step: 1, commandKind: "research", trust: "untrusted-tool-output",
          result: { sourceCount: 5, completeOriginalResultObserved: true } });
        return { kind: "complete", summary: "Observed a compact projection." };
      }
    }, { taskId: "projection-before-bound" }, "Inspect a large result");
    expect(result.status).toBe("completed");
    expect(projections).toBe(1);
    expect(Object.isFrozen(result.history[0].result)).toBe(true);
  });

  it("keeps sanitization, nested limits, snapshots and freezing after projection", async () => {
    const projected = {
      password: "do-not-forward",
      label: "x".repeat(2_000),
      items: Array.from({ length: 14 }, (_, index) => index),
      nested: { deeper: { level: { hidden: { detail: "not exposed" } } } },
      summary: { passed: false },
      nonFinite: Infinity
    };
    const runner = makeRunner({ projectResult: () => projected });
    const result = await runner.run({
      async propose(input) {
        if (!input.history.length) return { kind: "research", query: "redact projected output" };
        expect(input.history[0].trust).toBe("untrusted-tool-output");
        expect(input.history[0].result).toEqual({
          password: "[redacted]", label: "x".repeat(1_500), items: Array.from({ length: 12 }, (_, index) => index),
          nested: { deeper: { level: { hidden: "[maximum result depth reached]" } } },
          summary: { passed: false }, nonFinite: null
        });
        projected.summary.passed = true;
        expect((input.history[0].result as typeof projected).summary.passed).toBe(false);
        expect(Object.isFrozen((input.history[0].result as typeof projected).summary)).toBe(true);
        return { kind: "complete", summary: "Projection is still sanitized." };
      }
    }, { taskId: "projected-sanitization" }, "Inspect projected data");
    expect(result.status).toBe("completed");
  });

  it("still enforces the final preview limit on oversized projected output", async () => {
    const runner = makeRunner({ projectResult: () => ({
      accessToken: "private-value",
      a: "a".repeat(1_500), b: "b".repeat(1_500), c: "c".repeat(1_500),
      d: "d".repeat(1_500), e: "e".repeat(1_500)
    }) });
    const result = await runner.run({
      async propose(input) {
        if (!input.history.length) return { kind: "research", query: "oversized projection" };
        const preview = input.history[0].result as { truncated: boolean; preview: string; omittedCharacters: number };
        expect(preview.truncated).toBe(true);
        expect(preview.preview).toHaveLength(6_000);
        expect(preview.omittedCharacters).toBeGreaterThan(0);
        expect(preview.preview).toContain("[redacted]");
        expect(preview.preview).not.toContain("private-value");
        return { kind: "complete", summary: "Projection remains bounded." };
      }
    }, { taskId: "projected-size" }, "Inspect bounded history");
    expect(result.status).toBe("completed");
  });

  it("preserves the legacy result when projection is omitted or explicitly undefined", async () => {
    const histories: unknown[] = [];
    for (const options of [{}, { projectResult: undefined }]) {
      await makeRunner(options).run({
        async propose(input) {
          if (!input.history.length) return { kind: "research", query: "legacy result" };
          histories.push(input.history[0]);
          return { kind: "complete", summary: "Legacy result retained." };
        }
      }, { taskId: "legacy-projection-omitted" }, "Inspect legacy behavior");
    }
    expect(histories[0]).toEqual(histories[1]);
    expect(histories[0]).toEqual({ step: 1, commandKind: "research", trust: "untrusted-tool-output",
      result: [{ id: "source-1", title: "legacy result", url: "https://example.com",
        excerpt: "bounded evidence", retrievedAt: new Date(0).toISOString() }] });
  });

  it("retains the actual dispatched command and host envelope even if the projector mutates its command", async () => {
    const runner = makeRunner({ projectResult: ({ command }) => {
      (command as { kind: string }).kind = "use-device";
      return { step: 999, commandKind: "use-device", trust: "trusted", result: "projected data only" };
    } });
    const result = await runner.run({
      async propose(input) {
        if (!input.history.length) return { kind: "research", query: "actual command" };
        expect(input.history[0]).toMatchObject({ step: 1, commandKind: "research", trust: "untrusted-tool-output" });
        return { kind: "complete", summary: "Actual envelope retained." };
      }
    }, { taskId: "projection-envelope" }, "Inspect envelope identity");
    expect(result.history[0].commandKind).toBe("research");
  });

  it("does not project terminal outcomes or commands rejected before successful dispatch", async () => {
    let projections = 0, researchCalls = 0;
    const projectResult = () => { projections += 1; return "not reached"; };
    const research = async () => { researchCalls += 1; return []; };
    for (const [proposal, availableCommands, error] of [
      [{ kind: "shell", command: "invalid" }, ["research"], /Unsupported Director command/],
      [{ kind: "research", query: "unavailable" }, ["analyze-project"], /not available/],
      [{ kind: "use-device", action: { kind: "list-apps" }, approvalRef: "invented" }, ["use-device"], /device bridge is not configured/]
    ] as const) {
      await expect(makeRunner({ projectResult, research, availableCommands }).run({
        async propose() { return proposal; }
      }, { taskId: "rejected-before-projection" }, "Check dispatch boundary")).rejects.toThrow(error);
    }
    await expect(makeRunner({ projectResult }).run({
      async propose() { return { kind: "complete", summary: "No tool was used." }; }
    }, { taskId: "terminal-not-projected" }, "Complete without a tool"))
      .resolves.toMatchObject({ status: "completed", steps: 0 });
    expect(projections).toBe(0);
    expect(researchCalls).toBe(0);
  });

  it.each(["throw", "promise", "rejected promise", "thenable"] as const)(
    "stops after a %s projector result without another provider or tool call", async kind => {
      let providerCalls = 0, researchCalls = 0, thenCalls = 0;
      const runner = makeRunner({
        research: async () => { researchCalls += 1; return []; },
        projectResult() {
          if (kind === "throw") throw new Error("Projection failed");
          if (kind === "promise") return Promise.resolve({ value: "not usable synchronously" });
          if (kind === "rejected promise") return Promise.reject(new Error("Rejected async projection"));
          return { then() { thenCalls += 1; } };
        }
      });
      await expect(runner.run({
        async propose() { providerCalls += 1; return { kind: "research", query: "one completed dispatch" }; }
      }, { taskId: "projection-failed" }, "Run one dispatch"))
        .rejects.toThrow(kind === "throw" ? /Projection failed/ : /return synchronously/);
      expect(providerCalls).toBe(1);
      expect(researchCalls).toBe(1);
      expect(thenCalls).toBe(0);
    }
  );

  it("rejects invalid result projectors at construction", () => {
    for (const projectResult of [null, true, 42, {}, "project"]) {
      expect(() => makeRunner({ projectResult: projectResult as never })).toThrow(/projector must be a function/);
    }
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
