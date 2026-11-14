import type { SecurityAction } from "./types";
import { SecurityWorldModel } from "./SecurityWorldModel";

export type PermissionEffect = "allow" | "deny";
export type OwnershipRequirement = "owner-only" | "not-required" | "unknown";
export type AuthorizationInvariantKind = "tenant-isolation" | "owner-only-write";

export interface RolePermissionGrant {
  id: string;
  role: string;
  action: SecurityAction;
  resourceKind: string;
  effect: PermissionEffect;
  confidence: number;
  evidenceRef: string;
}

export interface ResourceOwnershipRule {
  id: string;
  operationId: string;
  requirement: OwnershipRequirement;
  confidence: number;
  evidenceRef: string;
}

export interface AuthorizationRouteBinding {
  id: string;
  operationId: string;
  path: string | null;
  methods: readonly string[];
  evidenceRef: string;
}

export interface AuthorizationInvariant {
  id: string;
  kind: AuthorizationInvariantKind;
  description: string;
}

export interface AuthorizationRelationshipModelInput {
  id: string;
  version: number;
  world: SecurityWorldModel;
  permissionInventory: "complete" | "partial";
  ownershipInventory: "complete" | "partial";
  grants: readonly RolePermissionGrant[];
  ownershipRules: readonly ResourceOwnershipRule[];
  routeBindings: readonly AuthorizationRouteBinding[];
  invariants: readonly AuthorizationInvariant[];
}

export interface AuthorizationCounterexample {
  invariantId: string;
  invariantKind: AuthorizationInvariantKind;
  operationId: string;
  identityId: string;
  resourceId: string;
  actorRole: string;
  resourceOwnerIdentityId: string;
  actorTenantId: string;
  resourceTenantId: string;
  predictedDecision: "allow";
  reason: "cross-tenant-allow" | "non-owner-write-allow";
  evidenceRefs: readonly string[];
}

export interface AuthorizationRelationshipCheck {
  status: "counterexample" | "no-counterexample" | "inconclusive";
  checkedPairs: number;
  unknownPairs: number;
  counterexamples: readonly AuthorizationCounterexample[];
  notes: readonly string[];
  findingStatus: "unverified";
  authorized: false;
  executionPerformed: false;
}

const MAX_ITEMS = 500;
const MAX_TEXT = 512;
const MAX_COUNTEREXAMPLES = 1_000;

function text(value: unknown, field: string, max = MAX_TEXT): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > max) {
    throw new Error(field + " must be a non-empty bounded string");
  }
  return value;
}

function unique(items: readonly { id: string }[], field: string): Set<string> {
  if (!Array.isArray(items) || items.length > MAX_ITEMS) {
    throw new Error(field + " must contain at most " + MAX_ITEMS + " entries");
  }
  const ids = new Set<string>();
  for (const item of items) {
    const id = text(item?.id, field + ".id");
    if (ids.has(id)) throw new Error("Duplicate " + field + " id: " + id);
    ids.add(id);
  }
  return ids;
}

/**
 * Immutable authorization relationship graph layered over a validated
 * SecurityWorldModel. Inventory completeness is explicit so absence of a
 * grant or ownership rule is never silently interpreted as a denial.
 */
export class AuthorizationRelationshipModel {
  readonly id: string;
  readonly version: number;
  readonly world: SecurityWorldModel;
  readonly permissionInventory: "complete" | "partial";
  readonly ownershipInventory: "complete" | "partial";
  readonly grants: readonly Readonly<RolePermissionGrant>[];
  readonly ownershipRules: readonly Readonly<ResourceOwnershipRule>[];
  readonly routeBindings: readonly Readonly<AuthorizationRouteBinding>[];
  readonly invariants: readonly Readonly<AuthorizationInvariant>[];

