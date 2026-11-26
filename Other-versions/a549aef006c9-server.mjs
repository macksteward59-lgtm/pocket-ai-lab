import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 4173);
const maxBody = 64 * 1024;
const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".json": "application/json",
  ".svg": "image/svg+xml"
};

export function llamaProviderConfig(env = process.env) {
  const explicitApi = env.LLAMACPP_API;
  const rawBase = (env.LLAMACPP_BASE_URL || env.LLM_BASE_URL || "http://127.0.0.1:8080").trim();
  let api = explicitApi === "openai-chat" || explicitApi === "completion" ? explicitApi : undefined;
  let baseUrl = rawBase;
  try {
    const url = new URL(rawBase);
    const pathname = url.pathname.replace(/\/+$/, "");
    if (!api && (pathname === "/v1" || pathname.endsWith("/v1"))) {
      api = "openai-chat";
      url.pathname = pathname.slice(0, -3) || "/";
      url.search = "";
      url.hash = "";
      baseUrl = url.toString().replace(/\/$/, "");
    }
  } catch {
    baseUrl = rawBase;
  }
  const modelAlias = (env.LLAMACPP_MODEL_ALIAS || env.LLM_MODEL || "").trim();
  return {
    baseUrl,
    api: api || "completion",
    modelAlias: modelAlias || undefined,
    configured: Boolean(env.LLAMACPP_BASE_URL || env.LLM_BASE_URL || env.LLAMACPP_MODEL_ALIAS || env.LLM_MODEL)
  };
}

export function isLoopbackBaseUrl(baseUrl) {
  try {
    const host = new URL(baseUrl).hostname.replace(/^\[|\]$/g, "").toLowerCase();
    return host === "127.0.0.1" || host === "localhost" || host === "::1";
  } catch {
    return false;
  }
}

function json(res, status, payload) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(payload));
}

async function body(req) {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > maxBody) throw Object.assign(new Error("Request too large"), { status: 413 });
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw Object.assign(new Error("Invalid JSON"), { status: 400 });
  }
}

async function openProvider(timeoutMs) {
  const cfg = llamaProviderConfig();
  const { createLlamaCppInferenceProvider } = await import("../../runtime/adapters/llama-cpp/index.ts");
  return {
    cfg,
    provider: createLlamaCppInferenceProvider({
      baseUrl: cfg.baseUrl,
      api: cfg.api,
      modelAlias: cfg.modelAlias,
      timeoutMs
    })
  };
}

function chatFailure(error) {
  const code = error && typeof error === "object" ? error.code : "";
  if (code === "timeout" || error?.name === "AbortError") {
    return { status: 504, error: "Model request timed out. No reply was invented." };
  }
  if (code === "cancelled") {
    return { status: 499, error: "Model request was cancelled. No reply was invented." };
  }
  if (code === "backend_unreachable") {
    return { status: 503, error: "Could not connect to the local llama-server. No reply was invented." };
  }
  if (code === "invalid_config" || code === "invalid_request") {
    return { status: 400, error: error instanceof Error ? error.message : "Invalid model request." };
  }
  return { status: 502, error: "The model response was rejected. No reply was invented." };
}

