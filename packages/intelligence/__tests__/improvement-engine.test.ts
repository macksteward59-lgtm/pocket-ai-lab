import { describe, expect, it } from "vitest";
import { assessImprovement, type EvaluationRun } from "../evaluation/ImprovementEngine";

function run(modelId: string, scores: number[], overrides: Partial<{ passed: boolean; safetyViolation: boolean }> = {}): EvaluationRun {
  return {
    runId: "run-" + modelId,
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
    wrongCases.results[0].caseId = "different-case";
    expect(() => assessImprovement(baseline, wrongCases)).toThrow(/same evaluation cases/);
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
    duplicate.results[1].caseId = duplicate.results[0].caseId;
    expect(() => assessImprovement(duplicate, run("candidate", [0.8, 0.8, 0.8, 0.8, 0.8]))).toThrow(/duplicate caseId/);
    const invalid = run("candidate", [0.8, 0.8, 0.8, 0.8, 0.8]);
    invalid.results[0].score = 1.5;
    expect(() => assessImprovement(run("baseline", [0.5, 0.5, 0.5, 0.5, 0.5]), invalid)).toThrow(/between 0 and 1/);
  });

  it("does not promote a candidate whose pass rate regresses", () => {
    const baseline = run("baseline", [0.6, 0.6, 0.6, 0.6, 0.6], { passed: true });
    const candidate = run("candidate", [0.9, 0.9, 0.9, 0.9, 0.9], { passed: false });
    const result = assessImprovement(baseline, candidate);
    expect(result.recommendation).toBe("keep_baseline");
    expect(result.reasons.join(" ")).toMatch(/pass rate regressed/);
  });
});
