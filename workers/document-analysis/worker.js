import { DurableObject } from "cloudflare:workers";
import { timingSafeEqual } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import { TaskLifecycleCoordinator, TaskLifecycleError } from "../../packages/intelligence/autonomy/TaskLifecycleCoordinator.ts";
import { DurableTaskLifecycleStore } from "../../packages/intelligence/cloud/cloudflare/DurableTaskLifecycleStore.ts";
import { cloudflareLifecycleTaskID } from "../../packages/intelligence/cloud/cloudflare/CloudflareAnalysisWorker.ts";
import { canonicalAttemptID, readBoundedJSON } from "../../packages/intelligence/serverless/cloud-analysis/validation.ts";

export class DocumentAnalysisState extends DurableObject {
  async status(attemptID) {
    if (!canonicalAttemptID(attemptID)) throw new Error("Invalid attempt ID");
    const coordinator = new TaskLifecycleCoordinator({
      store: new DurableTaskLifecycleStore(this.ctx.storage.sql)
    });
    await coordinator.init();

    let task;
    try {
      task = coordinator.getTask(cloudflareLifecycleTaskID({ attemptID }));
    } catch (error) {
      if (error instanceof TaskLifecycleError && error.code === "unknown_task") return { found: false };
      throw error;
    }
    if (task.metadata.kind !== "cloudflare-analysis" || task.metadata.attemptID !== attemptID ||
        task.metadata.providerID !== "cloudflare-workers-ai") return { found: false };

    return {
      found: true, attemptID, status: task.status, updatedAt: task.updatedAt,
      uncertain: task.steps.some(step => step.uncertain === true)
    };
  }
}

function response(status, message, headers = {}) {
  return new Response(message, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

function createServer(env) {
  const server = new McpServer({ name: "pocket-document-analysis", version: "0.1.0" });
  server.registerTool("document_analysis_status", {
    description: "Read the last saved lifecycle status of a Pocket AI Lab document-analysis attempt.",
    inputSchema: { attemptID: z.string().refine(value => !!canonicalAttemptID(value), "Expected an attempt UUID") },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
  }, async ({ attemptID }) => {
    try {
      const state = env.ANALYSIS_STATE.getByName("document-analysis-v1");
      const status = await state.status(canonicalAttemptID(attemptID));
      return { content: [{ type: "text", text: JSON.stringify(status) }], structuredContent: status };
    } catch {
      return { isError: true, content: [{ type: "text", text: "Document-analysis storage is unavailable." }] };
    }
  });
  return server;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== "/mcp") return response(404, "Unknown route");
    const origin = request.headers.get("Origin");
    if (origin !== null && origin !== url.origin) return response(403, "Origin denied");
    // One dedicated random 32-byte hex key for this private, single-owner host.
    if (typeof env.MCP_READ_KEY !== "string" || env.MCP_READ_KEY.length !== 64 ||
        !/^[a-f0-9]+$/.test(env.MCP_READ_KEY)) return response(503, "Read access is unconfigured");
    const supplied = request.headers.get("Authorization") ?? "";
    const expected = "Bearer " + env.MCP_READ_KEY;
    const encoder = new TextEncoder();
    const bytes = encoder.encode(supplied);
    if (bytes.length !== expected.length || !timingSafeEqual(bytes, encoder.encode(expected))) {
      return response(401, "Authentication required", { "WWW-Authenticate": 'Bearer realm="document-analysis"' });
    }
    if (request.method !== "POST") return response(405, "Use POST", { Allow: "POST" });
    if (request.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase() !== "application/json") {
      return response(415, "Expected application/json");
    }
    let message;
    try {
      message = await readBoundedJSON(request.body, 16 * 1024, request.signal, "invalid_request");
    } catch (error) {
      return response(error.code === "payload_too_large" ? 413 : 400, "Invalid MCP request");
    }
    const server = createServer(env);
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined, enableJsonResponse: true
    });
    try {
      await server.connect(transport);
      const result = await transport.handleRequest(request, { parsedBody: message });
      const outgoing = new Response(result.body, result);
      outgoing.headers.set("Cache-Control", "no-store");
      return outgoing;
    } finally {
      await server.close();
    }
  }
};
