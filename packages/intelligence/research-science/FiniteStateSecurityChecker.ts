import type { ModelCheckResult, Counterexample } from "./types";
import { SecurityWorldModel } from "./SecurityWorldModel";

/**
 * Enumerates the finite identity/resource state space in a supplied model.
 * It never connects to a target, sends requests, or executes application code.
 */
export function checkTenantIsolation(model: SecurityWorldModel): ModelCheckResult {
  const invariant = model.invariants.find(item => item.kind === "tenant-isolation");
  if (!invariant) {
    return {
      status: "inconclusive",
      checkedPairs: 0,
      unknownPairs: 0,
      counterexamples: [],
      notes: ["No tenant-isolation invariant was supplied."]
    };
  }

  const counterexamples: Counterexample[] = [];
  let checkedPairs = 0;
  let unknownPairs = 0;

  for (const operation of model.operations) {
    for (const identity of model.identities) {
      for (const resource of model.resources) {
        if (identity.tenantId === resource.tenantId) continue;
        checkedPairs += 1;
        if (operation.tenantIsolationGuard === "enforced" || operation.residualAuthorization === "deny") continue;
        if (operation.tenantIsolationGuard === "unknown" || operation.residualAuthorization === "unknown") {
          unknownPairs += 1;
          continue;
        }
        if (operation.residualAuthorization !== "allow") {
          unknownPairs += 1;
          continue;
        }

        const evidenceRefs = model.facts
          .filter(fact =>
            fact.subjectId === operation.id &&
            fact.predicate === "tenant-isolation-guard" &&
            fact.value === "absent"
          )
          .map(fact => fact.evidenceRef);

        counterexamples.push({
          invariantId: invariant.id,
          operationId: operation.id,
          identityId: identity.id,
          resourceId: resource.id,
          actorTenantId: identity.tenantId,
          resourceTenantId: resource.tenantId,
          predictedDecision: "allow",
          evidenceRefs
        });
      }
    }
  }

  const status = counterexamples.length > 0
    ? "counterexample"
    : unknownPairs > 0 || checkedPairs === 0
      ? "inconclusive"
      : "no-counterexample";

  return {
    status,
    checkedPairs,
    unknownPairs,
    counterexamples,
    notes: [
      "Results describe the supplied model only; they are not observations of a live application.",
      ...(unknownPairs > 0 ? ["Unknown guard or residual-authorization states were not treated as secure or vulnerable."] : []),
      ...(checkedPairs === 0 ? ["No cross-tenant identity/resource pair was available to exercise the invariant."] : [])
    ]
  };
}
