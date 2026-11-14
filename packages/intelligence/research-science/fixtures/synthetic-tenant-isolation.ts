import type { SecurityWorldModelInput } from "../types";

export const SYNTHETIC_TENANT_ISOLATION_FIXTURE: SecurityWorldModelInput = {
  id: "synthetic:tenant-boundary-gap",
  version: 1,
  components: [
    { id: "document-service", kind: "service", name: "Synthetic document service" }
  ],
  identities: [
    { id: "tenant-a-owner", tenantId: "tenant-a", role: "owner" },
    { id: "tenant-b-member", tenantId: "tenant-b", role: "member" }
  ],
  resources: [
    { id: "tenant-a-document", tenantId: "tenant-a", ownerIdentityId: "tenant-a-owner", kind: "document" }
  ],
  operations: [
    { id: "document-read", componentId: "document-service", action: "read", tenantIsolationGuard: "absent" }
  ],
  invariants: [
    {
      id: "tenant-isolation",
      kind: "tenant-isolation",
      description: "An identity must not read resources owned by another tenant."
    }
  ],
  facts: [
    {
      id: "fixture-fact-tenant-guard",
      subjectId: "document-read",
      predicate: "tenant-isolation-guard",
      value: "absent",
      origin: "synthetic-fixture",
      confidence: 1,
      evidenceRef: "fixture://tenant-boundary-gap/document-read"
    }
  ]
};