  constructor(input: AuthorizationRelationshipModelInput) {
    if (!input || typeof input !== "object") throw new Error("Authorization relationship input is required");
    this.id = text(input.id, "authorizationModel.id");
    if (!Number.isSafeInteger(input.version) || input.version < 1) throw new Error("authorizationModel.version must be positive");
    this.version = input.version;
    if (!(input.world instanceof SecurityWorldModel)) throw new Error("A validated SecurityWorldModel is required");
    this.world = input.world;
    if (!["complete", "partial"].includes(input.permissionInventory)) throw new Error("Invalid permission inventory state");
    if (!["complete", "partial"].includes(input.ownershipInventory)) throw new Error("Invalid ownership inventory state");
    this.permissionInventory = input.permissionInventory;
    this.ownershipInventory = input.ownershipInventory;

    const grantIds = unique(input.grants, "grants");
    const ownershipIds = unique(input.ownershipRules, "ownershipRules");
    unique(input.routeBindings, "routeBindings");
    unique(input.invariants, "authorizationInvariants");
    const roleNames = new Set(this.world.identities.map(identity => identity.role));
    const actions = new Set(this.world.operations.map(operation => operation.action));
    const resourceKinds = new Set(this.world.resources.map(resource => resource.kind));
    const operationIds = new Set(this.world.operations.map(operation => operation.id));

    const grantKeys = new Set<string>();
    this.grants = Object.freeze(input.grants.map(grant => {
      text(grant.role, "grant.role");
      text(grant.resourceKind, "grant.resourceKind");
      text(grant.evidenceRef, "grant.evidenceRef");
      if (!roleNames.has(grant.role)) throw new Error("Grant references an unknown role: " + grant.role);
      if (!actions.has(grant.action)) throw new Error("Grant references an unknown action: " + grant.action);
      if (!resourceKinds.has(grant.resourceKind)) throw new Error("Grant references an unknown resource kind: " + grant.resourceKind);
      if (!["allow", "deny"].includes(grant.effect)) throw new Error("Invalid permission effect");
      if (!Number.isFinite(grant.confidence) || grant.confidence < 0 || grant.confidence > 1) {
        throw new Error("Grant confidence must be between 0 and 1");
      }
      const key = [grant.role, grant.action, grant.resourceKind, grant.effect].join("|");
      if (grantKeys.has(key)) throw new Error("Duplicate role permission relationship: " + key);
      grantKeys.add(key);
      return Object.freeze({ ...grant });
    }));
    this.ownershipRules = Object.freeze(input.ownershipRules.map(rule => {
      text(rule.evidenceRef, "ownershipRule.evidenceRef");
      if (!operationIds.has(rule.operationId)) throw new Error("Ownership rule references an unknown operation");
      if (!["owner-only", "not-required", "unknown"].includes(rule.requirement)) {
        throw new Error("Invalid ownership requirement");
      }
      if (!Number.isFinite(rule.confidence) || rule.confidence < 0 || rule.confidence > 1) {
        throw new Error("Ownership confidence must be between 0 and 1");
      }
      return Object.freeze({ ...rule });
    }));
    if (new Set(this.ownershipRules.map(rule => rule.operationId)).size !== this.ownershipRules.length) {
      throw new Error("Only one ownership rule may be assigned to an operation");
    }
    this.routeBindings = Object.freeze(input.routeBindings.map(binding => {
      text(binding.evidenceRef, "routeBinding.evidenceRef");
      if (!operationIds.has(binding.operationId)) throw new Error("Route binding references an unknown operation");
      if (binding.path !== null && (typeof binding.path !== "string" || binding.path.length > 500)) {
        throw new Error("Route binding path is malformed");
      }
      if (!Array.isArray(binding.methods) || binding.methods.length > 8 ||
          !binding.methods.every(method => typeof method === "string" && method.length > 0 && method.length <= 16)) {
        throw new Error("Route binding methods are malformed");
      }
      return Object.freeze({ ...binding, methods: Object.freeze([...binding.methods]) });
    }));
    this.invariants = Object.freeze(input.invariants.map(invariant => {
      text(invariant.description, "authorizationInvariant.description");
      if (!["tenant-isolation", "owner-only-write"].includes(invariant.kind)) {
        throw new Error("Unsupported authorization invariant");
      }
      return Object.freeze({ ...invariant });
    }));
    // Keep the explicit ID set alive in validation logic to reject malformed
    // runtime arrays without trusting their static TypeScript declarations.
    if (grantIds.size !== this.grants.length || ownershipIds.size !== this.ownershipRules.length) {
      throw new Error("Authorization relationship identifiers are inconsistent");
    }
    Object.freeze(this);
  }
}

type Decision = "allow" | "deny" | "unknown";

function decide(
  model: AuthorizationRelationshipModel,
  operation: SecurityWorldModel["operations"][number],
  identity: SecurityWorldModel["identities"][number],
  resource: SecurityWorldModel["resources"][number]
): { decision: Decision; evidenceRefs: string[] } {
  const refs: string[] = [];
  const crossTenant = identity.tenantId !== resource.tenantId;
  const grants = model.grants.filter(grant =>
    grant.role === identity.role && grant.action === operation.action && grant.resourceKind === resource.kind
  );
  const deny = grants.find(grant => grant.effect === "deny");
  if (deny) return { decision: "deny", evidenceRefs: [deny.evidenceRef] };
  const allow = grants.find(grant => grant.effect === "allow");
  if (allow) refs.push(allow.evidenceRef);

  const ownership = model.ownershipRules.find(rule => rule.operationId === operation.id);
  if (ownership) {
    refs.push(ownership.evidenceRef);
    if (ownership.requirement === "owner-only" && resource.ownerIdentityId !== identity.id) {
      return { decision: "deny", evidenceRefs: refs };
    }
  }

  if (operation.residualAuthorization === "deny") {
    return { decision: "deny", evidenceRefs: refs };
  }
  if (crossTenant && operation.tenantIsolationGuard === "enforced") {
    return { decision: "deny", evidenceRefs: refs };
  }
  if (!allow && model.permissionInventory === "complete") {
    return { decision: "deny", evidenceRefs: refs };
  }
  if ((ownership?.requirement === "unknown") || (!ownership && model.ownershipInventory === "partial")) {
    return { decision: "unknown", evidenceRefs: refs };
  }
  if (operation.residualAuthorization === "unknown") {
    return { decision: "unknown", evidenceRefs: refs };
  }
  if (crossTenant && operation.tenantIsolationGuard === "unknown") {
    return { decision: "unknown", evidenceRefs: refs };
  }

  if (allow) return { decision: "allow", evidenceRefs: refs };
  if (model.permissionInventory === "complete") return { decision: "deny", evidenceRefs: refs };
  return { decision: "unknown", evidenceRefs: refs };
}

