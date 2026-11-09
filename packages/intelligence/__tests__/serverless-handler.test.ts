import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createAgencyHandler } from "../serverless/handler";
import { InMemoryRateLimitStore } from "../serverless/rateLimitStore";
import type { AgencyExpansionPort, AgencySecurityPort, GenericRequest } from "../serverless/types";

function security(over: Partial<AgencySecurityPort> = {}): AgencySecurityPort {
  return {
    assemble: async (taskId) => ({
      taskId,
      useCoreSecurityAgent: false,
      members: [{ templateId: "identity-security", agentId: "specialist-1", skills: ["jwt-verification"] }]
    }),
    releaseTask: () => undefined,
    ...over
  };
}

function req(over: Partial<GenericRequest>): GenericRequest {
  return { method: "GET", path: "/", headers: {}, query: {}, body: undefined, clientKey: "client-1", ...over };
}

describe("createAgencyHandler", () => {
  it("answers /health without touching rate limits", async () => {
    const handler = createAgencyHandler({ security: security() });
    const res = await handler(req({ method: "GET", path: "/health" }));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });

  it("404s unknown paths and non-POST on known paths", async () => {
    const handler = createAgencyHandler({ security: security() });
    expect((await handler(req({ method: "POST", path: "/nope" }))).status).toBe(404);
    expect((await handler(req({ method: "GET", path: "/security/assemble" }))).status).toBe(404);
  });

  it("assembles through the injected port and validates required fields", async () => {
    const handler = createAgencyHandler({ security: security() });
    const missing = await handler(req({ method: "POST", path: "/security/assemble", body: {} }));
    expect(missing.status).toBe(400);

    const ok = await handler(req({
      method: "POST", path: "/security/assemble",
      body: { taskId: "t1", description: "Review our Entra ID conditional access policy" }
    }));
    expect(ok.status).toBe(200);
    expect((ok.body as { members: unknown[] }).members).toHaveLength(1);
    expect(ok.body).not.toHaveProperty("authorized");
  });

  it("returns 403 when the security port refuses, and does not invent a team", async () => {
    const handler = createAgencyHandler({
      security: security({
        assemble: async () => { throw new Error("Operational security task requires verified human approval"); }
      })
    });
    const res = await handler(req({
      method: "POST", path: "/security/assemble",
      body: { taskId: "t1", description: "exploit the host" }
    }));
    expect(res.status).toBe(403);
    expect((res.body as { error: string }).error).toMatch(/human approval/);
  });

  it("releases a task through the port", async () => {
    const released: string[] = [];
    const handler = createAgencyHandler({
      security: security({ releaseTask: (taskId) => { released.push(taskId); } })
    });
    const res = await handler(req({ method: "POST", path: "/security/release", body: { taskId: "t1" } }));
    expect(res.status).toBe(200);
    expect(released).toEqual(["t1"]);
  });

  it("501s the generic tool-use endpoint rather than executing a tool", async () => {
    const handler = createAgencyHandler({ security: security() });
    const res = await handler(req({
      method: "POST", path: "/security/tool-use",
      body: { taskId: "t1", agentId: "a1", tool: "ghidra", scopeRef: "s1", voucher: { signature: "valid" } }
    }));
    expect(res.status).toBe(501);
  });

  it("501s /director/expand-team when no planner is configured", async () => {
    const handler = createAgencyHandler({ security: security() });
    const res = await handler(req({
      method: "POST", path: "/director/expand-team",
      body: { taskId: "t1", description: "x", requestedTeamSize: 1 }
    }));
    expect(res.status).toBe(501);
  });

  it("expands through an injected planner and surfaces a denial as 403", async () => {
    const planner: AgencyExpansionPort = {
      expandTeam: async (request) => {
        if (request.requestedTeamSize > 6) throw new Error("exceeds the fixed ceiling");
        return { taskId: request.taskId, members: [{ templateId: "ai-security", agentId: "specialist-2" }] };
      }
    };
    const handler = createAgencyHandler({ security: security(), expansionPlanner: planner });
    const ok = await handler(req({
      method: "POST", path: "/director/expand-team",
      body: { taskId: "t1", description: "Review prompt injection defenses", requestedTeamSize: 3 }
    }));
    expect(ok.status).toBe(200);
    expect((ok.body as { grantedTeamSize: number }).grantedTeamSize).toBe(1);

    const denied = await handler(req({
      method: "POST", path: "/director/expand-team",
      body: { taskId: "t1", description: "Review prompt injection defenses", requestedTeamSize: 99 }
    }));
    expect(denied.status).toBe(403);
  });

  it("rejects an oversized body", async () => {
    const handler = createAgencyHandler({ security: security(), maxBodyBytes: 10 });
    const res = await handler(req({
      method: "POST", path: "/security/assemble",
      body: { taskId: "t1", description: "way too long for ten bytes" }
    }));
    expect(res.status).toBe(413);
  });

  it("rate limits per client", async () => {
    const store = new InMemoryRateLimitStore();
    const handler = createAgencyHandler({
      security: security(),
      rateLimitStore: store,
      limits: { security: 1, director: 1, windowMs: 1000 }
    });
    const first = await handler(req({ method: "POST", path: "/security/release", body: { taskId: "t1" } }));
    expect(first.status).toBe(200);
    const second = await handler(req({ method: "POST", path: "/security/release", body: { taskId: "t1" } }));
    expect(second.status).toBe(429);
    const otherClient = await handler(req({
      method: "POST", path: "/security/release", body: { taskId: "t1" }, clientKey: "client-2"
    }));
    expect(otherClient.status).toBe(200);
  });

  it("is not wired into the consumer web server", () => {
    const server = readFileSync(new URL("../../../apps/web/server.mjs", import.meta.url), "utf8");
    expect(server).not.toContain("createAgencyHandler");
    expect(server).not.toContain("RemoteInferenceProvider");
    expect(server).not.toContain("serverless/handler");
  });
});
