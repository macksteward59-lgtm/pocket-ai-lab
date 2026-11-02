/**
 * Pocket AI Lab — Multi-Agent Intelligence Engine
 * Agent Manager
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
    this.agents.set(profile.id, { ...profile, permanent: true });
  }

  createSpecialist(profile: Omit<AgentProfile, "permanent">): AgentId {
    const id = `specialist-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.agents.set(id, { ...profile, id, permanent: false });
    return id;
  }

  getAgent(id: AgentId): AgentProfile | undefined {
    return this.agents.get(id);
  }

  listPermanent(): AgentProfile[] {
    return Array.from(this.agents.values()).filter(a => a.permanent);
  }

  startSession(agentId: AgentId, taskId: string, modelId: string): string {
    const sessionId = `sess-${Date.now()}`;
    this.sessions.set(sessionId, {
      agentId,
      taskId,
      modelId,
      status: "queued",
      createdAt: new Date().toISOString()
    });
    return sessionId;
  }

  updateStatus(sessionId: string, status: AgentSession["status"]): void {
    const s = this.sessions.get(sessionId);
    if (s) s.status = status;
  }

  releaseSession(sessionId: string): void {
    const s = this.sessions.get(sessionId);
    if (s && !this.agents.get(s.agentId)?.permanent) {
      this.agents.delete(s.agentId);
    }
    this.sessions.delete(sessionId);
  }
}

// Default permanent core team
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
