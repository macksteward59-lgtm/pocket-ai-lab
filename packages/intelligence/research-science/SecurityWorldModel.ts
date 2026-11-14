import type { SecurityWorldModelInput } from "./types";

const MAX_ITEMS = 500;
const MAX_TEXT = 512;

function requireText(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > MAX_TEXT) {
    throw new Error(field + " must be a non-empty bounded string");
  }
  return value;
}

function requireUniqueIds(items: readonly { id: string }[], field: string): Set<string> {
  if (!Array.isArray(items) || items.length > MAX_ITEMS) {
    throw new Error(field + " must be an array with at most " + MAX_ITEMS + " entries");
  }
  const ids = new Set<string>();
  for (const item of items) {
    const id = requireText(item?.id, field + ".id");
    if (ids.has(id)) throw new Error("Duplicate " + field + " id: " + id);
    ids.add(id);
  }
  return ids;
}

/**
 * Immutable, validated application model. This is a research representation,
 * not a runtime connection or an authorization source.
 */
export class SecurityWorldModel {
  readonly id: string;
  readonly version: number;
  readonly components: readonly Readonly<SecurityWorldModelInput["components"][number]>[];
  readonly identities: readonly Readonly<SecurityWorldModelInput["identities"][number]>[];
  readonly resources: readonly Readonly<SecurityWorldModelInput["resources"][number]>[];
  readonly operations: readonly Readonly<SecurityWorldModelInput["operations"][number]>[];
  readonly invariants: readonly Readonly<SecurityWorldModelInput["invariants"][number]>[];
  readonly facts: readonly Readonly<SecurityWorldModelInput["facts"][number]>[];

  constructor(input: SecurityWorldModelInput) {
    if (!input || typeof input !== "object") throw new Error("World model input is required");
    this.id = requireText(input.id, "model.id");
    if (!Number.isSafeInteger(input.version) || input.version < 1) throw new Error("model.version must be a positive integer");

    const componentIds = requireUniqueIds(input.components, "components");
    const identityIds = requireUniqueIds(input.identities, "identities");
    const resourceIds = requireUniqueIds(input.resources, "resources");
    const operationIds = requireUniqueIds(input.operations, "operations");
    requireUniqueIds(input.invariants, "invariants");
    requireUniqueIds(input.facts, "facts");

    this.components = Object.freeze(input.components.map(item => {
      requireText(item.name, "component.name");
      if (!["api", "service", "database", "worker"].includes(item.kind)) throw new Error("Invalid component kind");
      return Object.freeze({ ...item });
    }));
    this.identities = Object.freeze(input.identities.map(item => {
      requireText(item.tenantId, "identity.tenantId");
      requireText(item.role, "identity.role");
      return Object.freeze({ ...item });
    }));
    this.resources = Object.freeze(input.resources.map(item => {
      requireText(item.tenantId, "resource.tenantId");
      requireText(item.kind, "resource.kind");
      if (!identityIds.has(item.ownerIdentityId)) throw new Error("Unknown resource owner: " + item.ownerIdentityId);
      return Object.freeze({ ...item });
    }));
    this.operations = Object.freeze(input.operations.map(item => {
      if (!componentIds.has(item.componentId)) throw new Error("Unknown operation component: " + item.componentId);
      if (!["read", "write", "delete"].includes(item.action)) throw new Error("Invalid operation action");
      if (!["enforced", "absent", "unknown"].includes(item.tenantIsolationGuard)) {
        throw new Error("Invalid tenant isolation guard state");
      }
      return Object.freeze({ ...item });
    }));
    this.invariants = Object.freeze(input.invariants.map(item => {
      requireText(item.description, "invariant.description");
      if (item.kind !== "tenant-isolation") throw new Error("Unsupported invariant kind");
      return Object.freeze({ ...item });
    }));
    this.facts = Object.freeze(input.facts.map(item => {
      requireText(item.predicate, "fact.predicate");
      requireText(item.value, "fact.value");
      requireText(item.evidenceRef, "fact.evidenceRef");
      if (![...componentIds, ...identityIds, ...resourceIds, ...operationIds].includes(item.subjectId)) {
        throw new Error("Unknown fact subject: " + item.subjectId);
      }
      if (!["synthetic-fixture", "source-analysis", "runtime-observation"].includes(item.origin)) {
        throw new Error("Invalid fact origin");
      }
      if (!Number.isFinite(item.confidence) || item.confidence < 0 || item.confidence > 1) {
        throw new Error("Fact confidence must be between 0 and 1");
      }
      return Object.freeze({ ...item });
    }));
    Object.freeze(this);
  }
}
