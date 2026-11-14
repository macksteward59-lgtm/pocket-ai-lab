import { describe, expect, it } from "vitest";
import { StaticAnalysisOrchestratorBridge } from "../orchestrator/StaticAnalysisOrchestratorBridge";
import { SourceResearchPipeline } from "../research-science/SourceResearchPipeline";

const source = [
  "from flask import request",
  "def run():",
  "    value = request.args.get('code')",
  "    eval(value)",
  "    return value"
].join("\n");

function pipelineFor(body: Record<string, unknown>, expectedSource = source, expectedFilename = "src/handlers.py") {
  const bridge = new StaticAnalysisOrchestratorBridge({
    baseUrl: "http://127.0.0.1:8765",
    fetchImpl: async (_url, init) => {
      const submitted = JSON.parse(String(init?.body)) as { filename: string; source: string };
      expect(submitted.filename).toBe(expectedFilename);
      expect(submitted.source).toBe(expectedSource);
      return new Response(JSON.stringify(body), { status: 200 });
    }
  });
  return new SourceResearchPipeline(bridge);
}

const validResponse = {
  filename: "src/handlers.py",
  observations: [{
    kind: "dynamic-exec",
    line: 4,
    excerpt: "eval(value)",
    remediation: "Avoid evaluating untrusted input."
  }],
  context: { imports: ["flask"], functions: ["run"], classes: [] },
  authorization_surface: { parser_status: "parsed", routes: [], limitations: ["No routes in fixture."], authorized: false, executes: false },
  data_flows: {
    language: "python",
    parser_status: "parsed",
    signals: [{
      kind: "dynamic-exec",
      source_line: 3,
      sink_line: 4,
      source_expression: "request.args.get('code')",
      sink_expression: "eval(value)",
      sink_name: "eval",
      variables: ["value"],
      source_excerpt: "value = request.args.get('code')",
      sink_excerpt: "eval(value)"
    }],
    nodes_visited: 42,
    truncated: false,
    limitations: ["Intraprocedural, straight-line name propagation only."],
    authorized: false,
    executes: false
  },
  truncated: false,
  authorized: false,
  executes: false
};

describe("SourceResearchPipeline", () => {
  it("binds AST source-to-sink paths to the exact submitted source and digest", async () => {
    const result = await pipelineFor(validResponse).analyze({
      filename: "src/handlers.py",
      source
    });
    expect(result.evidence.candidates).toHaveLength(1);
    expect(result.evidence.candidates[0]).toMatchObject({
      filename: "src/handlers.py",
      line: 4,
      status: "unverified",
      classification: "static-review-signal"
    });
    expect(result.evidence.completeness).toBe("complete");
    expect(result.context.functions).toEqual(["run"]);
    expect(result.dataFlows.parserStatus).toBe("parsed");
    expect(result.dataFlows.signals).toHaveLength(1);
    expect(result.dataFlows.signals[0]).toMatchObject({
      filename: "src/handlers.py",
      sourceLine: 3,
      sinkLine: 4,
      status: "unverified",
      sourceSha256: result.evidence.sourceSha256
    });
    expect(result.dataFlows.signals[0].evidenceRef).toContain(result.evidence.sourceSha256);
    expect(result.authorized).toBe(false);
    expect(result.sourceExecuted).toBe(false);
    expect(result.evidence.vulnerabilityConfirmed).toBe(false);
  });


  it("preserves interprocedural scope through source evidence binding", async () => {
    const response = {
      ...validResponse,
      data_flows: {
        ...validResponse.data_flows,
        signals: [{
          ...validResponse.data_flows.signals[0],
          analysis_scope: "interprocedural"
        }]
      }
    };
    const result = await pipelineFor(response).analyze({ filename: "src/handlers.py", source });
    expect(result.dataFlows.signals[0].analysisScope).toBe("interprocedural");
    expect(result.dataFlows.signals[0].status).toBe("unverified");
  });
\n  it("preserves partial-analysis status through the full pipeline", async () => {
    const result = await pipelineFor({
      ...validResponse,
      observations: [],
      data_flows: {
        ...validResponse.data_flows,
        parser_status: "truncated",
        signals: [],
        truncated: true
      },
      truncated: true
    }).analyze({ filename: "src/handlers.py", source });
    expect(result.evidence.completeness).toBe("partial");
    expect(result.dataFlows.parserStatus).toBe("truncated");
    expect(result.dataFlows.signals).toHaveLength(0);
  });


  it("binds route authorization signals to the exact source digest and excerpt", async () => {
    const routeSource = 'from fastapi import Depends\n@app.get("/private")\ndef private(user=Depends(require_auth)): return user';
    const response = {
      ...validResponse,
      filename: "src/routes.py",
      observations: [],
      data_flows: { ...validResponse.data_flows, signals: [] },
      authorization_surface: {
        parser_status: "parsed",
        routes: [{
          path: "/private", methods: ["GET"], function: "private", line: 2,
          guard_status: "local-guard-observed", guard_signals: ["require_auth"],
          excerpt: '@app.get("/private")'
        }],
        limitations: ["Only local signals are inspected."],
        authorized: false, executes: false
      }
    };
    const result = await pipelineFor(response, routeSource, "src/routes.py")
      .analyze({ filename: "src/routes.py", source: routeSource });
    expect(result.authorizationSurface.routes).toHaveLength(1);
    expect(result.authorizationSurface.routes[0]).toMatchObject({
      path: "/private", guardStatus: "local-guard-observed",
      status: "unverified", sourceSha256: result.evidence.sourceSha256
    });
    expect(result.authorizationSurface.routes[0].evidenceRef).toContain(result.evidence.sourceSha256);
  });

  it("rejects fabricated authorization route excerpts", async () => {
    const routeSource = 'from fastapi import Depends\n@app.get("/private")\ndef private(user=Depends(require_auth)): return user';
    const response = {
      ...validResponse,
      filename: "src/routes.py",
      observations: [],
      data_flows: { ...validResponse.data_flows, signals: [] },
      authorization_surface: {
        parser_status: "parsed",
        routes: [{
          path: "/private", methods: ["GET"], function: "private", line: 2,
          guard_status: "local-guard-observed", guard_signals: ["require_auth"],
          excerpt: '@app.get("/forged")'
        }],
        limitations: [], authorized: false, executes: false
      }
    };
    await expect(pipelineFor(response, routeSource, "src/routes.py")
      .analyze({ filename: "src/routes.py", source: routeSource }))
      .rejects.toThrow(/Authorization route provenance/);
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
        excerpt: "eval(attacker_controlled)"
      }]
    }).analyze({ filename: "src/handlers.py", source })).rejects.toThrow(/exactly match/);
  });

  it("rejects AST flow provenance that does not match either claimed source line", async () => {
    await expect(pipelineFor({
      ...validResponse,
      data_flows: {
        ...validResponse.data_flows,
        signals: [{
          ...validResponse.data_flows.signals[0],
          source_excerpt: "request.args.get('forged')"
        }]
      }
    }).analyze({ filename: "src/handlers.py", source })).rejects.toThrow(/provenance/);
  });
});
