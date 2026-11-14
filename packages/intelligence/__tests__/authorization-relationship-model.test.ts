import { describe, expect, it } from "vitest";
import { AuthorizationRelationshipModel, checkAuthorizationRelationships, type AuthorizationRelationshipModelInput } from "../research-science/AuthorizationRelationshipModel";
import { SecurityWorldModel } from "../research-science/SecurityWorldModel";
import { SYNTHETIC_TENANT_ISOLATION_FIXTURE } from "../research-science/fixtures/synthetic-tenant-isolation";

const grants = [
  { id: "owner-read", role: "owner", action: "read" as const, resourceKind: "document", effect: "allow" as const, confidence: 1, evidenceRef: "fixture://grant/owner-read" },
  { id: "member-read", role: "member", action: "read" as const, resourceKind: "document", effect: "allow" as const, confidence: 1, evidenceRef: "fixture://grant/member-read" }
];

function makeModel(overrides: Partial<AuthorizationRelationshipModelInput> = {}) {
  return new AuthorizationRelationshipModel({
    id: "synthetic:authorization-relationships",
    version: 1,
    world: new SecurityWorldModel(SYNTHETIC_TENANT_ISOLATION_FIXTURE),
    permissionInventory: "complete",
    ownershipInventory: "complete",
    grants,
    ownershipRules: [{
      id: "document-read-ownership",
      operationId: "document-read",
      requirement: "not-required",
      confidence: 1,
      evidenceRef: "fixture://ownership/read-not-required"
    }],
    routeBindings: [{
      id: "document-read-route",
      operationId: "document-read",
      path: "/documents/{id}",
      methods: ["GET"],
      evidenceRef: "source://routes.py#L12"
    }],
    invariants: [{
      id: "tenant-boundary",
      kind: "tenant-isolation",
      description: "A principal must not read another tenant's document."
    }],
    ...overrides
  });
}

