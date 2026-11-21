import { describe, expect, it } from "vitest";
import { DirectorCapabilities } from "../../../packages/intelligence/director/DirectorCapabilities";
import { createDirectorTaskRuntime } from "../../../packages/intelligence/director/createDirectorTaskRuntime";
import { MemoryManager } from "../../../packages/intelligence/memory/MemoryManager";
import { ToolRegistry } from "../../../packages/intelligence/security/tools";
import { InMemoryToolArtifactStore, ToolDirector, type ToolArtifact, type ToolBuildSpec, type ToolTestSummary }
  from "../../../packages/intelligence/tooling/ToolDirector";
import type { LlamaCppCompletionParams } from "../llama-cpp/backend";
import { parseRepairFeedback, projectRepairFeedback, REPAIR_FEEDBACK_CONTRACT } from "./RepairFeedback";
import { StructuredRepairPlanner } from "./StructuredRepairPlanner";

const config = { api: "openai-chat" as const, modelAlias: "declared-feedback-fixture", temperature: 0,
  seed: 42, maxTokens: 1024, timeoutMs: 1000, repairAttempts: 0 };
const SOURCE_MARKER = "SOURCE-BUNDLE-MUST-STAY-OUT";

function spec(): ToolBuildSpec {
  return { id: "feedback-fixture", name: "Feedback fixture", purpose: "Declared contract test",
    specialists: ["ai-security"], change: "revise", requirements: ["Retain actual development feedback."] };
}

function summary(findings = Array.from({ length: 7 }, (_, index) => "Observed failure " + (index + 1))): ToolTestSummary {
  return { passed: false, testsRun: 8, testsPassed: 1, findings, completedAt: "2026-11-21T10:00:00.000Z" };
}

function artifact(testSummary = summary()): ToolArtifact {
  return { toolId: spec().id, version: 2, spec: spec(), digest: "a".repeat(64), previousDigest: "b".repeat(64),
    files: { "candidate.py": SOURCE_MARKER.repeat(400) }, createdAt: "2026-11-21T10:00:00.000Z",
    status: "quarantined", testSummary };
}

function project(value: ToolArtifact = artifact()) {
  return projectRepairFeedback({ command: { kind: "develop-tool", spec: spec() }, result: value });
}

