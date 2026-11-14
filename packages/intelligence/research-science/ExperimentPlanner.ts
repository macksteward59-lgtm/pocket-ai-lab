import type { ExperimentProposal, ResearchHypothesis } from "./types";

/**
 * Ranks safe, synthetic-only experiment proposals. It does not execute them.
 * Scores are deterministic and bounded so model-generated numbers are not trusted.
 */
export function planExperiments(
  fixtureId: string,
  hypotheses: readonly ResearchHypothesis[]
): ExperimentProposal[] {
  if (typeof fixtureId !== "string" || !fixtureId.startsWith("synthetic:") || fixtureId.length > 128) {
    throw new Error("Research POC accepts synthetic fixture identifiers only");
  }

  return hypotheses.map(hypothesis => {
    const uncertainty = clamp(1 - hypothesis.modelConfidence);
    const informationGain = clamp(0.65 + uncertainty * 0.35);
    const impact = clamp(hypothesis.impact);
    const estimatedCost = 0.15;
    const risk = 0;
    const priority = Math.round(
      100 * clamp((impact * 0.35 + uncertainty * 0.25 + informationGain * 0.4) / (1 + estimatedCost))
    );

    return {
      id: "experiment:" + hypothesis.id,
      hypothesisId: hypothesis.id,
      fixtureId,
      operationId: hypothesis.operationId,
      identityId: hypothesis.identityId,
      resourceId: hypothesis.resourceId,
      expectedInvariant: "deny-cross-tenant-access",
      predictedModelOutcome: "allow",
      informationGain,
      impact,
      uncertainty,
      estimatedCost,
      risk,
      priority,
      executionMode: "proposal-only",
      authorizationStatus: "not-requested"
    };
  }).sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
}

function clamp(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}
