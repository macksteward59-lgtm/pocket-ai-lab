import { once } from "node:events";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { InferenceRequest } from "../../orchestrator/Orchestrator";
import { DeepSeekAnalysisProvider, DEEPSEEK_ANALYSIS_ENDPOINT } from "./DeepSeekAnalysisProvider";
import { createCloudAnalysisHandler } from "./gateway";
import { createBearerAuthenticator, createCloudAnalysisNodeServer } from "./nodeServer";
import { CLOUD_ANALYSIS_LIMITS, type CloudAnalysisRequest } from "./types";
import { canonicalAttemptID, inputSHA256, isIdentifier } from "./validation";

const NOW = 1_800_000_000_000;
const APPLICATION_TOKEN = "fixture-application-token-at-least-32-characters";
const PROVIDER_KEY = "fixture-private-provider-key";

function input(overrides: Record<string, unknown> = {}): CloudAnalysisRequest {
  const inputText = "Explain this selected task only. 🧪";
  return {
    schemaVersion: 1,
    taskID: "task-1",
    attemptID: randomUUID(),
    profileID: "pocket-analysis-v1",
    requestedModel: "deepseek-flash",
    inputText,
    inputSHA256: inputSHA256(inputText),
    consentExpiresAt: NOW + 300_000,
    remoteConsent: true,
    maxOutputTokens: 512,
    ...overrides
  } as CloudAnalysisRequest;
}

function responseValue(): Record<string, any> {
  return {
    id: "fixture-provider-response",
    object: "chat.completion",
    model: "deepseek-flash",
    choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "A fixture analysis." } }],
    usage: { prompt_tokens: 8, completion_tokens: 4, total_tokens: 12 }
  };
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
}

function request(value: unknown, options: { signal?: AbortSignal; authorization?: string; contentType?: string; path?: string; method?: string } = {}): Request {
  const method = options.method ?? "POST";
  return new Request("https://gateway.example" + (options.path ?? "/v1/cloud-analysis"), {
    method,
    headers: { "content-type": options.contentType ?? "application/json", authorization: options.authorization ?? "Bearer " + APPLICATION_TOKEN },
    ...(method === "GET" ? {} : { body: JSON.stringify(value) }),
    signal: options.signal
  });
}

function rig(options: {
  upstream?: (init: RequestInit) => Response | Promise<Response>;
  timeoutMs?: number;
  now?: () => number;
  maxReplayEntries?: number;
} = {}) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const provider = new DeepSeekAnalysisProvider({
    enabled: true,
    apiKey: PROVIDER_KEY,
    model: "deepseek-flash",
    timeoutMs: options.timeoutMs,
    fetchImpl: (async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      return options.upstream?.(init ?? {}) ?? jsonResponse(responseValue());
    }) as typeof fetch
  });
  const handler = createCloudAnalysisHandler({
    enabled: true,
    profile: { profileID: "pocket-analysis-v1", model: "deepseek-flash" },
    provider,
    authenticate: createBearerAuthenticator(APPLICATION_TOKEN),
    now: options.now ?? (() => NOW),
    maxReplayEntries: options.maxReplayEntries
  });
  return { calls, provider, handler };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

afterEach(() => { vi.useRealTimers(); });

