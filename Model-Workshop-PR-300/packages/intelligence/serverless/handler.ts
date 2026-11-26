/**
 * Transport-agnostic JSON API over injected security and expansion ports.
 * This module does not import those implementations, does not listen, and
 * does not execute tools. Platform adapters translate a real
 * request (Node http, Fetch API, Lambda event) into GenericRequest, call
 * this, and translate GenericResponse back. No business logic lives in an
 * adapter; all of it lives here so it behaves identically on every platform.
 *
 * Routes:
 *   GET  /health
 *   POST /security/assemble    { taskId, description, approvalRef? }
 *   POST /security/release     { taskId }
 *   POST /security/tool-use    { taskId, agentId, tool, scopeRef, voucher?, toolApprovalRef? }
 *   POST /director/expand-team { taskId, description, requestedTeamSize, approvalRef? }
 */
import type { AgencyExpansionPort, AgencySecurityPort, GenericRequest, GenericResponse, Handler } from "./types";
import type { RateLimitStore } from "./rateLimitStore";
import { InMemoryRateLimitStore } from "./rateLimitStore";

export interface CreateHandlerOptions {
  security: AgencySecurityPort;
  expansionPlanner?: AgencyExpansionPort;
  rateLimitStore?: RateLimitStore;
  /** Requests per window per client per route group. */
  limits?: { security: number; director: number; windowMs: number };
  maxBodyBytes?: number;
}

const DEFAULT_LIMITS = { security: 30, director: 10, windowMs: 60_000 };

function json(status: number, body: unknown): GenericResponse {
  return { status, headers: { "content-type": "application/json" }, body };
}

function badRequest(message: string): GenericResponse {
  return json(400, { error: message });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

export function createAgencyHandler(opts: CreateHandlerOptions): Handler {
  const store = opts.rateLimitStore ?? new InMemoryRateLimitStore();
  const limits = { ...DEFAULT_LIMITS, ...opts.limits };
  const maxBodyBytes = opts.maxBodyBytes ?? 64 * 1024;

  return async function handle(req: GenericRequest): Promise<GenericResponse> {
    if (req.method === "GET" && req.path === "/health") {
      return json(200, { status: "ok" });
    }

    const bodySize = req.body === undefined ? 0 : JSON.stringify(req.body).length;
    if (bodySize > maxBodyBytes) return json(413, { error: "Request body too large" });

    if (req.method !== "POST") return json(404, { error: "Not found" });

    const group = req.path.startsWith("/director/") ? "director" : "security";
    const limited = await store.take(group + ":" + (req.clientKey || "unknown"), limits[group], limits.windowMs);
    if (!limited.allowed) {
      return { status: 429, headers: { "retry-after": String(limited.retryAfterSeconds ?? 60) }, body: { error: "Rate limited" } };
    }

    const body = isPlainObject(req.body) ? req.body : {};

    switch (req.path) {
      case "/security/assemble": {
        const taskId = asNonEmptyString(body.taskId);
        const description = asNonEmptyString(body.description);
        if (!taskId || !description) return badRequest("taskId and description are required");
        try {
          const team = await opts.security.assemble(taskId, description, { approvalRef: asNonEmptyString(body.approvalRef) });
          return json(200, {
            taskId: team.taskId,
            useCoreSecurityAgent: team.useCoreSecurityAgent,
            members: team.members.map(m => ({ templateId: m.templateId, agentId: m.agentId, skills: m.skills }))
          });
        } catch (err) {
          return json(403, { error: (err as Error).message });
        }
      }

      case "/security/release": {
        const taskId = asNonEmptyString(body.taskId);
        if (!taskId) return badRequest("taskId is required");
        opts.security.releaseTask(taskId);
        return json(200, { released: taskId });
      }

      case "/security/tool-use": {
        const taskId = asNonEmptyString(body.taskId);
        const agentId = asNonEmptyString(body.agentId);
        const tool = asNonEmptyString(body.tool);
        const scopeRef = asNonEmptyString(body.scopeRef);
        if (!taskId || !agentId || !tool || !scopeRef) {
          return badRequest("taskId, agentId, tool, and scopeRef are required");
        }
        // The handler has no access to live SecurityTeam objects across requests by design
        // (they are not serializable session state); this endpoint is a thin wrapper a host
        // can extend once it has its own task/team lookup. Left unimplemented on purpose
        // rather than faked.
        return json(501, { error: "tool-use requires a host-side task/team lookup; not implemented in this generic handler" });
      }

      case "/director/expand-team": {
        if (!opts.expansionPlanner) return json(501, { error: "Team expansion is not configured for this deployment" });
        const taskId = asNonEmptyString(body.taskId);
        const description = asNonEmptyString(body.description);
        const requestedTeamSize = body.requestedTeamSize;
        if (!taskId || !description || typeof requestedTeamSize !== "number") {
          return badRequest("taskId, description, and requestedTeamSize are required");
        }
        try {
          const team = await opts.expansionPlanner.expandTeam({
            taskId, taskDescription: description, requestedTeamSize,
            approvalRef: asNonEmptyString(body.approvalRef)
          });
          return json(200, {
            taskId: team.taskId,
            grantedTeamSize: team.members.length,
            members: team.members.map(m => ({ templateId: m.templateId, agentId: m.agentId }))
          });
        } catch (err) {
          return json(403, { error: (err as Error).message });
        }
      }

      default:
        return json(404, { error: "Not found" });
    }
  };
}
