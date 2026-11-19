import { deepFreeze, OWASP_KNOWLEDGE_CATALOG, type KnowledgeAgentId } from "./index";

export type OwaspGuidanceControl = {
  id: string;
  sourceId: string;
  title: string;
  summary: string;
  controls: string[];
  validation: string[];
  agents: KnowledgeAgentId[];
};

/**
 * Curated, concise guidance notes derived from the cited OWASP Cheat Sheets.
 * These notes are untrusted reference material, not policy or tool permissions.
 * Each item points back to an exact source entry in the versioned catalog.
 */
export const OWASP_GUIDANCE: readonly OwaspGuidanceControl[] = deepFreeze<OwaspGuidanceControl[]>([
  {
    id: "AGENT-TOOL-BOUNDARY",
    sourceId: "OWASP-AI-AGENT",
    title: "Agent tool least privilege and approvals",
    summary: "An agent's proposal is not authorization. Enforce tool permissions outside model context and require approval for consequential actions.",
    controls: [
      "Grant only task-required tools and resource scopes.",
      "Enforce authorization in the trusted execution boundary.",
      "Bind approval to actor, tool, target, normalized parameters, expiry, and one-time use.",
      "Revalidate and consume approval immediately before execution.",
      "Bound tool calls, delegation, retries, and resource budgets."
    ],
    validation: [
      "Model-generated approval flags cannot authorize a tool.",
      "Approval replay and parameter substitution are rejected.",
      "Unknown tools and policy lookup failures fail closed."
    ],
    agents: ["director", "engineer", "security-analyst", "critic", "validator"]
  },
  {
    id: "PROMPT-INJECTION-BOUNDARY",
    sourceId: "OWASP-LLM-PROMPT-INJECTION",
    title: "Direct and indirect prompt injection",
    summary: "Retrieved and user-controlled content remains untrusted data even when it is summarized, quoted, or returned by a tool.",
    controls: [
      "Treat files, web pages, repository content, tool output, and user input as untrusted.",
      "Do not let retrieved content change system policy, grant tools, or directly trigger privileged actions.",
      "Validate proposed tool calls at the execution boundary.",
      "Test hidden, encoded, multilingual, multimodal, multi-turn, and RAG-poisoning variants."
    ],
    validation: [
      "Injected instructions in retrieved text cannot override policy.",
      "Tool-returned text cannot silently trigger a privileged follow-up call.",
      "Untrusted content does not become trusted merely by summarization."
    ],
    agents: ["researcher", "reasoner", "security-analyst", "engineer", "critic", "validator"]
  },
  {
    id: "MCP-TOOL-SERVER-BOUNDARY",
    sourceId: "OWASP-MCP-SECURITY",
    title: "Tool and remote-server boundary",
    summary: "Tool schemas, tool servers, transport, and remote responses require independent validation and least-privilege isolation.",
    controls: [
      "Validate tool input and output against schemas.",
      "Authenticate remote services and validate transport.",
      "Isolate tool servers and scope their credentials.",
      "Treat tool descriptions and outputs as untrusted content.",
      "Protect message integrity and reject replay where applicable."
    ],
    validation: [
      "A signed or authenticated request for an unauthorized action is denied.",
      "Malformed tool output is rejected before it enters trusted workflow state.",
      "Tool server credentials cannot access unrelated resources."
    ],
    agents: ["director", "engineer", "security-analyst", "critic", "validator"]
  },
  {
    id: "EXECUTION-EVIDENCE-REVIEW",
    sourceId: "OWASP-AGENT-EVIDENCE",
    title: "Evaluate third-party agent execution evidence",
    summary: "A record can be authentic as an assertion without independently proving the asserted execution.",
    controls: [
      "Identify who can write or alter the record.",
      "Determine what timestamps and artifact identifiers actually establish.",
      "Assess whether omitted events would be detectable.",
      "Make recording and delivery failures explicit.",
      "Use verification material not exclusively controlled by the party making the claim."
    ],
    validation: [
      "Supplier assertions are labeled separately from independently re-checkable evidence.",
      "Incomplete logs are not interpreted as proof of clean execution.",
      "A reviewer can verify evidence without holding the signing key."
    ],
    agents: ["director", "security-analyst", "engineer", "critic", "validator", "archivist"]
  },
  {
    id: "THREAT-MODEL-LIFECYCLE",
    sourceId: "OWASP-THREAT-MODELING",
    title: "Living threat model",
    summary: "Threat modeling should evolve with system components, trust boundaries, entry points, data flows, mitigations, and residual risks.",
    controls: [
      "Document assets, actors, components, entry points, data flows, and trust boundaries.",
      "Record threats, mitigations, assumptions, and residual risk.",
      "Revisit the model when agents, tools, memory, bridges, providers, or evidence contracts change.",
      "Verify mitigations in production paths rather than relying on design statements."
    ],
    validation: [
      "Security-sensitive architecture changes trigger threat-model review.",
      "Each claimed mitigation maps to an implementation location and test."
    ],
    agents: ["researcher", "security-analyst", "engineer", "critic", "validator"]
  },
  {
    id: "SECRET-LIFECYCLE",
    sourceId: "OWASP-SECRETS-MANAGEMENT",
    title: "Secret lifecycle and handling",
    summary: "Secrets require controlled creation, storage, access, rotation, auditing, and revocation across local and cloud components.",
    controls: [
      "Keep credentials out of source code, prompts, logs, and application bundles.",
      "Use scoped, revocable credentials and platform secure storage.",
      "Limit secret access to the component that needs it.",
      "Define rotation, revocation, and incident response procedures.",
      "Avoid persisting raw secrets in agent memory."
    ],
    validation: [
      "Repository and build artifacts are scanned for accidental credentials.",
      "Logs and memory writes redact or reject secret-like values.",
      "Revoked credentials are no longer accepted."
    ],
    agents: ["engineer", "security-analyst", "validator"]
  },
  {
    id: "OAUTH-NATIVE-CLIENT",
    sourceId: "OWASP-OAUTH2",
    title: "OAuth native client and token protection",
    summary: "Native public clients should use Authorization Code with PKCE and narrowly scoped, appropriately protected tokens.",
    controls: [
      "Use Authorization Code with PKCE for public native clients.",
      "Validate redirect targets and avoid open redirectors.",
      "Restrict token audience and privileges.",
      "Protect refresh tokens with provider-supported rotation or sender constraints.",
      "Keep tokens out of model context, logs, and app bundles."
    ],
    validation: [
      "Invalid redirect targets are rejected.",
      "Tokens for the wrong audience or revoked sessions are rejected.",
      "Sensitive tokens do not appear in logs or model prompts."
    ],
    agents: ["engineer", "security-analyst", "validator"]
  },
  {
    id: "IOS-APP-SECURITY",
    sourceId: "OWASP-MOBILE-APP",
    title: "Mobile application security foundations",
    summary: "Client-side controls are not an authorization boundary; protect local data, transport, app entry points, and sensitive UI surfaces.",
    controls: [
      "Enforce authorization at service and trusted execution boundaries, not only in UI.",
      "Use platform secure storage and protected cryptographic keys.",
      "Reject invalid transport certificates.",
      "Minimize sensitive data in logs, caches, snapshots, and notifications.",
      "Protect deep links and automation entry points for sensitive actions."
    ],
    validation: [
      "Sensitive app entry points require appropriate authentication.",
      "Secrets are absent from app bundles, logs, and snapshots.",
      "Transport validation cannot be bypassed."
    ],
    agents: ["engineer", "security-analyst", "ios-specialist", "critic", "validator"]
  }
]);

const catalogIds = new Set(OWASP_KNOWLEDGE_CATALOG.sources.map(source => source.id));

export function getOwaspGuidanceForAgent(agentId: KnowledgeAgentId): OwaspGuidanceControl[] {
  return OWASP_GUIDANCE.filter(item => item.agents.includes(agentId) && catalogIds.has(item.sourceId));
}

export function getOwaspGuidanceForSource(sourceId: string): OwaspGuidanceControl[] {
  return OWASP_GUIDANCE.filter(item => item.sourceId === sourceId && catalogIds.has(item.sourceId));
}

export function getOwaspGuidanceForTopics(topics: readonly string[]): OwaspGuidanceControl[] {
  const requested = new Set(topics);
  const sourceIds = new Set(
    OWASP_KNOWLEDGE_CATALOG.sources
      .filter(source => source.topics.some(topic => requested.has(topic)))
      .map(source => source.id)
  );
  return OWASP_GUIDANCE.filter(item => sourceIds.has(item.sourceId));
}

/** Unknown or missing source IDs are untrusted by default. */
export function getOwaspGuidanceTrust(sourceId: string): "untrusted-reference" {
  void sourceId;
  return "untrusted-reference";
}
