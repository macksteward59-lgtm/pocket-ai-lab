import catalog from "./owaspSources.json";

export type KnowledgeAgentId =
  | "director"
  | "reasoner"
  | "researcher"
  | "engineer"
  | "security-analyst"
  | "critic"
  | "validator"
  | "archivist"
  | "ios-specialist";

export interface OwaspKnowledgeSource {
  id: string;
  path: string;
  url: string;
  blobSha: string;
  topics: string[];
  agents: KnowledgeAgentId[];
  packs: string[];
  trust: "untrusted-reference";
}

export interface OwaspRoutingRule {
  when: string;
  include: string[];
}

interface OwaspCatalog {
  schemaVersion: number;
  catalogId: string;
  description: string;
  repository: {
    name: string;
    url: string;
    branch: string;
    revision: string;
    revisionPolicy: string;
    license: {
      spdx: string;
      url: string;
      attribution: string;
    };
  };
  sources: OwaspKnowledgeSource[];
  routingRules: OwaspRoutingRule[];
  invariants: string[];
}

/** Freeze imported reference data recursively so consumers cannot mutate provenance or trust labels. */
export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value as Record<string, unknown>)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
  }
  return value;
}

export const OWASP_KNOWLEDGE_CATALOG = deepFreeze(catalog as unknown as OwaspCatalog);

export function getOwaspSource(sourceId: string): OwaspKnowledgeSource | undefined {
  return OWASP_KNOWLEDGE_CATALOG.sources.find(source => source.id === sourceId);
}

export function getOwaspSourcesForAgent(agentId: KnowledgeAgentId): OwaspKnowledgeSource[] {
  return OWASP_KNOWLEDGE_CATALOG.sources.filter(source => source.agents.includes(agentId));
}

export function getOwaspSourcesForPack(packId: string): OwaspKnowledgeSource[] {
  return OWASP_KNOWLEDGE_CATALOG.sources.filter(source => source.packs.includes(packId));
}

export function getOwaspSourcesForTopics(topics: readonly string[]): OwaspKnowledgeSource[] {
  const requested = new Set(topics);
  return OWASP_KNOWLEDGE_CATALOG.sources.filter(source =>
    source.topics.some(topic => requested.has(topic))
  );
}

/**
 * This catalog routes reference material only. It must never be used as a
 * tool allowlist, permission grant, APEX decision, or execution receipt.
 */
export function isOwaspReferenceUntrusted(sourceId: string): boolean {
  // Unknown sources fail closed: they are not eligible to be treated as trusted.
  const source = getOwaspSource(sourceId);
  return !source || source.trust === "untrusted-reference";
}