describe("AuthorizationRelationshipModel", () => {
  it("finds a cross-tenant allow using explicit role grants and route evidence", () => {
    const result = checkAuthorizationRelationships(makeModel());
    expect(result.status).toBe("counterexample");
    expect(result.counterexamples).toHaveLength(1);
    expect(result.counterexamples[0]).toMatchObject({
      invariantKind: "tenant-isolation",
      operationId: "document-read",
      identityId: "tenant-b-member",
      resourceId: "tenant-a-document",
      reason: "cross-tenant-allow",
      predictedDecision: "allow"
    });
    expect(result.counterexamples[0].evidenceRefs).toContain("fixture://grant/member-read");
    expect(result.counterexamples[0].evidenceRefs).toContain("source://routes.py#L12");
    expect(result.authorized).toBe(false);
    expect(result.executionPerformed).toBe(false);
    expect(result.findingStatus).toBe("unverified");
  });

  it("gives an explicit deny grant precedence over an allow grant", () => {
    const result = checkAuthorizationRelationships(makeModel({
      grants: [...grants, {
        id: "member-read-deny", role: "member", action: "read", resourceKind: "document",
        effect: "deny", confidence: 1, evidenceRef: "fixture://grant/member-read-deny"
      }]
    }));
    expect(result.status).toBe("no-counterexample");
    expect(result.counterexamples).toHaveLength(0);
  });

  it("does not interpret a missing grant as denial when the inventory is partial", () => {
    const result = checkAuthorizationRelationships(makeModel({
      permissionInventory: "partial",
      grants: [grants[0]]
    }));
    expect(result.status).toBe("inconclusive");
    expect(result.unknownPairs).toBe(1);
    expect(result.counterexamples).toHaveLength(0);
  });

  it("does not interpret a missing ownership rule as unrestricted when inventory is partial", () => {
    const result = checkAuthorizationRelationships(makeModel({
      ownershipInventory: "partial",
      ownershipRules: []
    }));
    expect(result.status).toBe("inconclusive");
    expect(result.unknownPairs).toBe(2);
  });

  it("honors residual authorization deny even when role grants allow", () => {
    const world = new SecurityWorldModel({
      ...SYNTHETIC_TENANT_ISOLATION_FIXTURE,
      operations: [{ ...SYNTHETIC_TENANT_ISOLATION_FIXTURE.operations[0], residualAuthorization: "deny" }]
    });
    const result = checkAuthorizationRelationships(makeModel({ world }));
    expect(result.status).toBe("no-counterexample");
    expect(result.counterexamples).toHaveLength(0);
  });

  it("keeps residual authorization unknown inconclusive", () => {
    const world = new SecurityWorldModel({
      ...SYNTHETIC_TENANT_ISOLATION_FIXTURE,
      operations: [{ ...SYNTHETIC_TENANT_ISOLATION_FIXTURE.operations[0], residualAuthorization: "unknown" }]
    });
    const result = checkAuthorizationRelationships(makeModel({ world }));
    expect(result.status).toBe("inconclusive");
    expect(result.unknownPairs).toBe(2);
  });

  it("treats unknown tenant guards as unknown rather than secure or vulnerable", () => {
    const world = new SecurityWorldModel({
      ...SYNTHETIC_TENANT_ISOLATION_FIXTURE,
      operations: [{ ...SYNTHETIC_TENANT_ISOLATION_FIXTURE.operations[0], tenantIsolationGuard: "unknown" }]
    });
    const result = checkAuthorizationRelationships(makeModel({ world }));
    expect(result.status).toBe("inconclusive");
    expect(result.unknownPairs).toBe(1);
    expect(result.counterexamples).toHaveLength(0);
  });

  it("detects non-owner writes when the modeled policy allows them", () => {
    const world = new SecurityWorldModel({
      ...SYNTHETIC_TENANT_ISOLATION_FIXTURE,
      identities: [
        ...SYNTHETIC_TENANT_ISOLATION_FIXTURE.identities,
        { id: "tenant-a-member", tenantId: "tenant-a", role: "member" }
      ],
      operations: [{ ...SYNTHETIC_TENANT_ISOLATION_FIXTURE.operations[0], action: "write" }],
      facts: []
    });
    const writeGrants = [
      { id: "owner-write", role: "owner", action: "write" as const, resourceKind: "document", effect: "allow" as const, confidence: 1, evidenceRef: "fixture://owner-write" },
      { id: "member-write", role: "member", action: "write" as const, resourceKind: "document", effect: "allow" as const, confidence: 1, evidenceRef: "fixture://member-write" }
    ];
    const result = checkAuthorizationRelationships(makeModel({
      world,
      grants: writeGrants,
      invariants: [{ id: "owner-only-write", kind: "owner-only-write", description: "Only the resource owner may write." }]
    }));
    expect(result.status).toBe("counterexample");
    expect(result.counterexamples.some(item => item.identityId === "tenant-a-member" && item.reason === "non-owner-write-allow")).toBe(true);
  });

  it("enforces an explicit owner-only rule and avoids the non-owner write counterexample", () => {
    const world = new SecurityWorldModel({
      ...SYNTHETIC_TENANT_ISOLATION_FIXTURE,
      identities: [
        ...SYNTHETIC_TENANT_ISOLATION_FIXTURE.identities,
        { id: "tenant-a-member", tenantId: "tenant-a", role: "member" }
      ],
      operations: [{ ...SYNTHETIC_TENANT_ISOLATION_FIXTURE.operations[0], action: "write" }],
      invariants: [{ id: "owner-only-write", kind: "owner-only-write", description: "Only the resource owner may write." }],
      facts: []
    });
    const result = checkAuthorizationRelationships(makeModel({
      world,
      grants: [
        { id: "owner-write", role: "owner", action: "write", resourceKind: "document", effect: "allow", confidence: 1, evidenceRef: "fixture://owner-write" },
        { id: "member-write", role: "member", action: "write", resourceKind: "document", effect: "allow", confidence: 1, evidenceRef: "fixture://member-write" }
      ],
      ownershipRules: [{
        id: "owner-only", operationId: "document-read", requirement: "owner-only",
        confidence: 1, evidenceRef: "fixture://owner-only"
      }],
      invariants: [{ id: "owner-only-write", kind: "owner-only-write", description: "Only the resource owner may write." }]
    }));
    expect(result.status).toBe("no-counterexample");
    expect(result.counterexamples).toHaveLength(0);
  });

  it("rejects relationships that reference unknown roles or operations", () => {
    expect(() => makeModel({
      grants: [{ ...grants[0], role: "superuser" }]
    })).toThrow(/unknown role/);
    expect(() => makeModel({
      ownershipRules: [{
        id: "bad-rule", operationId: "missing", requirement: "owner-only",
        confidence: 1, evidenceRef: "fixture://bad"
      }]
    })).toThrow(/unknown operation/);
  });

  it("returns inconclusive when no invariant is declared and freezes model collections", () => {
    const model = makeModel({ invariants: [] });
    const result = checkAuthorizationRelationships(model);
    expect(result.status).toBe("inconclusive");
    expect(Object.isFrozen(model.grants)).toBe(true);
    expect(() => (model.grants as unknown as unknown[]).push({})).toThrow();
  });

  it("honors an enforced cross-tenant deny even when residual authorization is unknown", () => {
    const world = new SecurityWorldModel({
      ...SYNTHETIC_TENANT_ISOLATION_FIXTURE,
      operations: [{
        ...SYNTHETIC_TENANT_ISOLATION_FIXTURE.operations[0],
        tenantIsolationGuard: "enforced" as const,
        residualAuthorization: "unknown" as const
      }]
    });
    const result = checkAuthorizationRelationships(makeModel({ world }));
    expect(result.status).toBe("inconclusive");
    expect(result.unknownPairs).toBe(1);
    expect(result.counterexamples).toHaveLength(0);
  });
});
