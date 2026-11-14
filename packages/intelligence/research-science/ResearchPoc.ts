import { planExperiments } from "./ExperimentPlanner";
import { generateHypotheses } from "./HypothesisEngine";
import { checkTenantIsolation } from "./FiniteStateSecurityChecker";
import { SecurityWorldModel } from "./SecurityWorldModel";
import type { ResearchPocReport, SecurityWorldModelInput } from "./types";

/**
 * Runs the deterministic research demonstration against a synthetic fixture.
 * This function has no network, filesystem, tool-execution, or authorization adapter.
 */
export function runResearchPoc(input: SecurityWorldModelInput): ResearchPocReport {
  if (!input?.id?.startsWith("synthetic:")) {
    throw new Error("The proof of concept accepts synthetic fixtures only");
  }

  const model = new SecurityWorldModel(input);
  const modelCheck = checkTenantIsolation(model);
  const hypotheses = generateHypotheses(model, modelCheck);
  const experiments = planExperiments(model.id, hypotheses);

  return Object.freeze({
    fixtureId: model.id,
    modelVersion: model.version,
    modelCheck,
    hypotheses,
    experiments,
    findingStatus: "unverified",
    authorized: false,
    executionPerformed: false,
    targetType: "synthetic-fixture",
    limitations: [
      "The model checker evaluates an explicit synthetic model, not a live application.",
      "A model counterexample is a research lead, not a confirmed vulnerability.",
      "Experiment proposals are not executed and do not authorize target access.",
      "Evidence references identify fixture facts; they are not signed evidence receipts."
    ]
  });
}
