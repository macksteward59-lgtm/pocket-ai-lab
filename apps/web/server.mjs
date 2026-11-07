import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 4173);
const maxBody = 64 * 1024;
const memoryManagerPromises = new Map();
const RATE_WINDOW_MS = 60_000;
const RATE_DEFAULTS = { chat: 30, memory: 120, agent: 8 };

function boundedInt(raw, fallback, min, max) {
  if (raw === undefined || raw === null) return fallback;
  const text = String(raw).trim();
  if (!/^[0-9]+$/.test(text)) return fallback;
  const value = Number(text);
  if (!Number.isSafeInteger(value) || value < min || value > max) return fallback;
  return value;
}

export function rateLimitConfig(env = process.env) {
  return {
    windowMs: boundedInt(env.POCKET_RATE_LIMIT_WINDOW_MS, RATE_WINDOW_MS, 1_000, 600_000),
    chat: boundedInt(env.POCKET_RATE_LIMIT_CHAT, RATE_DEFAULTS.chat, 1, 10_000),
    memory: boundedInt(env.POCKET_RATE_LIMIT_MEMORY, RATE_DEFAULTS.memory, 1, 10_000),
    agent: boundedInt(env.POCKET_RATE_LIMIT_AGENT, RATE_DEFAULTS.agent, 1, 10_000)
  };
}

function clientKey(req) {
  const remote = String(req.socket?.remoteAddress || "").toLowerCase();
  if (remote === "::1" || remote === "127.0.0.1" || remote.startsWith("::ffff:127.")) return "loopback";
  return remote || "unknown";
}

function createLimiter(config, now = Date.now) {
  const buckets = new Map();
  return function take(route, req) {
    const limit = config[route];
    const key = route + ":" + clientKey(req);
    const t = now();
    let bucket = buckets.get(key);
    if (!bucket || t >= bucket.resetAt) {
      bucket = { count: 0, resetAt: t + config.windowMs };
      buckets.set(key, bucket);
    }
    if (bucket.count >= limit) {
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - t) / 1000)) };
    }
    bucket.count += 1;
    return { allowed: true, retryAfterSeconds: 0 };
  };
}

async function openMemoryManager() {
  const directory = path.resolve(process.env.POCKET_MEMORY_DIR || path.join(
    process.env.HOME || process.env.USERPROFILE || ".",
    ".pocket-ai-lab"
  ));
  if (!memoryManagerPromises.has(directory)) {
    const pending = (async () => {
      const [{ MemoryManager }, { FileMemoryStore }] = await Promise.all([
        import("../../packages/intelligence/memory/MemoryManager.ts"),
        import("../../packages/intelligence/memory/FileMemoryStore.ts")
      ]);
      const store = await FileMemoryStore.open(directory);
      const manager = new MemoryManager(store);
      await manager.init();
      return manager;
    })();
    memoryManagerPromises.set(directory, pending);
  }
  try {
    return await memoryManagerPromises.get(directory);
  } catch (error) {
    memoryManagerPromises.delete(directory);
    throw error;
  }
}

function memoryApiAllowed(req) {
  const host = (process.env.HOST || "127.0.0.1").toLowerCase();
  const remote = (req.socket.remoteAddress || "").toLowerCase();
  const localHost = host === "127.0.0.1" || host === "localhost" || host === "::1";
  const localClient = remote === "::1" || remote === "127.0.0.1" || remote.startsWith("::ffff:127.");
  const origin = req.headers.origin;
  let sameOrigin = true;
  if (origin) {
    try {
      const parsed = new URL(origin);
      sameOrigin = Boolean(req.headers.host) && parsed.host === req.headers.host &&
        (parsed.protocol === "http:" || parsed.protocol === "https:");
    } catch {
      sameOrigin = false;
    }
  }
  const fetchSite = req.headers["sec-fetch-site"];
  const sameFetchSite = !fetchSite || fetchSite === "same-origin" || fetchSite === "none";
  return localHost && localClient && sameOrigin && sameFetchSite;
}
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

function json(res, status, payload, headers = {}) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...headers
  });
  res.end(JSON.stringify(payload));
}

function rejectLimited(res, retryAfterSeconds) {
  return json(res, 429, {
    error: "Too many requests. No reply was invented.",
    authorized: false
  }, { "retry-after": String(retryAfterSeconds) });
}

