import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ingestStaticAnalysis } from "../SourceEvidenceAdapter";

const source = [
  "from flask import request",
  "def run(user_input):",
  "    value = eval(user_input)",
  "    return value"
].join("\n");

const base = {
  filename: "src/handlers.py",
  source,
  observations: [{
    kind: "dynamic-exec",
    line: 3,
    excerpt: "value = eval(user_input)",
    remediation: "Avoid evaluating untrusted input."
  }],
  authorized: false as const,
  executes: false as const
};

describe("SourceEvidenceAdapter", () => {
  it("binds a static observation to an exact source digest and line", () => {
    const report = ingestStaticAnalysis(base);
    const digest = createHash("sha256").update(source, "utf8").digest("hex");

    expect(report.sourceSha256).toBe(digest);
    expect(report.candidates).toHaveLength(1);
    expect(report.candidates[0]).toMatchObject({
      filename: "src/handlers.py",
      line: 3,
      kind: "dynamic-exec",
      sourceSha256: digest,
      confidence: 0.2,
      status: "unverified",
      classification: "static-review-signal"
    });
    expect(report.candidates[0].evidenceRef).toContain("#L3");
    expect(report.authorized).toBe(false);
    expect(report.sourceExecuted).toBe(false);
    expect(report.vulnerabilityConfirmed).toBe(false);
  });

  it("rejects an excerpt that does not belong to the claimed source line", () => {
    expect(() => ingestStaticAnalysis({
      ...base,
      observations: [{ ...base.observations[0], excerpt: "eval(other)" }]
    })).toThrow(/does not match/);
  });

  it("rejects out-of-range source line references", () => {
    expect(() => ingestStaticAnalysis({
      ...base,
      observations: [{ ...base.observations[0], line: 99 }]
    })).toThrow(/outside the supplied source/);
  });

  it("rejects unknown observation kinds rather than trusting arbitrary labels", () => {
    expect(() => ingestStaticAnalysis({
      ...base,
      observations: [{ ...base.observations[0], kind: "confirmed-rce" }]
    })).toThrow(/Unsupported/);
  });

  it("rejects any analysis result claiming authorization or execution", () => {
    expect(() => ingestStaticAnalysis({ ...base, authorized: true as unknown as false })).toThrow(/non-executing/);
    expect(() => ingestStaticAnalysis({ ...base, executes: true as false })).toThrow(/non-executing/);
  });

  it("rejects absolute and traversal filenames", () => {
    expect(() => ingestStaticAnalysis({ ...base, filename: "/etc/passwd" })).toThrow(/relative path/);
    expect(() => ingestStaticAnalysis({ ...base, filename: "src/../secret.py" })).toThrow(/relative path/);
    expect(() => ingestStaticAnalysis({ ...base, filename: "C:/secret.py" })).toThrow(/relative path/);
    expect(() => ingestStaticAnalysis({ ...base, filename: "src/\u0000secret.py" })).toThrow(/relative path/);
  });

  it("deduplicates identical signals while preserving distinct line evidence", () => {
    const report = ingestStaticAnalysis({
      ...base,
      observations: [
        base.observations[0],
        base.observations[0],
        { ...base.observations[0], line: 3 }
      ]
    });
    expect(report.candidates).toHaveLength(1);
  });

  it("marks truncated analysis as partial rather than treating missing signals as clean", () => {
    const report = ingestStaticAnalysis({ ...base, truncated: true, observations: [] });
    expect(report.completeness).toBe("partial");
    expect(report.notes.some(note => note.includes("not evidence of absence"))).toBe(true);
  });

  it("enforces source and observation bounds", () => {
    expect(() => ingestStaticAnalysis({ ...base, source: "x".repeat(1_000_001), observations: [] })).toThrow(/1 MB/);
    expect(() => ingestStaticAnalysis({
      ...base,
      observations: Array.from({ length: 101 }, () => base.observations[0])
    })).toThrow(/100-item/);
  });

  it("returns immutable report and candidate collections", () => {
    const report = ingestStaticAnalysis(base);
    expect(Object.isFrozen(report)).toBe(true);
    expect(Object.isFrozen(report.candidates)).toBe(true);
    expect(Object.isFrozen(report.candidates[0])).toBe(true);
  });
});