export function createServer() {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || "/", "http://localhost");
      if (url.pathname === "/api/health" && req.method === "GET") {
        const cfg = llamaProviderConfig();
        let reachable = false;
        try {
          const { provider } = await openProvider(4000);
          await provider.checkHealth();
          reachable = true;
        } catch {
          reachable = false;
        }
        return json(res, 200, {
          configured: cfg.configured,
          reachable,
          loopback: isLoopbackBaseUrl(cfg.baseUrl),
          model: cfg.modelAlias || null,
          provider: "llama.cpp",
          mode: "local-first",
          baseUrl: cfg.baseUrl
        });
      }
      if (url.pathname === "/api/agent-health" && req.method === "GET") {
        const { cfg, provider } = await openProvider(30000);
        await provider.checkHealth();
        return json(res, 200, { ready: true, baseUrl: cfg.baseUrl, api: cfg.api, loopback: isLoopbackBaseUrl(cfg.baseUrl) });
      }
      if (url.pathname === "/api/agent-tasks" && req.method === "POST") {
        let input;
        try {
          input = await body(req);
        } catch (e) {
          return json(res, e.status || 400, { error: e.message });
        }
        if (typeof input.objective !== "string" || !input.objective.trim()) return json(res, 400, { error: "A non-empty objective is required." });
        if (input.objective.length > 4000) return json(res, 413, { error: "Objective exceeds 4,000 characters." });
        const [{ runLabSession }, { cfg, provider }] = await Promise.all([
          import("../../runtime/lab/session.ts"),
          openProvider(120000)
        ]);
        await provider.checkHealth();
        res.writeHead(200, { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache", connection: "keep-alive" });
        const controller = new AbortController();
        res.on("close", () => { if (!res.writableEnded) controller.abort(); });
        await runLabSession({
          objective: input.objective,
          provider,
          modelId: cfg.modelAlias || "local",
          signal: controller.signal,
          onEvent: event => { if (!res.destroyed && !res.writableEnded) res.write("data: " + JSON.stringify(event) + "\n\n"); }
        });
        if (!res.writableEnded) res.end();
        return;
      }
      if (url.pathname === "/api/chat" && req.method === "POST") {
        let input;
        try {
          input = await body(req);
        } catch (e) {
          return json(res, e.status || 400, { error: e.message });
        }
        if (typeof input.message !== "string" || !input.message.trim()) return json(res, 400, { error: "A non-empty message is required." });
        if (input.message.length > 12000) return json(res, 413, { error: "Message exceeds 12,000 characters." });
        const { cfg, provider } = await openProvider(60000);
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 60000);
        res.on("close", () => { if (!res.writableEnded) controller.abort(); });
        try {
          const result = await provider.generate({
            agentId: "chat",
            modelId: cfg.modelAlias || "local",
            prompt: input.message,
            stage: "independent",
            contextMessages: []
          }, { signal: controller.signal });
          const payload = result && typeof result === "object" ? result.payload : undefined;
          const analysis = payload && typeof payload.analysis === "string" ? payload.analysis.trim() : "";
          if (!analysis) return json(res, 502, { error: "The model response was rejected. No reply was invented." });
          return json(res, 200, {
            reply: analysis,
            model: cfg.modelAlias || "local",
            provider: "llama.cpp",
            authorized: false
          });
        } catch (error) {
          const failure = chatFailure(error);
          return json(res, failure.status, { error: failure.error });
        } finally {
          clearTimeout(timeout);
        }
      }
      if (req.method !== "GET" && req.method !== "HEAD") return json(res, 405, { error: "Method not allowed." });
      const requested = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
      const resolved = path.resolve(root, requested);
      if (!resolved.startsWith(root + path.sep)) return json(res, 403, { error: "Forbidden." });
      try {
        const content = await readFile(resolved);
        res.writeHead(200, {
          "content-type": mime[path.extname(resolved)] || "application/octet-stream",
          "cache-control": resolved.endsWith("index.html") ? "no-cache" : "public, max-age=3600"
        });
        res.end(req.method === "HEAD" ? undefined : content);
      } catch {
        return json(res, 404, { error: "Not found." });
      }
    } catch (error) {
      if (res.headersSent) {
        res.end();
        return;
      }
      const code = error && typeof error === "object" ? error.code : "";
      const status = code === "backend_unreachable" || code === "http_error" ? 502 : code === "invalid_request" || code === "invalid_config" ? 400 : 500;
      return json(res, status, { error: error instanceof Error ? error.message : "Request failed." });
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const host = process.env.HOST || "127.0.0.1";
  createServer().listen(port, host, () => console.log("Pocket AI Lab web app listening on http://" + host + ":" + port));
}
