export type SecurityAction = "read" | "write" | "delete";
export type GuardState = "enforced" | "absent" | "unknown";

export interface WorldComponent {
  id: string;
  kind: "api" | "service" | "database" | "worker";
  name: string;
}

export interface WorldIdentity {
  id: string;
  tenantId: string;
  role: string;
}

export interface WorldResource {
  id: string;
  tenantId: string;
  ownerIdentityId: string;
  kind: string;
}

export interface WorldOperation {
  id: string;
  componentId: string;
  action: SecurityAction;
  tenantIsolationGuard: GuardState;
}

export interface WorldInvariant {
  id: string;
  kind: "tenant-isolation";
  description: string;
}

export interface WorldFact {
  id: string;
  subjectId: string;
  predicate: string;
  value: string;
  origin: "synthetic-fixture" | "source-analysis" | "runtime-observation";
  confidence: number;
  evidenceRef: string;
}

export interface SecurityWorldModelInput {
  id: string;
  version: number;
  components: WorldComponent[];
  identities: WorldIdentity[];
  resources: WorldResource[];
  operations: WorldOperation[];
  invariants: WorldInvariant[];
  facts: WorldFact[];
}

export interface Counterexample {
  invariantId: string;
  operationId: string;
  identityId: string;
  resourceId: string;
  actorTenantId: string;
  resourceTenantId: string;
  predictedDecision: "allow";
  evidenceRefs: string[];
}

export interface ModelCheckResult {
  status: "counterexample" | "no-counterexample" | "inconclusive";
  checkedPairs: number;
  unknownPairs: number;
  counterexamples: Counterexample[];
  notes: string[];
}

export interface ResearchHypothesis {
  id: string;
  kind: "tenant-isolation";
  title: string;
  description: string;
  operationId: string;
  identityId: string;
  resourceId: string;
  evidenceRefs: string[];
  modelConfidence: number;
  impact: number;
  status: "unverified";
}

export interface ExperimentProposal {
  id: string;
  hypothesisId: string;
  fixtureId: string;
  operationId: string;
  identityId: string;
  resourceId: string;
  expectedInvariant: "deny-cross-tenant-access";
  predictedModelOutcome: "allow";
  informationGain: number;
  impact: number;
  uncertainty: number;
  estimatedCost: number;
  risk: number;
  priority: number;
  executionMode: "proposal-only";
  authorizationStatus: "not-requested";
}

export interface ResearchPocReport {
  fixtureId: string;
  modelVersion: number;
  modelCheck: ModelCheckResult;
  hypotheses: ResearchHypothesis[];
  experiments: ExperimentProposal[];
  findingStatus: "unverified";
  authorized: false;
  executionPerformed: false;
  targetType: "synthetic-fixture";
  limitations: string[];
}