function drain(req) {
  req.resume();
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
  const take = createLimiter(rateLimitConfig());
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
      if (url.pathname === "/api/memory" || url.pathname.startsWith("/api/memory/")) {
        if (!memoryApiAllowed(req)) {
          return json(res, 403, { error: "Memory is available only to a loopback-only app instance." });
        }
        const memoryLimit = take("memory", req);
        if (!memoryLimit.allowed) {
          drain(req);
          return rejectLimited(res, memoryLimit.retryAfterSeconds);
        }
        if (url.pathname === "/api/memory" && req.method === "GET") {
          try {
            const manager = await openMemoryManager();
            return json(res, 200, { entries: manager.list() });
          } catch {
            return json(res, 500, { error: "Memory storage could not be opened. Existing data was not changed." });
          }
        }
        if (url.pathname === "/api/memory" && req.method === "POST") {
          if (!/^application\/json(?:\s*;|$)/i.test(req.headers["content-type"] || "")) {
            return json(res, 415, { error: "Memory writes require application/json." });
          }
          let input;
          try {
            input = await body(req);
          } catch (error) {
            return json(res, error.status || 400, { error: error.message });
          }
          if (typeof input.content !== "string" || !input.content.trim()) {
            return json(res, 400, { error: "Memory content is required." });
          }
          if (input.content.length > 12000) {
            return json(res, 413, { error: "Memory content exceeds 12,000 characters." });
          }
          const layers = ["working", "episodic", "semantic", "procedural"];
          const layer = layers.includes(input.layer) ? input.layer : "semantic";
          const source = typeof input.source === "string" ? input.source.trim() : "";
          if (source.length > 500) return json(res, 400, { error: "Source reference exceeds 500 characters." });
          try {
            const manager = await openMemoryManager();
            const id = await manager.write({
              layer,
              content: input.content.trim(),
              provenance: {
                agentId: "user",
                verified: false,
                sourceRefs: source ? [source] : []
              }
            });
            const entry = manager.list().find(item => item.id === id);
            return json(res, 201, { entry });
          } catch {
            return json(res, 500, { error: "Memory could not be saved. Existing data was not changed." });
          }
        }
        if (url.pathname.startsWith("/api/memory/") && req.method === "PUT") {
          if (!/^application\/json(?:\s*;|$)/i.test(req.headers["content-type"] || "")) {
            return json(res, 415, { error: "Memory edits require application/json." });
          }
          let id;
          try {
            id = decodeURIComponent(url.pathname.slice("/api/memory/".length));
          } catch {
            return json(res, 400, { error: "Invalid memory id." });
          }
          if (!/^mem-[0-9a-f-]{36}$/i.test(id)) return json(res, 400, { error: "Invalid memory id." });
          let input;
          try {
            input = await body(req);
          } catch (error) {
            return json(res, error.status || 400, { error: error.message });
          }
          if (typeof input.content !== "string" || !input.content.trim()) {
            return json(res, 400, { error: "Memory content is required." });
          }
          if (input.content.length > 12000) {
            return json(res, 413, { error: "Memory content exceeds 12,000 characters." });
          }
          const source = typeof input.source === "string" ? input.source.trim() : "";
          if (source.length > 500) return json(res, 400, { error: "Source reference exceeds 500 characters." });
          try {
            const manager = await openMemoryManager();
            const updated = await manager.update(id, {
              content: input.content,
              sourceRefs: source ? [source] : []
            });
            if (!updated) return json(res, 404, { error: "Memory entry not found." });
            const entry = manager.list().find(item => item.id === id);
            return json(res, 200, { entry });
          } catch (error) {
            if (error instanceof Error && error.message === "Memory content is required.") {
              return json(res, 400, { error: error.message });
            }
            return json(res, 500, { error: "Memory could not be updated. Existing data was not changed." });
          }
        }
        if (url.pathname.startsWith("/api/memory/") && req.method === "DELETE") {
          let id;
          try {
            id = decodeURIComponent(url.pathname.slice("/api/memory/".length));
          } catch {
            return json(res, 400, { error: "Invalid memory id." });
          }
          if (!/^mem-[0-9a-f-]{36}$/i.test(id)) return json(res, 400, { error: "Invalid memory id." });
          try {
            const manager = await openMemoryManager();
            const deleted = await manager.delete(id);
            return deleted
              ? json(res, 200, { deleted: true })
              : json(res, 404, { error: "Memory entry not found." });
          } catch {
            return json(res, 500, { error: "Memory could not be deleted. Existing data was not changed." });
          }
        }
        return json(res, 405, { error: "Method not allowed." });
      }
      if (url.pathname === "/api/agent-health" && req.method === "GET") {
        const { cfg, provider } = await openProvider(30000);
        await provider.checkHealth();
        return json(res, 200, { ready: true, baseUrl: cfg.baseUrl, api: cfg.api, loopback: isLoopbackBaseUrl(cfg.baseUrl) });
      }
      if (url.pathname === "/api/agent-tasks" && req.method === "POST") {
        const agentLimit = take("agent", req);
        if (!agentLimit.allowed) {
          drain(req);
          return rejectLimited(res, agentLimit.retryAfterSeconds);
        }
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
        const chatLimit = take("chat", req);
        if (!chatLimit.allowed) {
          drain(req);
          return rejectLimited(res, chatLimit.retryAfterSeconds);
        }
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