describe("Cloud analysis disclosure and response contract", () => {
  it("stays disabled without configuration or network activity", async () => {
    expect(await (await createCloudAnalysisHandler()(request(input()))).json()).toEqual({
      schemaVersion: 1, error: { code: "disabled", remoteOutcome: "not_started" }
    });
    expect(() => new DeepSeekAnalysisProvider({ apiKey: PROVIDER_KEY, model: "deepseek-flash" } as never)).toThrow();
  });

  it("sends only exact selected text and fixed bounded settings, and returns attributed untrusted analysis", async () => {
    const r = rig();
    const value = input();
    const result = await r.handler(request(value));
    expect(result.status).toBe(200);
    expect(result.headers.get("cache-control")).toBe("no-store");
    expect(r.calls).toHaveLength(1);
    expect(r.calls[0].url).toBe(DEEPSEEK_ANALYSIS_ENDPOINT);
    expect(r.calls[0].init.redirect).toBe("error");
    expect(r.calls[0].init.headers).toMatchObject({ authorization: "Bearer " + PROVIDER_KEY });
    expect(JSON.parse(String(r.calls[0].init.body))).toEqual({
      model: "deepseek-flash",
      messages: [{ role: "user", content: value.inputText }],
      reasoning_effort: "none", stream: false, max_tokens: 512, tool_choice: "none"
    });
    expect(await result.json()).toEqual({
      schemaVersion: 1, taskID: value.taskID, attemptID: value.attemptID,
      profileID: value.profileID, requestedModel: value.requestedModel, inputSHA256: value.inputSHA256,
      execution: "cloud", providerID: "deepseek", actualModel: "deepseek-flash",
      providerResponseID: "fixture-provider-response", text: "A fixture analysis.",
      usage: { promptTokens: 8, completionTokens: 4, totalTokens: 12 },
      finishReason: "stop", authorized: false
    });
  });

  it.each([
    ["remoteConsent", false, "consent_required"],
    ["consentExpiresAt", NOW, "consent_expired"],
    ["consentExpiresAt", NOW + 300_001, "consent_expired"],
    ["consentExpiresAt", NOW + 0.5, "consent_expired"],
    ["requestedModel", "deepseek-v4-pro", "profile_mismatch"],
    ["profileID", "another-profile", "profile_mismatch"],
    ["inputSHA256", "0".repeat(64), "input_mismatch"],
    ["maxOutputTokens", 513, "invalid_request"],
    ["maxOutputTokens", 0, "invalid_request"],
    ["maxOutputTokens", 2.5, "invalid_request"],
    ["schemaVersion", 2, "invalid_request"],
    ["taskID", "task\n", "invalid_request"],
    ["profileID", "profile\r", "invalid_request"],
    ["requestedModel", "deepseek-flash\n", "invalid_request"],
    ["inputText", "   ", "invalid_request"],
    ["inputText", "\uD800", "invalid_request"]
  ])("rejects %s=%s before dispatch", async (key, badValue, code) => {
    const r = rig();
    const result = await r.handler(request(input({ [String(key)]: badValue })));
    expect(await result.json()).toEqual({ schemaVersion: 1, error: { code, remoteOutcome: "not_started" } });
    expect(r.calls).toHaveLength(0);
  });

  it("rejects missing/extra keys and refuses to silently include history or memory", async () => {
    const r = rig();
    for (const candidate of [
      { ...input(), memoryContext: [{ content: "private memory" }] },
      { ...input(), conversation: [{ role: "user", content: "private history" }] },
      Object.fromEntries(Object.entries(input()).filter(([key]) => key !== "requestedModel"))
    ]) {
      expect((await (await r.handler(request(candidate))).json()).error.code).toBe("invalid_request");
    }
    expect(r.calls).toHaveLength(0);
  });

  it("bounds exact UTF-8 input bytes instead of JS string length", async () => {
    const r = rig();
    const accepted = "🧪".repeat(1_000);
    expect((await r.handler(request(input({ inputText: accepted, inputSHA256: inputSHA256(accepted) })))).status).toBe(200);
    const rejected = accepted + "x";
    expect((await (await r.handler(request(input({ inputText: rejected, inputSHA256: inputSHA256(rejected) })))).json()).error.code).toBe("invalid_request");
    expect(r.calls).toHaveLength(1);
  });

  it("authenticates, restricts route/method/media, and caps request bytes before dispatch", async () => {
    const r = rig();
    for (const [options, code] of [
      [{ authorization: "Bearer incorrect" }, "unauthenticated"],
      [{ path: "/v1/generate" }, "not_found"],
      [{ path: "/v1/cloud-analysis?extra=1" }, "not_found"],
      [{ method: "GET" }, "method_not_allowed"],
      [{ contentType: "text/plain" }, "unsupported_media_type"]
    ] as const) {
      expect((await (await r.handler(request(input(), options))).json()).error.code).toBe(code);
    }
    const oversized = request({ ...input(), extra: "x".repeat(CLOUD_ANALYSIS_LIMITS.requestBytes) });
    expect((await (await r.handler(oversized)).json()).error.code).toBe("payload_too_large");
    expect(r.calls).toHaveLength(0);
  });

  it("does not accept identifier or UUID newline aliases", () => {
    const uuid = randomUUID();
    for (const suffix of ["\n", "\r", "\r\n", " ", "\u2028"]) {
      expect(isIdentifier("task" + suffix)).toBe(false);
      expect(canonicalAttemptID(uuid + suffix)).toBeUndefined();
    }
    expect(canonicalAttemptID(uuid.toUpperCase())).toBe(uuid);
  });
});