describe("workshop feedback projection — declared artifacts and execution/provider doubles", () => {
  it("preserves identity and full counts while excluding source and bounding actual findings", () => {
    const original = artifact();
    expect(JSON.stringify(original).length).toBeGreaterThan(6000);
    const result = project(original);
    expect(result).toEqual({
      feedbackContract: REPAIR_FEEDBACK_CONTRACT, status: "quarantined", toolId: spec().id, version: 2,
      digest: "a".repeat(64), testSummary: { passed: false, testsRun: 8, testsPassed: 1,
        findings: ["Observed failure 1", "Observed failure 2", "Observed failure 3"],
        findingsTotal: 7, findingsIncluded: 3, findingsTextTruncated: false, findingsTruncated: true }
    });
    expect(JSON.stringify(result).length).toBeLessThan(2000);
    expect(JSON.stringify(result)).not.toContain(SOURCE_MARKER);
    expect(result).not.toHaveProperty("files");
    expect(result).not.toHaveProperty("spec");
    original.testSummary!.findings[0] = "Caller mutation after projection";
    expect(result.testSummary.findings[0]).toBe("Observed failure 1");
    expect(original.files["candidate.py"]).toBe(SOURCE_MARKER.repeat(400));
  });

  it("records text truncation independently of omitted finding count and preserves valid Unicode", () => {
    const result = project(artifact(summary(["x".repeat(199) + "😀tail"])));
    expect(result.testSummary).toMatchObject({ findings: ["x".repeat(199)], findingsTotal: 1,
      findingsIncluded: 1, findingsTextTruncated: true, findingsTruncated: true });
    const exact = project(artifact(summary(["x".repeat(200)])));
    expect(exact.testSummary).toMatchObject({ findings: ["x".repeat(200)], findingsTotal: 1,
      findingsIncluded: 1, findingsTextTruncated: false, findingsTruncated: false });
  });

  it("stays below the runner snapshot cap even when every retained character needs JSON escaping", () => {
    const result = project(artifact(summary(Array(7).fill("\u0000".repeat(1000)))));
    expect(result.testSummary).toMatchObject({ findingsTotal: 7, findingsIncluded: 3,
      findingsTextTruncated: true, findingsTruncated: true });
    expect(result.testSummary.findings.every(finding => finding.length === 200)).toBe(true);
    expect(JSON.stringify(result).length).toBeLessThan(6000);
  });

  it("keeps complete empty finding sets and zero-test infrastructure failures explicit", () => {
    const ready = artifact({ ...summary([]), passed: true, testsPassed: 8 });
    ready.status = "ready";
    expect(project(ready).testSummary).toMatchObject({ passed: true, findingsTotal: 0,
      findingsIncluded: 0, findingsTextTruncated: false, findingsTruncated: false });
    const failed = artifact({ ...summary(["Sandbox failed before comparisons"]), testsRun: 0, testsPassed: 0 });
    expect(project(failed)).toMatchObject({ status: "quarantined",
      testSummary: { passed: false, testsRun: 0, testsPassed: 0, findingsTotal: 1, findingsIncluded: 1 } });
  });

  it("rejects a different command, wrong artifact identity, or malformed full finding set", () => {
    expect(() => projectRepairFeedback({ command: { kind: "complete" } as never, result: artifact() }))
      .toThrow(/develop-tool/);
    expect(() => project({ ...artifact(), toolId: "other-tool" })).toThrow(/identity/);
    expect(() => project({ ...artifact(), spec: { ...spec(), id: "other-tool" } })).toThrow(/identity/);
    expect(() => project(artifact({ ...summary(), findings: ["actual", 1] as never }))).toThrow(/findings/);
    expect(() => project(artifact({ ...summary(), findings: undefined as never }))).toThrow(/findings/);
  });

  it.each([
    { findingsTotal: 2 }, { findingsTotal: 10_001 }, { findingsIncluded: 2 },
    { findingsIncluded: 4 }, { findingsTruncated: false }, { findingsTextTruncated: "yes" },
    { findings: ["x".repeat(201), "two", "three"] }, { findings: ["\ud800", "two", "three"] },
    { passed: true }, { testsPassed: 9 }, { testsRun: -1 }
  ])("rejects inconsistent compact metadata: %j", change => {
    const good = project();
    expect(() => parseRepairFeedback({ ...good, testSummary: { ...good.testSummary, ...change } }))
      .toThrow();
  });

  it("rejects missing projection metadata and retained source bundles instead of inventing empty feedback", () => {
    const good = project();
    const { findingsTotal: _total, ...missingCount } = good.testSummary;
    expect(() => parseRepairFeedback({ ...good, testSummary: missingCount })).toThrow(/inconsistent/);
    expect(() => parseRepairFeedback({ truncated: true, preview: "Large tool artifact", omittedCharacters: 10000 }))
      .toThrow(/complete bounded/);
    expect(() => parseRepairFeedback({ ...good, files: { "candidate.py": SOURCE_MARKER } })).toThrow(/complete bounded/);
    expect(() => parseRepairFeedback({ ...good, status: "ready" })).toThrow(/disagree/);
  });

  it("keeps the real runner-to-planner observation intact before the 6000-character snapshot boundary", async () => {
    const calls: LlamaCppCompletionParams[] = [];
    const store = new InMemoryToolArtifactStore();
    const director = new ToolDirector({ registry: new ToolRegistry(), store,
      builder: { async build() { return { files: { "candidate.py": SOURCE_MARKER.repeat(400) } }; } },
      sandbox: { async test() { return summary(); } } });
    await director.develop({ ...spec(), change: "create" });
    const planner = new StructuredRepairPlanner({ spec: spec(), config, feedbackContract: REPAIR_FEEDBACK_CONTRACT,
      backend: { async complete(params) {
        calls.push(params);
        return { content: calls.length === 1 ? '{"action":"revise","reason":"Observed failure."}'
          : '{"action":"blocked","reason":"End of declared feedback fixture."}' };
      }, async health() {} } });
    const runtime = createDirectorTaskRuntime({ capabilities: new DirectorCapabilities({ memory: new MemoryManager() }),
      toolDirector: director, provider: planner, maxSteps: 2, availableCommands: ["develop-tool"],
      projectResult: projectRepairFeedback });
    const result = await runtime.runTask({ taskId: "feedback-fixture-task" }, "Exercise the connected feedback contract.");
    expect(result.status).toBe("blocked");
    expect(calls).toHaveLength(2);
    const artifactAfterDispatch = (await store.getLatest(spec().id))!;
    expect(JSON.stringify(artifactAfterDispatch).length).toBeGreaterThan(6000);
    expect(artifactAfterDispatch.files["candidate.py"]).toBe(SOURCE_MARKER.repeat(400));
    const observation = JSON.parse(calls[1].prompt).outcomes[0];
    expect(observation).toMatchObject({ status: "quarantined", toolId: spec().id, version: 2,
      digest: artifactAfterDispatch.digest, trust: "untrusted-tool-output", feedbackContract: REPAIR_FEEDBACK_CONTRACT,
      testSummary: { passed: false, testsRun: 8, testsPassed: 1, findingsTotal: 7, findingsIncluded: 3,
        findingsTextTruncated: false, findingsTruncated: true } });
    expect(observation.testSummary.findings).toEqual(summary().findings.slice(0, 3));
    expect(calls[1].prompt).not.toContain(SOURCE_MARKER);
    expect(result.history[0].result).not.toHaveProperty("preview");
    expect(Object.isFrozen(result.history[0].result)).toBe(true);
  });
});
