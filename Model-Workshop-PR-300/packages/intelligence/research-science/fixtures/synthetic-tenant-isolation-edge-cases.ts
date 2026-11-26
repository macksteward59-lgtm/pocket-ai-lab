import type { SecurityWorldModelInput } from "../types";

export const SYNTHETIC_TENANT_ISOLATION_SECURE_FIXTURE: SecurityWorldModelInput = {
  id: "synthetic:tenant-isolation-secure",
  version: 1,
  components: [{ id: "document-service", kind: "service", name: "Synthetic document service" }],
  identities: [
    { id: "tenant-a-owner", tenantId: "tenant-a", role: "owner" },
    { id: "tenant-b-member", tenantId: "tenant-b", role: "member" }
  ],
  resources: [
    { id: "tenant-a-document", tenantId: "tenant-a", ownerIdentityId: "tenant-a-owner", kind: "document" }
  ],
  operations: [
    { id: "document-read", componentId: "document-service", action: "read", tenantIsolationGuard: "enforced", residualAuthorization: "allow" }
  ],
  invariants: [{
    id: "tenant-isolation",
    kind: "tenant-isolation",
    description: "An identity must not read resources owned by another tenant."
  }],
  facts: [{
    id: "fixture-fact-tenant-guard",
    subjectId: "document-read",
    predicate: "tenant-isolation-guard",
    value: "enforced",
    origin: "synthetic-fixture",
    confidence: 1,
    evidenceRef: "fixture://tenant-isolation-secure/document-read"
  }]
};

export const SYNTHETIC_TENANT_ISOLATION_UNKNOWN_FIXTURE: SecurityWorldModelInput = {
  ...SYNTHETIC_TENANT_ISOLATION_SECURE_FIXTURE,
  id: "synthetic:tenant-isolation-unknown",
  operations: [{
    id: "document-read",
    componentId: "document-service",
    action: "read",
    tenantIsolationGuard: "unknown",
    residualAuthorization: "unknown"
  }],
  facts: []
};
