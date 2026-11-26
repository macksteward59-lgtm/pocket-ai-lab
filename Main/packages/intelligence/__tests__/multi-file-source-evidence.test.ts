import { describe, expect, it } from "vitest";
import { bindMultiFileEvidence } from "../research-science/MultiFileSourceEvidence";

const files = [
  { path: "src/routes.py", source: "from services.worker import run\nvalue = request.args.get('x')" },
  { path: "src/services/worker.py", source: "def run(value):\n    eval(value)" }
];
const observation = {
  kind: "dynamic-exec",
  sourceFile: "src/routes.py",
  sourceLine: 2,
  sourceExcerpt: "value = request.args.get('x')",
  sinkFile: "src/services/worker.py",
  sinkLine: 2,
  sinkExcerpt: "eval(value)",
  remediation: "Avoid evaluating untrusted input."
};
const edges = [{ from: "src/routes.py", to: "src/services/worker.py", symbol: "run" }];

describe("bindMultiFileEvidence", () => {
  it("binds both endpoints to their own file digests and a resolved import path", () => {
    const result = bindMultiFileEvidence({ files, resolvedImports: edges, observations: [observation] });
    expect(result.files).toHaveLength(2);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      sourceFile: "src/routes.py",
      sinkFile: "src/services/worker.py",
      status: "unverified",
      classification: "cross-file-static-review-signal"
    });
    expect(result.candidates[0].sourceSha256).toBe(result.files[0].sourceSha256);
    expect(result.candidates[0].sinkSha256).toBe(result.files[1].sourceSha256);
    expect(result.candidates[0].evidenceRef).toContain(result.files[0].sourceSha256);
    expect(result.candidates[0].evidenceRef).toContain(result.files[1].sourceSha256);
    expect(result.authorized).toBe(false);
    expect(result.sourceExecuted).toBe(false);
    expect(result.vulnerabilityConfirmed).toBe(false);
  });

  it("marks unresolved imports partial rather than treating them as safe", () => {
    const result = bindMultiFileEvidence({
      files, resolvedImports: edges, observations: [],
      unresolvedImports: [{ from: "src/routes.py", module: "vendor.auth", reason: "external" }]
    });
    expect(result.completeness).toBe("partial");
    expect(result.notes.join(" ")).toMatch(/not evidence of absence/);
  });

  it("rejects an endpoint whose excerpt was fabricated", () => {
    expect(() => bindMultiFileEvidence({
      files, resolvedImports: edges,
      observations: [{ ...observation, sinkExcerpt: "eval(attacker)" }]
    })).toThrow(/exact source provenance/);
  });

  it("rejects cross-file claims without a resolved import path", () => {
    expect(() => bindMultiFileEvidence({
      files, resolvedImports: [],
      observations: [observation]
    })).toThrow(/no resolved import path/);
  });

  it("rejects path traversal and absolute paths", () => {
    expect(() => bindMultiFileEvidence({
      files: [{ path: "../outside.py", source: "x=1" }],
      resolvedImports: [], observations: []
    })).toThrow(/relative path/);
    expect(() => bindMultiFileEvidence({
      files: [{ path: "/etc/passwd", source: "x=1" }],
      resolvedImports: [], observations: []
    })).toThrow(/relative path/);
  });

  it("rejects edges that point outside the submitted manifest", () => {
    expect(() => bindMultiFileEvidence({
      files, resolvedImports: [{ from: "src/routes.py", to: "src/missing.py" }],
      observations: []
    })).toThrow(/outside the submitted manifest/);
  });

  it("deduplicates repeated observations and repeated import edges", () => {
    const result = bindMultiFileEvidence({
      files, resolvedImports: [...edges, ...edges],
      observations: [observation, observation]
    });
    expect(result.resolvedImports).toHaveLength(1);
    expect(result.candidates).toHaveLength(1);
  });

  it("enforces the file-count and aggregate-byte bounds", () => {
    expect(() => bindMultiFileEvidence({
      files: Array.from({ length: 201 }, (_, i) => ({ path: "src/" + i + ".py", source: "" })),
      resolvedImports: [], observations: []
    })).toThrow(/between 1 and 200/);
    expect(() => bindMultiFileEvidence({
      files: [{ path: "src/large.py", source: "x".repeat(1_000_001) }],
      resolvedImports: [], observations: []
    })).toThrow(/1 MB limit/);
  });
});
