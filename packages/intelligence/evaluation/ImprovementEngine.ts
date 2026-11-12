/**
 * Evidence-based model improvement assessment.
 *
 * This module compares two independently evaluated runs on the same
 * versioned benchmark. It can recommend a candidate for human review; it
 * cannot train, deploy, promote, authorize, or change a production model.
 */
export interface EvaluationCaseResult {
  readonly caseId: string;
  readonly score: number;
  readonly passed: boolean;
  readonly safetyViolation: boolean;
  readonly latencyMs: number;
}

export interface EvaluationRun {
  readonly runId: string;
  readonly modelId: string;
  readonly datasetVersion: string;
  readonly completedAt: string;
  readonly results: readonly EvaluationCaseResult[];
}

export interface AssessmentOptions {
  readonly minimumCases?: number;
  readonly minimumScoreGain?: number;
}

export interface RunMetrics {
  readonly modelId: string;
  readonly sampleCount: number;
  readonly meanScore: number;
  readonly passRate: number;
  readonly safetyViolations: number;
  readonly meanLatencyMs: number;
}

export interface ImprovementAssessment {
  readonly baseline: RunMetrics;
  readonly candidate: RunMetrics;
  readonly scoreGain: number;
  readonly passRateGain: number;
  readonly safetyViolationDelta: number;
  readonly eligibleForHumanReview: boolean;
  readonly reasons: readonly string[];
  readonly recommendation: "review_candidate" | "keep_baseline";
}

function validateRun(run: EvaluationRun, label: string): void {
  if (!run || !run.runId?.trim() || !run.modelId?.trim() || !run.datasetVersion?.trim()) {
    throw new Error(label + " run metadata is incomplete");
  }
  if (!Array.isArray(run.results) || run.results.length === 0) {
    throw new Error(label + " run must contain evaluation results");
  }
  const ids = new Set<string>();
  for (const result of run.results) {
    if (!result.caseId?.trim() || ids.has(result.caseId)) {
      throw new Error(label + " run contains a missing or duplicate caseId");
    }
    ids.add(result.caseId);
    if (!Number.isFinite(result.score) || result.score < 0 || result.score > 1) {
      throw new Error(label + " score must be between 0 and 1");
    }
    if (!Number.isFinite(result.latencyMs) || result.latencyMs < 0) {
      throw new Error(label + " latencyMs must be a non-negative number");
    }
    if (typeof result.passed !== "boolean" || typeof result.safetyViolation !== "boolean") {
      throw new Error(label + " result flags must be boolean");
    }
  }
}

function metrics(run: EvaluationRun): RunMetrics {
  const count = run.results.length;
  return Object.freeze({
    modelId: run.modelId,
    sampleCount: count,
    meanScore: run.results.reduce((sum, item) => sum + item.score, 0) / count,
    passRate: run.results.filter(item => item.passed).length / count,
    safetyViolations: run.results.filter(item => item.safetyViolation).length,
    meanLatencyMs: run.results.reduce((sum, item) => sum + item.latencyMs, 0) / count
  });
}

/**
 * Paired benchmark comparison. Dataset version and case IDs must match so
 * apparent gains cannot come from evaluating different questions.
 *
 * The same model may appear in both runs: prompt, retrieval, routing, or
 * tool-workflow experiments can change behavior without changing modelId.
 * Distinct run IDs identify the independently evaluated configurations.
 */
export function assessImprovement(
  baselineRun: EvaluationRun,
  candidateRun: EvaluationRun,
  options: AssessmentOptions = {}
): ImprovementAssessment {
  validateRun(baselineRun, "Baseline");
  validateRun(candidateRun, "Candidate");

  const minimumCases = options.minimumCases ?? 5;
  const minimumScoreGain = options.minimumScoreGain ?? 0.02;
  if (!Number.isInteger(minimumCases) || minimumCases < 1) {
    throw new Error("minimumCases must be a positive integer");
  }
  if (!Number.isFinite(minimumScoreGain) || minimumScoreGain < 0 || minimumScoreGain > 1) {
    throw new Error("minimumScoreGain must be between 0 and 1");
  }
  if (baselineRun.runId === candidateRun.runId) {
    throw new Error("Baseline and candidate must identify different evaluation runs");
  }
  if (baselineRun.datasetVersion !== candidateRun.datasetVersion) {
    throw new Error("Baseline and candidate must use the same dataset version");
  }

  const baselineIds = baselineRun.results.map(item => item.caseId).sort();
  const candidateIds = candidateRun.results.map(item => item.caseId).sort();
  if (baselineIds.length !== candidateIds.length ||
      baselineIds.some((id, index) => id !== candidateIds[index])) {
    throw new Error("Baseline and candidate must contain the same evaluation cases");
  }

  const baseline = metrics(baselineRun);
  const candidate = metrics(candidateRun);
  const scoreGain = candidate.meanScore - baseline.meanScore;
  const passRateGain = candidate.passRate - baseline.passRate;
  const safetyViolationDelta = candidate.safetyViolations - baseline.safetyViolations;
  const reasons: string[] = [];

  if (candidate.sampleCount < minimumCases) {
    reasons.push("Insufficient benchmark coverage: " + candidate.sampleCount + " of " + minimumCases + " required cases.");
  }
  // Bound floating-point accumulation error across both score sums and the
  // final division/subtraction. The tolerance scales with sample count, but
  // remains at machine-precision scale (not a user-visible score increment).
  // This accommodates exact decimal cutoffs such as 39 × (0.82 - 0.80)
  // without rounding materially below-threshold candidates up.
  const roundingTolerance =
    Number.EPSILON *
    Math.max(1, Math.abs(baseline.meanScore), Math.abs(candidate.meanScore)) *
    (candidate.sampleCount + 2);
  if (scoreGain + roundingTolerance < minimumScoreGain) {
    reasons.push("Score gain did not meet the minimum threshold.");
  }
  if (passRateGain < 0) {
    reasons.push("Candidate pass rate regressed.");
  }
  if (safetyViolationDelta > 0) {
    reasons.push("Candidate introduced additional safety violations.");
  }

  const eligibleForHumanReview = reasons.length === 0;
  if (eligibleForHumanReview) {
    reasons.push("Candidate meets benchmark gates; independent human review is still required.");
  }

  return Object.freeze({
    baseline,
    candidate,
    scoreGain,
    passRateGain,
    safetyViolationDelta,
    eligibleForHumanReview,
    reasons: Object.freeze(reasons),
    recommendation: eligibleForHumanReview ? "review_candidate" : "keep_baseline"
  });
}
