import type { ResearchHypothesis } from "./types";
import { SecurityWorldModel } from "./SecurityWorldModel";
import type { ModelCheckResult } from "./types";

/** Converts model counterexamples into explicitly unverified research hypotheses. */
export function generateHypotheses(
  model: SecurityWorldModel,
  result: ModelCheckResult
): ResearchHypothesis[] {
  if (result.status !== "counterexample") return [];

  return result.counterexamples.map(counterexample => {
    const supportingFacts = model.facts.filter(fact =>
      fact.subjectId === counterexample.operationId &&
      fact.predicate === "tenant-isolation-guard" &&
      fact.value === "absent"
    );
    const modelConfidence = supportingFacts.length === 0
      ? 0.35
      : Math.min(0.8, 0.5 + supportingFacts.reduce((sum, fact) => sum + fact.confidence, 0) * 0.15);

    return {
      id: [
        "hypothesis",
        counterexample.operationId,
        counterexample.identityId,
        counterexample.resourceId
      ].join(":"),
      kind: "tenant-isolation",
      title: "Potential cross-tenant authorization failure",
      description:
        "The supplied model predicts that an identity from one tenant can " +
        "access a resource belonging to another tenant through operation " +
        counterexample.operationId + ". This requires independent validation.",
      operationId: counterexample.operationId,
      identityId: counterexample.identityId,
      resourceId: counterexample.resourceId,
      evidenceRefs: [...counterexample.evidenceRefs],
      modelConfidence,
      impact: 0.85,
      status: "unverified"
    };
  });
}