describe("Cloud attempt admission and uncertainty", () => {
  it("canonicalizes consumed IDs and retains them across expiry, changed payload and renewed consent", async () => {
    let now = NOW;
    const r = rig({ now: () => now });
    const value = input();
    expect((await r.handler(request(value))).status).toBe(200);
    for (const change of [
      { attemptID: value.attemptID.toUpperCase() },
      { inputSHA256: "0".repeat(64) },
      { remoteConsent: false },
      { requestedModel: "deepseek-v4-pro" },
      { extra: "not a valid v1 field" }
    ]) {
      expect(await (await r.handler(request({ ...value, ...change }))).json()).toEqual({
        schemaVersion: 1, error: { code: "duplicate_attempt", remoteOutcome: "unknown" }
      });
    }
    now = NOW + 600_000;
    expect((await (await r.handler(request({ ...value, consentExpiresAt: now + 300_000 }))).json()).error.code).toBe("duplicate_attempt");
    expect(r.calls).toHaveLength(1);
  });

  it("fails closed at bounded replay capacity", async () => {
    const r = rig({ maxReplayEntries: 1 });
    expect((await r.handler(request(input()))).status).toBe(200);
    expect(await (await r.handler(request(input()))).json()).toEqual({
      schemaVersion: 1, error: { code: "capacity", remoteOutcome: "not_started" }
    });
    expect(r.calls).toHaveLength(1);
  });

  it("admits one active local request and does not consume a busy request's ID", async () => {
    const entered = deferred<void>();
    const finish = deferred<Response>();
    let calls = 0;
    const r = rig({ upstream: () => {
      if (++calls === 1) { entered.resolve(); return finish.promise; }
      return jsonResponse(responseValue());
    } });
    const first = r.handler(request(input()));
    await entered.promise;
    const waiting = input();
    expect(await (await r.handler(request(waiting))).json()).toEqual({ schemaVersion: 1, error: { code: "busy", remoteOutcome: "not_started" } });
    expect(r.calls).toHaveLength(1);
    finish.resolve(jsonResponse(responseValue()));
    expect((await first).status).toBe(200);
    expect((await r.handler(request(waiting))).status).toBe(200);
    expect(r.calls).toHaveLength(2);
  });

  it("settles cancellation as unknown without retrying an uncooperative provider", async () => {
    const entered = deferred<void>();
    const r = rig({ upstream: () => { entered.resolve(); return new Promise<Response>(() => {}); } });
    const cancel = new AbortController();
    const value = input();
    const running = r.handler(request(value, { signal: cancel.signal }));
    await entered.promise;
    cancel.abort();
    expect(await (await running).json()).toEqual({ schemaVersion: 1, error: { code: "cancelled", remoteOutcome: "unknown" } });
    expect((await (await r.handler(request(value))).json()).error.code).toBe("duplicate_attempt");
    expect(r.calls).toHaveLength(1);
  });

  it("times out an uncooperative fetch and retains the consumed attempt", async () => {
    vi.useFakeTimers();
    const entered = deferred<void>();
    const r = rig({ timeoutMs: 10, upstream: () => { entered.resolve(); return new Promise<Response>(() => {}); } });
    const value = input();
    const running = r.handler(request(value));
    await entered.promise;
    await vi.advanceTimersByTimeAsync(11);
    expect(await (await running).json()).toEqual({ schemaVersion: 1, error: { code: "upstream_timeout", remoteOutcome: "unknown" } });
    expect((await (await r.handler(request(value))).json()).error.code).toBe("duplicate_attempt");
    expect(r.calls).toHaveLength(1);
  });

  it("also bounds a provider response body that never finishes", async () => {
    vi.useFakeTimers();
    const entered = deferred<void>();
    const r = rig({ timeoutMs: 10, upstream: () => {
      entered.resolve();
      return new Response(new ReadableStream<Uint8Array>({ pull: () => new Promise<void>(() => {}) }), {
        headers: { "content-type": "application/json" }
      });
    } });
    const running = r.handler(request(input()));
    await entered.promise;
    await vi.advanceTimersByTimeAsync(11);
    expect(await (await running).json()).toEqual({ schemaVersion: 1, error: { code: "upstream_timeout", remoteOutcome: "unknown" } });
    expect(r.calls).toHaveLength(1);
  });
});

