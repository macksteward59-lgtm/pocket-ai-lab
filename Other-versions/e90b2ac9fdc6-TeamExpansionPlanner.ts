/**
 * Team expansion: lets the Director ask for a bigger team on a hard task.
 *
 * This is deliberately NOT self-improvement. It cannot create a capability,
 * skill, specialist, or tool that is not already a constant in this codebase
 * (SECURITY_SPECIALIST_TEMPLATES / SKILL_CATALOG / TOOL_CATALOG / CORE_AGENTS).
 * There is no method here that defines a new agent type, writes a new
 * template, or changes what any agent is allowed to do. "Bigger team" means
 * more instances of already-defined specialists, up to a fixed ceiling that
 * this class cannot raise. Any request to exceed the DEFAULT team size needs
 * a verified human approval; there is no path that proceeds without one.
 */
import type { SecuritySpecialistId } from "./AgentManager";
import { SecurityDivision, type ApprovalVerifier, type SecurityTeam } from "../security/SecurityDivision";
import type { RouteOptions } from "../security/routing";

/** Hard ceiling. Not configurable upward by any caller, including the Director itself. */
export const ABSOLUTE_MAX_TEAM_SIZE = 6; // one per specialist template; there are only six.
export const DEFAULT_TEAM_SIZE = 3;

export interface ExpandTeamRequest {
  taskId: string;
  taskDescription: string;
  /** Must be between 1 and ABSOLUTE_MAX_TEAM_SIZE. Anything above DEFAULT_TEAM_SIZE needs approvalRef. */
  requestedTeamSize: number;
  /** Required only when requestedTeamSize > DEFAULT_TEAM_SIZE. */
  approvalRef?: string;
  routeOptions?: Omit<RouteOptions, "maxSpecialists">;
}

export interface TeamExpansionLogEntry {
  at: string;
  taskId: string;
  requestedTeamSize: number;
  grantedTeamSize: number;
  approved: boolean;
}

export class TeamExpansionDenied extends Error {}

export class TeamExpansionPlanner {
  private readonly division: SecurityDivision;
  private readonly approvalVerifier?: ApprovalVerifier;
  private readonly log: TeamExpansionLogEntry[] = [];

  constructor(opts: { division: SecurityDivision; approvalVerifier?: ApprovalVerifier }) {
    this.division = opts.division;
    this.approvalVerifier = opts.approvalVerifier;
  }

  /**
   * Assembles a team of already-defined specialists, sized within the fixed
   * ceiling. Never defines a new capability; only ever selects among
   * SECURITY_SPECIALIST_TEMPLATES via SecurityDivision/routeSecurityTask.
   */
  async expandTeam(request: ExpandTeamRequest): Promise<SecurityTeam> {
    const size = request.requestedTeamSize;
    if (!Number.isInteger(size) || size < 1) {
      throw new TeamExpansionDenied("requestedTeamSize must be a positive integer");
    }
    if (size > ABSOLUTE_MAX_TEAM_SIZE) {
      throw new TeamExpansionDenied(
        `Requested team size ${size} exceeds the fixed ceiling of ${ABSOLUTE_MAX_TEAM_SIZE}; ` +
        "this ceiling cannot be raised by any caller, including the Director"
      );
    }

    let approved = size <= DEFAULT_TEAM_SIZE;
    if (!approved) {
      approved = await this.isApproved(request.taskId, request.approvalRef);
      if (!approved) {
        this.record(request.taskId, size, 0, false);
        throw new TeamExpansionDenied(
          `Expanding beyond the default team size (${DEFAULT_TEAM_SIZE}) to ${size} requires a verified human approval`
        );
      }
    }

    const team = await this.division.assemble(request.taskId, request.taskDescription, {
      approvalRef: request.approvalRef,
      route: { ...request.routeOptions, maxSpecialists: size }
    });
    this.record(request.taskId, size, team.members.length, true);
    return team;
  }

  /** Every specialist id that could ever appear on an expanded team. Fixed; not writable at runtime. */
  possibleSpecialists(): SecuritySpecialistId[] {
    return ["microsoft-cloud", "identity-security", "windows-internals", "reverse-engineering", "ai-security", "network-protocols"];
  }

  getLog(): TeamExpansionLogEntry[] {
    return this.log.map(entry => ({ ...entry }));
  }

  private record(taskId: string, requestedTeamSize: number, grantedTeamSize: number, approved: boolean): void {
    this.log.push({ at: new Date().toISOString(), taskId, requestedTeamSize, grantedTeamSize, approved });
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
