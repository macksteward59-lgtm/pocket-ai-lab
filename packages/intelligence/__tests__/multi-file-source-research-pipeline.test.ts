import { describe, expect, it } from "vitest";
import { MultiFileSourceResearchPipeline } from "../research-science/MultiFileSourceResearchPipeline";

const files = [
  { path: "app/routes.py", source: `from services.worker import run
value = request.args.get('q')
run(value)
` },
  { path: "app/services/worker.py", source: `def run(value):
    eval(value)
` }
];

const validReport = {
  parser_status: "parsed",
  observations: [{
    kind: "dynamic-exec",
    source_file: "app/routes.py",
    source_line: 2,
    source_expression: "request.args.get('q')",
    source_excerpt: "value = request.args.get('q')",
    sink_file: "app/services/worker.py",
    sink_line: 2,
    sink_expression: "eval(value)",
    sink_excerpt: "eval(value)",
    imported_symbol: "run"
  }],
  resolved_imports: [{
    from_file: "app/routes.py",
    to_file: "app/services/worker.py",
    module: "services.worker",
    symbol: "run"
  }],
  unresolved_imports: [],
  files_analyzed: 2,
  nodes_visited: 30,
  authorized: false,
  executes: false,
  limitations: ["Direct imported function calls only."]
};

function pipelineFor(body: Record<string, unknown>, baseUrl = "http://127.0.0.1:8765") {
  return new MultiFileSourceResearchPipeline({
    baseUrl,
    fetchImpl: async (url, init) => {
      expect(String(url)).toBe("http://127.0.0.1:8765/api/v1/governance/analyze-project");
      const submitted = JSON.parse(String(init?.body)) as { files: unknown[] };
      expect(submitted.files).toHaveLength(2);
      return new Response(JSON.stringify(body), { status: 200 });
    }
  });
}

describe("MultiFileSourceResearchPipeline", () => {
  it("connects analyzer observations to per-file digest and excerpt binding", async () => {
    const result = await pipelineFor(validReport).analyze(files);
    expect(result.analysisStatus).toBe("parsed");
    expect(result.evidence.candidates).toHaveLength(1);
    expect(result.evidence.candidates[0]).toMatchObject({
      sourceFile: "app/routes.py",
      sinkFile: "app/services/worker.py",
      status: "unverified",
      classification: "cross-file-static-review-signal"
    });
    expect(result.evidence.candidates[0].sourceSha256).not.toBe(result.evidence.candidates[0].sinkSha256);
    expect(result.evidence.completeness).toBe("complete");
    expect(result.authorized).toBe(false);
    expect(result.sourceExecuted).toBe(false);
  });

  it("preserves upstream partial analysis even when every import resolved", async () => {
    const result = await pipelineFor({ ...validReport, parser_status: "partial" }).analyze(files);
    expect(result.analysisStatus).toBe("partial");
    expect(result.evidence.completeness).toBe("partial");
    expect(result.evidence.notes.join(" ")).toMatch(/upstream analyzer reported partial/);
  });

  it("rejects a sidecar that claims authorization or execution", async () => {
    await expect(pipelineFor({ ...validReport, authorized: true }).analyze(files))
      .rejects.toThrow(/unauthorized and non-executing/);
    await expect(pipelineFor({ ...validReport, executes: true }).analyze(files))
      .rejects.toThrow(/unauthorized and non-executing/);
  });

  it("rejects fabricated excerpts before evidence is admitted", async () => {
    const forged = {
      ...validReport,
      observations: [{ ...validReport.observations[0], sink_excerpt: "eval(attacker)" }]
    };
    await expect(pipelineFor(forged).analyze(files)).rejects.toThrow(/exact source provenance/);
  });

  it("rejects malformed import graph entries", async () => {
    const malformed = {
      ...validReport,
      resolved_imports: [{ from_file: "app/routes.py", to_file: "../outside.py", module: "services.worker" }]
    };
    await expect(pipelineFor(malformed).analyze(files)).rejects.toThrow(/relative path/);
  });

  it("rejects non-loopback sidecar destinations", async () => {
    await expect(new MultiFileSourceResearchPipeline({ baseUrl: "https://example.com" }).analyze(files))
      .rejects.toThrow(/loopback/);
  });
  it("accepts null symbol metadata on module-level import edges", async () => {
    const moduleImport = {
      ...validReport,
      resolved_imports: [{ ...validReport.resolved_imports[0], symbol: null }]
    };
    const result = await pipelineFor(moduleImport).analyze(files);
    expect(result.evidence.candidates).toHaveLength(1);
  });
});
