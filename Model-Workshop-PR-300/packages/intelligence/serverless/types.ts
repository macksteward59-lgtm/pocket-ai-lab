/** Transport-agnostic request/response shapes shared by every adapter in this folder. */
export interface GenericRequest {
  method: string;
  path: string;
  headers: Record<string, string>;
  query: Record<string, string>;
  /** Already-parsed JSON body, or undefined if there was none / it wasn't JSON. */
  body: unknown;
  /** Best-effort client identifier for rate limiting (IP, or a platform-specific id). May be empty. */
  clientKey: string;
}

export interface GenericResponse {
  status: number;
  headers?: Record<string, string>;
  body: unknown;
}

export type Handler = (req: GenericRequest) => Promise<GenericResponse>;

/**
 * Structural port for a security division. This package does not import one
 * and does not execute tools. `assemble` may throw to refuse a task.
 */
export interface AgencySecurityPort {
  assemble(
    taskId: string,
    description: string,
    options?: { approvalRef?: string }
  ): Promise<{
    taskId: string;
    useCoreSecurityAgent: boolean;
    members: Array<{ templateId: string; agentId: string; skills: string[] }>;
  }>;
  releaseTask(taskId: string): void;
}

/** Structural port for a team-expansion planner. Throws to deny. */
export interface AgencyExpansionPort {
  expandTeam(request: {
    taskId: string;
    taskDescription: string;
    requestedTeamSize: number;
    approvalRef?: string;
  }): Promise<{
    taskId: string;
    members: Array<{ templateId: string; agentId: string }>;
  }>;
}