/** Exhaustively evaluates only the finite, supplied authorization model. */
export function checkAuthorizationRelationships(model: AuthorizationRelationshipModel): AuthorizationRelationshipCheck {
  if (model.invariants.length === 0) {
    return {
      status: "inconclusive", checkedPairs: 0, unknownPairs: 0, counterexamples: [],
      notes: ["No authorization invariant was supplied."],
      findingStatus: "unverified", authorized: false, executionPerformed: false
    };
  }
  const combinations = model.world.operations.length * model.world.identities.length * model.world.resources.length;
  if (combinations > 100_000) {
    return {
      status: "inconclusive", checkedPairs: 0, unknownPairs: 0, counterexamples: [],
      notes: ["Authorization state space exceeds the 100,000-combination POC limit."],
      findingStatus: "unverified", authorized: false, executionPerformed: false
    };
  }

  const counterexamples: AuthorizationCounterexample[] = [];
  let checkedPairs = 0;
  let unknownPairs = 0;
  let truncated = false;
  evaluation: for (const operation of model.world.operations) {
    for (const identity of model.world.identities) {
      for (const resource of model.world.resources) {
        const result = decide(model, operation, identity, resource);
        if (result.decision === "unknown") {
          unknownPairs += 1;
          continue;
        }
        checkedPairs += 1;
        if (result.decision !== "allow") continue;
        const routeRefs = model.routeBindings
          .filter(binding => binding.operationId === operation.id)
          .map(binding => binding.evidenceRef);
        const worldRefs = model.world.facts
          .filter(fact => [operation.id, identity.id, resource.id].includes(fact.subjectId))
          .map(fact => fact.evidenceRef);
        const evidenceRefs = Object.freeze([...new Set([...result.evidenceRefs, ...routeRefs, ...worldRefs])]);
        for (const invariant of model.invariants) {
          if (invariant.kind === "tenant-isolation" && identity.tenantId !== resource.tenantId) {
            counterexamples.push({
              invariantId: invariant.id, invariantKind: invariant.kind,
              operationId: operation.id, identityId: identity.id, resourceId: resource.id,
              actorRole: identity.role, resourceOwnerIdentityId: resource.ownerIdentityId,
              actorTenantId: identity.tenantId, resourceTenantId: resource.tenantId,
              predictedDecision: "allow", reason: "cross-tenant-allow", evidenceRefs
            });
            if (counterexamples.length >= MAX_COUNTEREXAMPLES) {
              truncated = true;
              break evaluation;
            }
          }
          if (invariant.kind === "owner-only-write" &&
              (operation.action === "write" || operation.action === "delete") &&
              resource.ownerIdentityId !== identity.id) {
            counterexamples.push({
              invariantId: invariant.id, invariantKind: invariant.kind,
              operationId: operation.id, identityId: identity.id, resourceId: resource.id,
              actorRole: identity.role, resourceOwnerIdentityId: resource.ownerIdentityId,
              actorTenantId: identity.tenantId, resourceTenantId: resource.tenantId,
              predictedDecision: "allow", reason: "non-owner-write-allow", evidenceRefs
            });
            if (counterexamples.length >= MAX_COUNTEREXAMPLES) {
              truncated = true;
              break evaluation;
            }
          }
        }
      }
    }
  }
  const status = counterexamples.length > 0
    ? "counterexample"
    : unknownPairs > 0 || checkedPairs === 0
      ? "inconclusive"
      : "no-counterexample";
  return {
    status, checkedPairs, unknownPairs, counterexamples,
    notes: [
      "Results describe only the supplied authorization relationship model; they are not observations of a live application.",
      "Explicit deny grants take precedence over allow grants.",
      ...(unknownPairs > 0 ? ["Incomplete inventories or unknown guards were not treated as secure or vulnerable."] : []),
      ...(truncated ? ["Counterexample output reached the 1,000-item cap; remaining states were not enumerated."] : []),
      "A no-counterexample result is bounded by the declared inventory completeness and modeled relationships."
    ],
    findingStatus: "unverified", authorized: false, executionPerformed: false
  };
}
