import { DurableObject } from "cloudflare:workers";
import { timingSafeEqual } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import { TaskLifecycleCoordinator, TaskLifecycleError } from "../../packages/intelligence/autonomy/TaskLifecycleCoordinator.ts";
import { DurableTaskLifecycleStore } from "../../packages/intelligence/cloud/cloudflare/DurableTaskLifecycleStore.ts";
import { cloudflareLifecycleTaskID } from "../../packages/intelligence/cloud/cloudflare/CloudflareAnalysisWorker.ts";
import { canonicalAttemptID, isBoundedText, readBoundedJSON } from "../../packages/intelligence/serverless/cloud-analysis/validation.ts";

export class DocumentAnalysisState extends DurableObject {
  getNote(attemptID) {
    const id = canonicalAttemptID(attemptID);
    if (!id) throw new Error("Invalid attempt ID");
    const sql = this.ctx.storage.sql;
    sql.exec(`CREATE TABLE IF NOT EXISTS document_handoff_notes (
      attempt_id TEXT PRIMARY KEY, revision INTEGER NOT NULL, text TEXT NOT NULL
    )`);
    const [row] = sql.exec(
      "SELECT revision, text FROM document_handoff_notes WHERE attempt_id = ?", id
    ).toArray();
    return row ? { found: true, attemptID: id, ...row } : { found: false, attemptID: id, revision: 0 };
  }

  saveNote(attemptID, expectedRevision, text) {
    if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || !isBoundedText(text, 4000)) {
      throw new Error("Invalid handoff note");
    }
    return this.ctx.storage.transactionSync(() => {
      const current = this.getNote(attemptID);
      if (current.found && current.text === text &&
          (current.revision === expectedRevision || current.revision === expectedRevision + 1)) {
        return current;
      }
      if (current.revision !== expectedRevision) {
        return { error: "revision_conflict", currentRevision: current.revision };
      }
      const revision = current.revision + 1;
      this.ctx.storage.sql.exec(
        `INSERT INTO document_handoff_notes (attempt_id, revision, text) VALUES (?, ?, ?)
         ON CONFLICT(attempt_id) DO UPDATE SET revision = excluded.revision, text = excluded.text`,
        current.attemptID, revision, text
      );
      return { found: true, attemptID: current.attemptID, revision, text };
    });
  }

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

const attemptSchema = z.string().refine(value => !!canonicalAttemptID(value), "Expected an attempt UUID");
const readHints = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

async function storageResult(operation) {
  try {
    const value = await operation();
    return {
      ...(value.error ? { isError: true } : {}),
      content: [{ type: "text", text: JSON.stringify(value) }], structuredContent: value
    };
  } catch {
    return { isError: true, content: [{ type: "text", text: "Document-analysis storage is unavailable." }] };
  }
}

function createServer(env, canEditNotes) {
  const server = new McpServer({ name: "pocket-document-analysis", version: "0.2.0" });
  const state = () => env.ANALYSIS_STATE.getByName("document-analysis-v1");
  server.registerTool("document_analysis_status", {
    description: "Read the last saved lifecycle status of a Pocket AI Lab document-analysis attempt.",
    inputSchema: { attemptID: attemptSchema }, annotations: readHints
  }, ({ attemptID }) => storageResult(() => state().status(canonicalAttemptID(attemptID))));

  if (canEditNotes) {
    server.registerTool("document_handoff_read", {
      description: "Read the project handoff note and revision for an attempt UUID. Missing notes have revision 0.",
      inputSchema: { attemptID: attemptSchema }, annotations: readHints
    }, ({ attemptID }) => storageResult(() => state().getNote(attemptID)));

    server.registerTool("document_handoff_save", {
      description: "Create or replace the handoff note for an attempt UUID. Send the revision you read, or 0 to create. A note can exist before a lifecycle record.",
      inputSchema: {
        attemptID: attemptSchema,
        expectedRevision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
        text: z.string().refine(value => isBoundedText(value, 4000), "Expected nonblank text of at most 4000 UTF-8 bytes")
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false }
    }, ({ attemptID, expectedRevision, text }) =>
      storageResult(() => state().saveNote(attemptID, expectedRevision, text)));
  }
  return server;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== "/mcp") return response(404, "Unknown route");
    const origin = request.headers.get("Origin");
    if (origin !== null && origin !== url.origin) return response(403, "Origin denied");
    const validKey = key => typeof key === "string" && key.length === 64 && /^[a-f0-9]+$/.test(key);
    if (!validKey(env.MCP_READ_KEY)) return response(503, "Read access is unconfigured");
    const encoder = new TextEncoder();
    const supplied = encoder.encode(request.headers.get("Authorization") ?? "");
    const matches = key => {
      const expected = encoder.encode("Bearer " + key);
      return supplied.length === expected.length && timingSafeEqual(supplied, expected);
    };
    const canEditNotes = validKey(env.MCP_NOTE_WRITE_KEY) && env.MCP_NOTE_WRITE_KEY !== env.MCP_READ_KEY &&
      matches(env.MCP_NOTE_WRITE_KEY);
    if (!matches(env.MCP_READ_KEY) && !canEditNotes) {
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
    const server = createServer(env, canEditNotes);
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
