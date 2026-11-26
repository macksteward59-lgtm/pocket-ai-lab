/**
 * Loopback page for the llama.cpp adapter.
 * Bind is 127.0.0.1 only. This is not the consumer product shell.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createLlamaCppInferenceProvider } from "../adapters/llama-cpp/index";
import { LlamaCppInferenceError } from "../adapters/llama-cpp/errors";
import type { InferenceProvider } from "../../packages/intelligence/orchestrator/Orchestrator";
import { runLabSession, type LabEvent } from "./session";

const PAGE = resolve(process.cwd(), "runtime/lab/public/index.html");
const MAX_REQUEST_BYTES = 16 * 1024;

export function assertLoopbackBaseUrl(baseUrl: string): string {
  let url: URL;
  try {
    url = new URL(baseUrl.trim());
  } catch {
    throw new LlamaCppInferenceError("invalid_config", "Llama server URL is not valid.");
  }
  const allowRemote = process.env.POCKET_LAB_ALLOW_REMOTE_LLAMA === "1";
  const loopback = url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]" || url.hostname === "::1";
  if (!allowRemote && !loopback) {
    throw new LlamaCppInferenceError(
      "invalid_config",
      "The lab only talks to a llama-server on this machine. Use http://127.0.0.1:8080."
    );
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new LlamaCppInferenceError("invalid_config", "Llama server URL must use http or https.");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new LlamaCppInferenceError("invalid_config", "Llama server URL cannot contain credentials, query parameters, or fragments.");
  }
  return url.toString().replace(/\/$/, "");
}

export function startLabServer(options?: {
  port?: number;
  provider?: InferenceProvider;
}): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer(async (request, response) => {
    try {
      await route(request, response, options?.provider);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Lab request failed.";
      const status = error instanceof LlamaCppInferenceError
        ? (error.code === "invalid_request" || error.code === "invalid_config" ? 400 : 502)
        : 500;
      sendJson(response, status, { error: message });
    }
  });
  const port = options?.port ?? Number(process.env.POCKET_LAB_PORT ?? 8787);
  return new Promise((resolvePromise, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      const address = server.address();
      const bound = address && typeof address !== "string" ? address.port : port;
      resolvePromise({
        url: `http://127.0.0.1:${bound}`,
        close: () => new Promise((done, fail) => {
          server.close(error => error ? fail(error) : done());
        })
      });
    });
  });
}

async function route(
  request: IncomingMessage,
  response: ServerResponse,
  injected?: InferenceProvider
): Promise<void> {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  if (request.method === "GET" && url.pathname === "/") {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(readFileSync(PAGE));
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/health") {
    const baseUrl = assertLoopbackBaseUrl(url.searchParams.get("baseUrl") || "http://127.0.0.1:8080");
    const provider = injected ?? createLlamaCppInferenceProvider({ baseUrl });
    const probe = provider as InferenceProvider & { checkHealth?: () => Promise<void> };
    if (probe.checkHealth) await probe.checkHealth();
    sendJson(response, 200, { ok: true, baseUrl });
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/tasks") {
    const body = await readJson(request);
    const objective = typeof body.objective === "string" ? body.objective : "";
    const baseUrl = assertLoopbackBaseUrl(typeof body.baseUrl === "string" ? body.baseUrl : "http://127.0.0.1:8080");
    const provider = injected ?? createLlamaCppInferenceProvider({ baseUrl, timeoutMs: 120_000 });
    response.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
      connection: "keep-alive"
    });
    const controller = new AbortController();
    response.on("close", () => { if (!response.writableEnded) controller.abort(); });
    await runLabSession({
      objective,
      provider,
      signal: controller.signal,
      onEvent: (event: LabEvent) => {
        response.write(`data: ${JSON.stringify(event)}\n\n`);
      }
    });
    response.end();
    return;
  }
  sendJson(response, 404, { error: "Not found." });
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += bytes.byteLength;
    if (total > MAX_REQUEST_BYTES) {
      throw new LlamaCppInferenceError("invalid_request", `Request body exceeds ${MAX_REQUEST_BYTES} bytes.`);
    }
    chunks.push(bytes);
  }
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text.trim()) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new LlamaCppInferenceError("invalid_request", "Request body must contain valid JSON.");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new LlamaCppInferenceError("invalid_request", "Request body must be a JSON object.");
  }
  return parsed as Record<string, unknown>;
}

const startedDirectly = process.argv[1]?.includes("server.ts") || process.argv[1]?.includes("server.js");
if (startedDirectly) {
  startLabServer().then(({ url }) => {
    console.log(`Pocket AI Lab harness: ${url}`);
    console.log("This page runs a local llama-server. It does not authorize actions.");
  }).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
