/**
 * Security division: assembles a task-scoped team of specialist agents and
 * routes every tool request through the delegation gate.
 *
 * What this layer does NOT do: execute tools, grant permissions, or validate
 * scope. Specialists are registered as non-permanent agents with the "lab"
 * permission only; tool use is decided by DelegationGate, and operational
 * tasks are refused unless an injected ApprovalVerifier confirms a human
 * approval. With no verifier configured, operational tasks are always refused.
 */
import { AgentManager, SECURITY_SPECIALIST_TEMPLATES, type SecuritySpecialistId } from "../agents/AgentManager";
import { routeSecurityTask, type RouteOptions, type SecurityRoute } from "./routing";
import { DelegationGate, type DelegationDecision, type DelegationVoucher } from "./delegation";
import { ToolRegistry } from "./tools";
import { SkillRegistry } from "../skills/SkillRegistry";
import { createDefaultSkillRegistry } from "../skills/catalog";

export interface ApprovalVerifier {
  /** True only if `approvalRef` is a valid human approval for this task. */
  verify(taskId: string, approvalRef: string): boolean | Promise<boolean>;
}

export interface SecurityTeamMember {
  templateId: SecuritySpecialistId;
  agentId: string;
  /** Skill ids this specialist template holds, from the injected SkillRegistry. Informational only. */
  skills: string[];
}

export interface SecurityTeam {
  taskId: string;
  route: SecurityRoute;
  members: SecurityTeamMember[];
  /** True when no specialist matched; use the permanent "security" core agent instead. */
  useCoreSecurityAgent: boolean;
  /** Removes this team's specialists. Safe to call more than once. */
  release(): void;
}

export interface AssembleOptions {
  /** Reference to a human approval; required for operational-intent tasks. */
  approvalRef?: string;
  route?: RouteOptions;
}

export class SecurityDivision {
  private readonly agents: AgentManager;
  private readonly gate: DelegationGate;
  private readonly approvalVerifier?: ApprovalVerifier;
  private readonly maxTeamSize: number;
  /** taskId -> specialist agent ids still active for that task. */
  private readonly active = new Map<string, Set<string>>();

  private readonly tools: ToolRegistry;
  private readonly skills: SkillRegistry;

  constructor(opts: {
    agents: AgentManager;
    gate: DelegationGate;
    approvalVerifier?: ApprovalVerifier;
    /** Hard cap on specialists per task. Default 3. */
    maxTeamSize?: number;
    /** Defaults to the built-in tool catalog (see security/tools.ts). */
    toolRegistry?: ToolRegistry;
    /** Defaults to the built-in Layer 1-5 skill catalog (see skills/catalog.ts). */
    skillRegistry?: SkillRegistry;
  }) {
    this.agents = opts.agents;
    this.gate = opts.gate;
    this.approvalVerifier = opts.approvalVerifier;
    this.maxTeamSize = Math.max(1, opts.maxTeamSize ?? 3);
    this.tools = opts.toolRegistry ?? new ToolRegistry();
    this.skills = opts.skillRegistry ?? createDefaultSkillRegistry();
  }

  /** Route only; creates nothing. */
  plan(taskDescription: string, route?: RouteOptions): SecurityRoute {
    return routeSecurityTask(taskDescription, { ...route, maxSpecialists: Math.min(route?.maxSpecialists ?? this.maxTeamSize, this.maxTeamSize) });
  }

  async assemble(taskId: string, taskDescription: string, options: AssembleOptions = {}): Promise<SecurityTeam> {
    if (!taskId?.trim()) throw new Error("taskId is required");
    const route = this.plan(taskDescription, options.route);

    if (route.intent === "operational") {
      const approved = await this.isApproved(taskId, options.approvalRef);
      if (!approved) {
        throw new Error(
          "Operational security task requires verified human approval (signals: " + route.operationalSignals.join(", ") + ")"
        );
      }
    }

    const members: SecurityTeamMember[] = route.matches.map(match => ({
      templateId: match.id,
      agentId: this.agents.createSpecialist({ id: match.id, ...SECURITY_SPECIALIST_TEMPLATES[match.id] }),
      skills: this.skills.skillIdsFor(match.id)
    }));

    const ids = this.active.get(taskId) ?? new Set<string>();
    members.forEach(member => ids.add(member.agentId));
    this.active.set(taskId, ids);

    let released = false;
    return {
      taskId,
      route,
      members,
      useCoreSecurityAgent: route.fallbackToCore,
      release: () => {
        if (released) return;
        released = true;
        members.forEach(member => this.releaseMember(taskId, member.agentId));
      }
    };
  }

  /**
   * Decides (never executes) whether a team member may use a tool.
   *
   * Three independent checks, each able to deny on its own: (1) the agent is
   * an active member of this task's team, (2) the tool registry allows this
   * specialist to even request this tool, and (3) for an "active" tool (one
   * that touches live systems or runs arbitrary code), a human approval for
   * THIS specific tool use verifies -- declaring a tool available never
   * substitutes for that. Only after all three pass does the delegation gate
   * decide on the voucher itself.
   */
  async requestToolUse(
    team: SecurityTeam,
    agentId: string,
    tool: string,
    scopeRef: string,
    voucher?: DelegationVoucher,
    toolApprovalRef?: string
  ): Promise<DelegationDecision> {
    const request = { agentId, taskId: team.taskId, tool, scopeRef };
    const member = team.members.find(m => m.agentId === agentId);
    const stillActive = this.active.get(team.taskId)?.has(agentId) === true;
    if (!member || !stillActive || !this.agents.getAgent(agentId)) {
      return this.gate.recordDenial(request, "Agent is not an active member of this task's security team");
    }

    const descriptor = this.tools.get(tool);
    if (!descriptor) {
      return this.gate.recordDenial(request, "Unknown tool: " + tool);
    }
    if (!this.tools.mayRequest(member.templateId, tool)) {
      return this.gate.recordDenial(request, member.templateId + " may not request " + tool);
    }
    if (!this.tools.isAvailable(tool)) {
      return this.gate.recordDenial(request, "Tool is not installed or available: " + tool);
    }

    if (descriptor.mode === "active") {
      const approved = await this.isApproved(team.taskId, toolApprovalRef);
      if (!approved) {
        return this.gate.recordDenial(
          request,
          "Active tool " + tool + " requires a verified human approval for this specific use"
        );
      }
    }

    return this.gate.authorize(request, voucher);
  }

  /** Releases every specialist still active for a task (e.g. on task failure). */
  releaseTask(taskId: string): void {
    const ids = this.active.get(taskId);
    if (!ids) return;
    [...ids].forEach(agentId => this.releaseMember(taskId, agentId));
  }

  activeSpecialistCount(): number {
    let total = 0;
    this.active.forEach(ids => { total += ids.size; });
    return total;
  }

  private releaseMember(taskId: string, agentId: string): void {
    this.agents.releaseSpecialist(agentId);
    const ids = this.active.get(taskId);
    if (!ids) return;
    ids.delete(agentId);
    if (ids.size === 0) this.active.delete(taskId);
  }

  private async isApproved(taskId: string, approvalRef?: string): Promise<boolean> {
    if (!this.approvalVerifier || !approvalRef?.trim()) return false;
    try {
      return (await this.approvalVerifier.verify(taskId, approvalRef)) === true;
    } catch {
      return false;
    }
  }
}
