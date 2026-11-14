import { describe, expect, it } from "vitest";
import { runResearchPoc } from "../research-science/ResearchPoc";
import { SecurityWorldModel } from "../research-science/SecurityWorldModel";
import { checkTenantIsolation } from "../research-science/FiniteStateSecurityChecker";
import { planExperiments } from "../research-science/ExperimentPlanner";
import { SYNTHETIC_TENANT_ISOLATION_FIXTURE } from "../research-science/fixtures/synthetic-tenant-isolation";

describe("PAL research science proof of concept", () => {
  it("models a cross-tenant counterexample without claiming a live vulnerability", () => {
    const report = runResearchPoc(SYNTHETIC_TENANT_ISOLATION_FIXTURE);

    expect(report.modelCheck.status).toBe("counterexample");
    expect(report.modelCheck.counterexamples).toHaveLength(1);
    expect(report.modelCheck.counterexamples[0]).toMatchObject({
      operationId: "document-read",
      identityId: "tenant-b-member",
      resourceId: "tenant-a-document",
      predictedDecision: "allow"
    });
    expect(report.findingStatus).toBe("unverified");
    expect(report.authorized).toBe(false);
    expect(report.executionPerformed).toBe(false);
    expect(report.targetType).toBe("synthetic-fixture");
  });

  it("creates traceable hypotheses and proposal-only experiments", () => {
    const report = runResearchPoc(SYNTHETIC_TENANT_ISOLATION_FIXTURE);

    expect(report.hypotheses).toHaveLength(1);
    expect(report.hypotheses[0].status).toBe("unverified");
    expect(report.hypotheses[0].evidenceRefs).toEqual([
      "fixture://tenant-boundary-gap/document-read"
    ]);
    expect(report.experiments).toHaveLength(1);
    expect(report.experiments[0].executionMode).toBe("proposal-only");
    expect(report.experiments[0].authorizationStatus).toBe("not-requested");
    expect(report.experiments[0].risk).toBe(0);
    expect(report.experiments[0].priority).toBeGreaterThan(0);
  });

  it("does not convert unknown guard state into a vulnerability", () => {
    const input = {
      ...SYNTHETIC_TENANT_ISOLATION_FIXTURE,
      operations: [{
        ...SYNTHETIC_TENANT_ISOLATION_FIXTURE.operations[0],
        tenantIsolationGuard: "unknown" as const
      }],
      facts: []
    };
    const result = checkTenantIsolation(new SecurityWorldModel(input));

    expect(result.status).toBe("inconclusive");
    expect(result.counterexamples).toHaveLength(0);
    expect(result.unknownPairs).toBe(1);
  });

  it("recognizes an enforced tenant boundary", () => {
    const input = {
      ...SYNTHETIC_TENANT_ISOLATION_FIXTURE,
      operations: [{
        ...SYNTHETIC_TENANT_ISOLATION_FIXTURE.operations[0],
        tenantIsolationGuard: "enforced" as const
      }],
      facts: SYNTHETIC_TENANT_ISOLATION_FIXTURE.facts.map(fact => ({ ...fact, value: "enforced" }))
    };
    const report = runResearchPoc(input);

    expect(report.modelCheck.status).toBe("no-counterexample");
    expect(report.hypotheses).toHaveLength(0);
    expect(report.experiments).toHaveLength(0);
  });

  it("does not report a counterexample when an independent authorization control denies access", () => {
    const input = {
      ...SYNTHETIC_TENANT_ISOLATION_FIXTURE,
      operations: [{ ...SYNTHETIC_TENANT_ISOLATION_FIXTURE.operations[0], residualAuthorization: "deny" as const }]
    };
    const report = runResearchPoc(input);
    expect(report.modelCheck.status).toBe("no-counterexample");
    expect(report.hypotheses).toHaveLength(0);
  });

  it("returns inconclusive when no cross-tenant pair exists", () => {
    const input = {
      ...SYNTHETIC_TENANT_ISOLATION_FIXTURE,
      identities: [SYNTHETIC_TENANT_ISOLATION_FIXTURE.identities[0]]
    };
    const result = checkTenantIsolation(new SecurityWorldModel(input));
    expect(result.status).toBe("inconclusive");
    expect(result.checkedPairs).toBe(0);
  });

  it("rejects contradictory facts instead of silently choosing one", () => {
    expect(() => new SecurityWorldModel({
      ...SYNTHETIC_TENANT_ISOLATION_FIXTURE,
      operations: [{ ...SYNTHETIC_TENANT_ISOLATION_FIXTURE.operations[0], tenantIsolationGuard: "enforced" as const }]
    })).toThrow(/conflicts/);
  });

  it("rejects malformed models and duplicate identifiers", () => {
    expect(() => new SecurityWorldModel({
      ...SYNTHETIC_TENANT_ISOLATION_FIXTURE,
      resources: [{
        ...SYNTHETIC_TENANT_ISOLATION_FIXTURE.resources[0],
        ownerIdentityId: "missing-identity"
      }]
    })).toThrow(/Unknown resource owner/);

    expect(() => new SecurityWorldModel({
      ...SYNTHETIC_TENANT_ISOLATION_FIXTURE,
      identities: [
        ...SYNTHETIC_TENANT_ISOLATION_FIXTURE.identities,
        SYNTHETIC_TENANT_ISOLATION_FIXTURE.identities[0]
      ]
    })).toThrow(/Duplicate identities id/);
  });

  it("rejects non-synthetic experiment scopes", () => {
    expect(() => planExperiments("https://example.invalid", [])).toThrow(/synthetic fixture/);
    expect(() => runResearchPoc({
      ...SYNTHETIC_TENANT_ISOLATION_FIXTURE,
      id: "https://example.invalid"
    })).toThrow(/synthetic fixtures only/);
  });

  it("exposes immutable validated model collections", () => {
    const model = new SecurityWorldModel(SYNTHETIC_TENANT_ISOLATION_FIXTURE);
    expect(Object.isFrozen(model.identities)).toBe(true);
    expect(() => (model.identities as unknown as unknown[]).push({})).toThrow();
  });
});
