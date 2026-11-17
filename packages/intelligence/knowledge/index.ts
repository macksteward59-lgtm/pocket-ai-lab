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
    revisionPolicy: string;
  };
  sources: OwaspKnowledgeSource[];
  routingRules: OwaspRoutingRule[];
  invariants: string[];
}

export const OWASP_KNOWLEDGE_CATALOG = catalog as OwaspCatalog;

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
  return getOwaspSource(sourceId)?.trust === "untrusted-reference";
}
