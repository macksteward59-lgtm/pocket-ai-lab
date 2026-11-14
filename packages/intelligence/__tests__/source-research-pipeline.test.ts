import { describe, expect, it } from "vitest";
import { StaticAnalysisOrchestratorBridge } from "../orchestrator/StaticAnalysisOrchestratorBridge";
import { SourceResearchPipeline } from "../research-science/SourceResearchPipeline";

const source = [
  "from flask import request",
  "def run(user_input):",
  "    value = eval(user_input)",
  "    return value"
].join("\n");

function pipelineFor(body: Record<string, unknown>) {
  const bridge = new StaticAnalysisOrchestratorBridge({
    baseUrl: "http://127.0.0.1:8765",
    fetchImpl: async (_url, init) => {
      const submitted = JSON.parse(String(init?.body)) as { filename: string; source: string };
      expect(submitted.filename).toBe("src/handlers.py");
      expect(submitted.source).toBe(source);
      return new Response(JSON.stringify(body), { status: 200 });
    }
  });
  return new SourceResearchPipeline(bridge);
}

const validResponse = {
  filename: "src/handlers.py",
  observations: [{
    kind: "dynamic-exec",
    line: 3,
    excerpt: "value = eval(user_input)",
    remediation: "Avoid evaluating untrusted input."
  }],
  context: { imports: ["flask"], functions: ["run"], classes: [] },
  truncated: false,
  authorized: false,
  executes: false
};

describe("SourceResearchPipeline", () => {
  it("runs sidecar analysis through provenance binding without executing source", async () => {
    const result = await pipelineFor(validResponse).analyze({
      filename: "src/handlers.py",
      source
    });
    expect(result.evidence.candidates).toHaveLength(1);
    expect(result.evidence.candidates[0]).toMatchObject({
      filename: "src/handlers.py",
      line: 3,
      status: "unverified",
      classification: "static-review-signal"
    });
    expect(result.evidence.completeness).toBe("complete");
    expect(result.context.functions).toEqual(["run"]);
    expect(result.authorized).toBe(false);
    expect(result.sourceExecuted).toBe(false);
    expect(result.evidence.vulnerabilityConfirmed).toBe(false);
  });

  it("preserves partial-analysis status through the full pipeline", async () => {
    const result = await pipelineFor({
      ...validResponse,
      observations: [],
      truncated: true
    }).analyze({ filename: "src/handlers.py", source });
    expect(result.evidence.completeness).toBe("partial");
    expect(result.evidence.candidates).toHaveLength(0);
  });

  it("rejects a sidecar filename that does not match the submitted source", async () => {
    await expect(pipelineFor({
      ...validResponse,
      filename: "src/other.py"
    }).analyze({ filename: "src/handlers.py", source })).rejects.toThrow(/does not match/);
  });

  it("rejects a fabricated source excerpt", async () => {
    await expect(pipelineFor({
      ...validResponse,
      observations: [{
        ...validResponse.observations[0],
        excerpt: "value = eval(attacker_controlled)"
      }]
    }).analyze({ filename: "src/handlers.py", source })).rejects.toThrow(/exactly match/);
  });
});
