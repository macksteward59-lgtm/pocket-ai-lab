/**
 * Agent registry and task-scoped session lifecycle.
 */
export type AgentId = string;
export type Capability = string;

export interface AgentProfile {
  id: AgentId;
  role: string;
  description: string;
  capabilities: Capability[];
  modelPreference?: string;
  permanent: boolean;
  permissions: string[];
}

export interface AgentSession {
  agentId: AgentId;
  taskId: string;
  modelId: string;
  status: "idle" | "queued" | "running" | "reviewing" | "complete" | "released";
  createdAt: string;
}

export class AgentManager {
  private agents = new Map<AgentId, AgentProfile>();
  private sessions = new Map<string, AgentSession>();

  registerPermanent(profile: AgentProfile): void {
    if (!profile.id.trim()) throw new Error("Agent id is required");
    this.agents.set(profile.id, {
      ...profile,
      capabilities: [...profile.capabilities],
      permissions: [...profile.permissions],
      permanent: true
    });
  }

  createSpecialist(profile: Omit<AgentProfile, "permanent">): AgentId {
    const id = "specialist-" + crypto.randomUUID();
    this.agents.set(id, {
      ...profile,
      id,
      capabilities: [...profile.capabilities],
      permissions: [...profile.permissions],
      permanent: false
    });
    return id;
  }

  getAgent(id: AgentId): AgentProfile | undefined {
    const profile = this.agents.get(id);
    return profile ? {
      ...profile,
      capabilities: [...profile.capabilities],
      permissions: [...profile.permissions]
    } : undefined;
  }

  listPermanent(): AgentProfile[] {
    return Array.from(this.agents.values())
      .filter(agent => agent.permanent)
      .map(agent => this.getAgent(agent.id)!);
  }

  startSession(agentId: AgentId, taskId: string, modelId: string): string {
    if (!this.agents.has(agentId)) throw new Error("Cannot start session for unknown agent " + agentId);
    if (!taskId.trim() || !modelId.trim()) throw new Error("taskId and modelId are required");
    const sessionId = "sess-" + crypto.randomUUID();
    this.sessions.set(sessionId, {
      agentId, taskId, modelId, status: "queued", createdAt: new Date().toISOString()
    });
    return sessionId;
  }

  updateStatus(sessionId: string, status: AgentSession["status"]): void {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error("Unknown session " + sessionId);
    session.status = status;
  }

  releaseSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    session.status = "released";
    this.sessions.delete(sessionId);
    if (!this.agents.get(session.agentId)?.permanent) this.agents.delete(session.agentId);
  }

  /**
   * Removes a task-scoped specialist and any sessions it still holds.
   * Permanent agents are never removed.
   */
  releaseSpecialist(id: AgentId): boolean {
    const profile = this.agents.get(id);
    if (!profile || profile.permanent) return false;
    for (const [sessionId, session] of this.sessions) {
      if (session.agentId === id) this.sessions.delete(sessionId);
    }
    return this.agents.delete(id);
  }
}

export const CORE_AGENTS: AgentProfile[] = [
  { id: "director", role: "Director", description: "Delegation and synthesis", capabilities: ["orchestrate", "synthesize", "delegate"], permanent: true, permissions: ["assign", "synthesize"] },
  { id: "reasoner", role: "Reasoner", description: "Logical decomposition", capabilities: ["reason", "decompose"], permanent: true, permissions: ["analyze"] },
  { id: "researcher", role: "Researcher", description: "Information gathering", capabilities: ["research", "retrieve"], permanent: true, permissions: ["read"] },
  { id: "engineer", role: "Engineer", description: "Software development", capabilities: ["code", "debug", "implement"], permanent: true, permissions: ["write", "execute-lab"] },
  { id: "security", role: "Security Analyst", description: "Security and risk", capabilities: ["analyze-security", "exploitgym"], permanent: true, permissions: ["lab"] },
  { id: "critic", role: "Critic", description: "Challenge assumptions", capabilities: ["critique", "challenge"], permanent: true, permissions: ["review"] },
  { id: "validator", role: "Validator", description: "Independent verification", capabilities: ["validate", "test"], permanent: true, permissions: ["verify"] },
  { id: "archivist", role: "Archivist", description: "Knowledge and project continuity", capabilities: ["archive", "retrieve-knowledge"], permanent: true, permissions: ["read", "write-artifacts"] }
];

/**
 * Defensive research specialist templates.
 *
 * Not permanent. Registered on demand with the "lab" permission only.
 * This module defines no tool behavior and does not execute anything.
 * Tool requests still go through DelegationGate, which fails closed and
 * does not set `authorized`.
 */
export const SECURITY_SPECIALIST_TEMPLATES = {
  "microsoft-cloud": {
    role: "Microsoft Cloud Security Specialist",
    description: "Azure, ARM, Microsoft 365, and Entra ID configuration and posture review",
    capabilities: ["azure-arm", "entra-id-assessment", "m365-security"],
    permissions: ["lab"]
  },
  "identity-security": {
    role: "Identity and Authentication Specialist",
    description: "OAuth2, SAML, OIDC, and JWT architecture review",
    capabilities: ["oauth-analysis", "jwt-verification", "saml-assessment"],
    permissions: ["lab"]
  },
  "windows-internals": {
    role: "Windows Internals Specialist",
    description: "Windows process and token architecture research, read-only analysis only",
    capabilities: ["kernel-analysis", "token-architecture-research"],
    permissions: ["lab"]
  },
  "reverse-engineering": {
    role: "Reverse Engineering Specialist",
    description: "Static binary and assembly review inside the isolated lab",
    capabilities: ["binary-static-analysis", "assembly-review"],
    permissions: ["lab"]
  },
  "ai-security": {
    role: "AI Security Specialist",
    description: "Prompt-injection defense and RAG surface review",
    capabilities: ["prompt-injection-defense", "rag-leakage-prevention"],
    permissions: ["lab"]
  },
  "network-protocols": {
    role: "Network Protocol Specialist",
    description: "Protocol-conformance and TLS, Kerberos, and SMB configuration review",
    capabilities: ["protocol-conformance-review", "tls-fingerprinting"],
    permissions: ["lab"]
  }
} satisfies Record<string, Omit<AgentProfile, "id" | "permanent">>;

export type SecuritySpecialistId = keyof typeof SECURITY_SPECIALIST_TEMPLATES;

export const SECURITY_SPECIALIST_IDS = Object.keys(SECURITY_SPECIALIST_TEMPLATES) as SecuritySpecialistId[];