describe("DeepSeek text-only provider validation", () => {
  it.each([
    ["truncated", (v: Record<string, any>) => { v.choices[0].finish_reason = "length"; }],
    ["tool call", (v: Record<string, any>) => { v.choices[0].message.tool_calls = [{ id: "tool" }]; }],
    ["server tool", (v: Record<string, any>) => { v.choices[0].message.server_tool_calls = [{ type: "web_search" }]; }],
    ["thinking mode", (v: Record<string, any>) => { v.choices[0].message.reasoning_content = "unexpected mode"; }],
    ["wrong model", (v: Record<string, any>) => { v.model = "another-model"; }],
    ["missing identity", (v: Record<string, any>) => { delete v.id; }],
    ["non-assistant", (v: Record<string, any>) => { v.choices[0].message.role = "user"; }],
    ["empty text", (v: Record<string, any>) => { v.choices[0].message.content = " \n"; }],
    ["oversized UTF-8 text", (v: Record<string, any>) => { v.choices[0].message.content = "🧪".repeat(2_001); }],
    ["wrong usage sum", (v: Record<string, any>) => { v.usage.total_tokens = 13; }],
    ["fractional usage", (v: Record<string, any>) => { v.usage.prompt_tokens = 8.5; }],
    ["missing usage", (v: Record<string, any>) => { delete v.usage; }],
    ["over token budget", (v: Record<string, any>) => { v.usage.completion_tokens = 513; v.usage.total_tokens = 521; }],
    ["multiple choices", (v: Record<string, any>) => { v.choices.push(v.choices[0]); }],
    ["oversized raw response", (v: Record<string, any>) => { v.padding = "x".repeat(CLOUD_ANALYSIS_LIMITS.providerResponseBytes); }]
  ])("rejects %s rather than returning a false success", async (_label, mutate) => {
    const value = responseValue();
    mutate(value);
    const r = rig({ upstream: () => jsonResponse(value) });
    expect(await (await r.handler(request(input()))).json()).toEqual({ schemaVersion: 1, error: { code: "invalid_response", remoteOutcome: "unknown" } });
    expect(r.calls).toHaveLength(1);
  });

  it("refuses broader inference context before any fetch", async () => {
    const r = rig();
    const base: InferenceRequest = { agentId: "cloud-analysis", modelId: "deepseek-flash", prompt: "Selected text", stage: "independent", contextMessages: [] };
    await expect(r.provider.generate({ ...base, conversation: [{ role: "user", content: "private" }] })).rejects.toMatchObject({ code: "invalid_request" });
    await expect(r.provider.generate({ ...base, memoryContext: [{ id: "m", content: "private" }] })).rejects.toMatchObject({ code: "invalid_request" });
    expect(r.calls).toHaveLength(0);
  });

  it("sanitizes provider/network errors and never retries", async () => {
    for (const upstream of [
      () => new Response("secret upstream body " + PROVIDER_KEY, { status: 401 }),
      () => { throw new Error("secret network error " + PROVIDER_KEY); }
    ]) {
      const r = rig({ upstream });
      const result = await r.handler(request(input()));
      expect(await result.json()).toEqual({ schemaVersion: 1, error: { code: "upstream_failed", remoteOutcome: "unknown" } });
      expect(r.calls).toHaveLength(1);
    }
  });

  it("rejects invalid response encoding and media types", async () => {
    for (const upstream of [
      () => new Response(new Uint8Array([0xff]), { headers: { "content-type": "application/json" } }),
      () => new Response(JSON.stringify(responseValue()), { headers: { "content-type": "text/plain" } })
    ]) {
      const r = rig({ upstream });
      expect((await (await r.handler(request(input()))).json()).error.code).toBe("invalid_response");
    }
  });
});

describe("Concrete Node transport", () => {
  it("authenticates and exchanges actual loopback HTTP using the production handler", async () => {
    const r = rig();
    const server = createCloudAnalysisNodeServer({ handler: r.handler });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No port.");
    const url = `http://127.0.0.1:${address.port}/v1/cloud-analysis`;
    try {
      const value = input();
      const init = { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + APPLICATION_TOKEN }, body: JSON.stringify(value) };
      const response = await fetch(url, init);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ taskID: value.taskID, attemptID: value.attemptID, execution: "cloud", authorized: false });
      expect((await (await fetch(url, init)).json()).error).toEqual({ code: "duplicate_attempt", remoteOutcome: "unknown" });
      expect((await (await fetch(url, { ...init, headers: { "content-type": "application/json" } })).json()).error.code).toBe("unauthenticated");
      const tooLarge = await fetch(url, { ...init, body: JSON.stringify({ padding: "x".repeat(CLOUD_ANALYSIS_LIMITS.requestBytes) }) });
      expect(tooLarge.status).toBe(413);
      expect((await tooLarge.json()).error.code).toBe("payload_too_large");
      expect(r.calls).toHaveLength(1);
    } finally {
      const closed = new Promise<void>(resolve => server.close(() => resolve()));
      server.closeAllConnections();
      await closed;
    }
  });

  it("requires a separate bounded application credential and exact bearer header", () => {
    expect(() => createBearerAuthenticator("short")).toThrow();
    expect(() => createBearerAuthenticator(APPLICATION_TOKEN + "\n")).toThrow();
    expect(() => createBearerAuthenticator(APPLICATION_TOKEN + "\r")).toThrow();
    const authenticate = createBearerAuthenticator(APPLICATION_TOKEN);
    expect(authenticate("Bearer " + APPLICATION_TOKEN)).toBe(true);
    expect(authenticate("Bearer " + PROVIDER_KEY)).toBe(false);
    expect(authenticate("Bearer " + APPLICATION_TOKEN + "\n")).toBe(false);
  });
});
