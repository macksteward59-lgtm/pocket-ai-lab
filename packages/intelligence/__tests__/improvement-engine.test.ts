import { describe, expect, it } from "vitest";
import { assessImprovement, type EvaluationRun } from "../evaluation/ImprovementEngine";

function run(
  modelId: string,
  scores: number[],
  overrides: Partial<{ passed: boolean; safetyViolation: boolean; runId: string }> = {}
): EvaluationRun {
  return {
    runId: overrides.runId ?? "run-" + modelId,
    modelId,
    datasetVersion: "bench-v1",
    completedAt: "2026-11-12T00:00:00.000Z",
    results: scores.map((score, index) => ({
      caseId: "case-" + index,
      score,
      passed: overrides.passed ?? score >= 0.7,
      safetyViolation: overrides.safetyViolation ?? false,
      latencyMs: 100
    }))
  };
}

describe("assessImprovement", () => {
  it("recommends review only after paired benchmark gains and safety gates pass", () => {
    const result = assessImprovement(
      run("baseline", [0.6, 0.6, 0.6, 0.6, 0.6]),
      run("candidate", [0.8, 0.8, 0.8, 0.8, 0.8])
    );
    expect(result.eligibleForHumanReview).toBe(true);
    expect(result.recommendation).toBe("review_candidate");
    expect(result.safetyViolationDelta).toBe(0);
  });

  it("allows prompt or workflow experiments that retain the same model ID", () => {
    const baseline = run("same-model", [0.6, 0.6, 0.6, 0.6, 0.6], { runId: "prompt-v1" });
    const candidate = run("same-model", [0.8, 0.8, 0.8, 0.8, 0.8], { runId: "prompt-v2" });
    const result = assessImprovement(baseline, candidate);
    expect(result.recommendation).toBe("review_candidate");
    expect(result.baseline.modelId).toBe(result.candidate.modelId);
  });

  it("rejects comparing the same evaluation run to itself", () => {
    expect(() => assessImprovement(
      run("same-model", [0.6, 0.6, 0.6, 0.6, 0.6], { runId: "identical-run" }),
      run("same-model", [0.8, 0.8, 0.8, 0.8, 0.8], { runId: "identical-run" })
    )).toThrow(/different evaluation runs/);
  });

  it("accepts a gain exactly at the configured score threshold despite float representation", () => {
    const result = assessImprovement(
      run("baseline", [0.8, 0.8, 0.8, 0.8, 0.8]),
      run("candidate", [0.82, 0.82, 0.82, 0.82, 0.82])
    );
    expect(result.scoreGain).toBeCloseTo(0.02, 12);
    expect(result.recommendation).toBe("review_candidate");
  });

  it("rejects a gain meaningfully below the configured threshold", () => {
    const result = assessImprovement(
      run("baseline", [0.8, 0.8, 0.8, 0.8, 0.8]),
      run("candidate", [0.819999, 0.819999, 0.819999, 0.819999, 0.819999])
    );
    expect(result.recommendation).toBe("keep_baseline");
    expect(result.reasons.join(" ")).toMatch(/minimum threshold/);
  });

  it("keeps the baseline when candidate safety regresses", () => {
    const result = assessImprovement(
      run("baseline", [0.6, 0.6, 0.6, 0.6, 0.6]),
      run("candidate", [0.9, 0.9, 0.9, 0.9, 0.9], { safetyViolation: true })
    );
    expect(result.recommendation).toBe("keep_baseline");
    expect(result.reasons.join(" ")).toMatch(/safety violations/);
  });

  it("rejects mismatched benchmark datasets and case sets", () => {
    const baseline = run("baseline", [0.5, 0.5, 0.5, 0.5, 0.5]);
    const wrongVersion = { ...run("candidate", [0.8, 0.8, 0.8, 0.8, 0.8]), datasetVersion: "bench-v2" };
    expect(() => assessImprovement(baseline, wrongVersion)).toThrow(/same dataset version/);
    const wrongCases = run("candidate", [0.8, 0.8, 0.8, 0.8, 0.8]);
    const changed = wrongCases.results.map((result, index) => index === 0 ? { ...result, caseId: "different-case" } : result);
    expect(() => assessImprovement(baseline, { ...wrongCases, results: changed })).toThrow(/same evaluation cases/);
  });

  it("requires enough evaluation cases", () => {
    const result = assessImprovement(
      run("baseline", [0.5, 0.5, 0.5, 0.5]),
      run("candidate", [0.9, 0.9, 0.9, 0.9])
    );
    expect(result.recommendation).toBe("keep_baseline");
    expect(result.reasons.join(" ")).toMatch(/Insufficient benchmark coverage/);
  });

  it("does not accept duplicate cases or invalid scores", () => {
    const duplicate = run("baseline", [0.5, 0.5, 0.5, 0.5, 0.5]);
    const duplicated = duplicate.results.map((result, index) => index === 1
      ? { ...result, caseId: duplicate.results[0].caseId }
      : result);
    expect(() => assessImprovement({ ...duplicate, results: duplicated }, run("candidate", [0.8, 0.8, 0.8, 0.8, 0.8]))).toThrow(/duplicate caseId/);
    const invalid = run("candidate", [0.8, 0.8, 0.8, 0.8, 0.8]);
    const invalidResults = invalid.results.map((result, index) => index === 0 ? { ...result, score: 1.5 } : result);
    expect(() => assessImprovement(run("baseline", [0.5, 0.5, 0.5, 0.5, 0.5]), { ...invalid, results: invalidResults })).toThrow(/between 0 and 1/);
  });

  it("does not recommend a candidate whose pass rate regresses", () => {
    const baseline = run("baseline", [0.6, 0.6, 0.6, 0.6, 0.6], { passed: true });
    const candidate = run("candidate", [0.9, 0.9, 0.9, 0.9, 0.9], { passed: false });
    const result = assessImprovement(baseline, candidate);
    expect(result.recommendation).toBe("keep_baseline");
    expect(result.reasons.join(" ")).toMatch(/pass rate regressed/);
  });

  it("exposes immutable assessment result types and runtime values", () => {
    const result = assessImprovement(
      run("baseline", [0.6, 0.6, 0.6, 0.6, 0.6]),
      run("candidate", [0.8, 0.8, 0.8, 0.8, 0.8])
    );
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.baseline)).toBe(true);
    expect(Object.isFrozen(result.candidate)).toBe(true);
    expect(Object.isFrozen(result.reasons)).toBe(true);
  });
});
