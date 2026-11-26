import { afterEach, describe, expect, it, vi } from "vitest";
import type { InferenceRequest } from "../../orchestrator/Orchestrator";
import { CLOUD_ANALYSIS_LIMITS } from "../../serverless/cloud-analysis/types";
import { CLOUDFLARE_ANALYSIS_MODELS, prepareCloudflareAnalysis, type CloudflareDestination } from "./contracts";
import { CLOUDFLARE_AGENT_ID } from "./profile";
import { CloudflareAnalysisProvider, type CloudflareGenerateOptions } from "./CloudflareAnalysisProvider";

const NOW = 1_800_000_000_000;
const DESTINATION: CloudflareDestination = { accountID: "a".repeat(32), modelID: CLOUDFLARE_ANALYSIS_MODELS[0] };
const REQUEST: InferenceRequest = {
  agentId: CLOUDFLARE_AGENT_ID, modelId: DESTINATION.modelID, prompt: "Selected fixture text.", stage: "independent", contextMessages: []
};
function fixture() {
  return {
    id: "fixture-response", model: "provider-reported-model", object: "chat.completion",
    choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: "Fixture final answer." } }],
    usage: { prompt_tokens: 8, completion_tokens: 5, total_tokens: 13, prompt_tokens_details: { cached_tokens: 2 } }
  };
}
function response(value: unknown = fixture()) { return new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } }); }
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function harness(config: { now?: () => number; getAccessToken?: (signal: AbortSignal) => Promise<string>; fetchImpl?: typeof fetch; timeoutMs?: number } = {}) {
  const getAccessToken = vi.fn(config.getAccessToken ?? (async () => "fixture-token"));
  const fetchImpl = vi.fn(config.fetchImpl ?? (async () => response()));
  const provider = new CloudflareAnalysisProvider({ enabled: true, destination: DESTINATION,
    getAccessToken, fetchImpl, now: config.now ?? (() => NOW), timeoutMs: config.timeoutMs });
  const options: CloudflareGenerateOptions = {
    purpose: "documentation", maxOutputTokens: 128, consentExpiresAt: NOW + 300_000,
    authorizeDispatch: vi.fn(() => true), assertCanDispatch: vi.fn(() => {})
  };
  return { provider, getAccessToken, fetchImpl, options, run: () => provider.generate(REQUEST, options) };
}
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("Cloudflare transport and candidate result", () => {
  it("sends exactly the preview body once and returns separately attributed unverified final text", async () => {
    const h = harness();
    expect(h.getAccessToken).not.toHaveBeenCalled();
    expect(h.fetchImpl).not.toHaveBeenCalled();
    const result = await h.run();
    const preview = prepareCloudflareAnalysis({ task_id: "fixture-task", purpose: "documentation", selected_text: REQUEST.prompt }, {
      attemptID: "00000000-0000-4000-8000-000000000001", destination: DESTINATION,
      release: { releaseID: "fixture-release", commitSHA: "1".repeat(40), artifactSHA256: "2".repeat(64) },
      now: NOW, consentExpiresAt: h.options.consentExpiresAt, maxOutputTokens: 128
    });
    expect(h.fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = h.fetchImpl.mock.calls[0];
    expect(url).toBe(preview.endpoint);
    expect(JSON.parse(String(init?.body))).toEqual(preview.requestBody);
    expect(init).toMatchObject({ method: "POST", redirect: "error", cache: "no-store", headers: { authorization: "Bearer fixture-token" } });
    expect(String(init?.body)).not.toMatch(/fixture-task|fixture-release|fixture-token/);
    expect(result).toEqual({
      payload: { analysis: "Fixture final answer." }, providerID: "cloudflare-workers-ai",
      requestedModel: DESTINATION.modelID, returnedModel: "provider-reported-model", providerResponseID: "fixture-response",
      usage: { reported: true, promptTokens: 8, completionTokens: 5, totalTokens: 13, cachedPromptTokens: 2, reasoningTokens: null },
      reasoningOutputDiscarded: false, finishReason: "stop", authorized: false, verified: false
    });
    expect(h.options.authorizeDispatch).toHaveBeenCalledTimes(2);
    expect(h.options.assertCanDispatch).toHaveBeenCalledTimes(1);
  });

  it.each(["reasoning_content", "reasoning"])("discards recognized %s without treating it as final text or token evidence", async key => {
    const value = fixture();
    (value.choices[0].message as any)[key] = "Private reasoning fixture, not returned.";
    const h = harness({ fetchImpl: async () => response(value) });
    const result = await h.run();
    expect(result.reasoningOutputDiscarded).toBe(true);
    expect(JSON.stringify(result)).not.toContain("Private reasoning fixture");
    expect(result.usage.reasoningTokens).toBeNull();
  });

  it("leaves absent provenance and usage unknown instead of manufacturing identifiers or zeros", async () => {
    const value: any = fixture();
    delete value.id; delete value.model; delete value.usage;
    const result = await harness({ fetchImpl: async () => response(value) }).run();
    expect(result.providerResponseID).toBeNull();
    expect(result.returnedModel).toBeNull();
    expect(result.usage).toEqual({ reported: false, promptTokens: null, completionTokens: null, totalTokens: null, cachedPromptTokens: null, reasoningTokens: null });
  });

  it("preserves partial reported counters without inferring totals or reasoning-budget compliance", async () => {
    const value: any = fixture();
    value.usage = { completion_tokens: 700 };
    const result = await harness({ fetchImpl: async () => response(value) }).run();
    expect(result.usage).toEqual({ reported: true, promptTokens: null, completionTokens: 700, totalTokens: null, cachedPromptTokens: null, reasoningTokens: null });
  });

  it.each(["length", "model_length", "tool_calls", "error", "unknown", undefined])("requires an explicit stop instead of accepting finish reason %s", async finish_reason => {
    const value: any = fixture(); value.choices[0].finish_reason = finish_reason;
    await expect(harness({ fetchImpl: async () => response(value) }).run()).rejects.toMatchObject({ code: "invalid_response", remoteOutcome: "unknown" });
  });

  it.each([
    ["two choices", (v: any) => { v.choices.push(v.choices[0]); }],
    ["wrong index", (v: any) => { v.choices[0].index = 1; }],
    ["wrong role", (v: any) => { v.choices[0].message.role = "user"; }],
    ["empty text", (v: any) => { v.choices[0].message.content = " "; }],
    ["media content", (v: any) => { v.choices[0].message.content = [{ type: "image_url", image_url: "fixture" }]; }],
    ["tool call", (v: any) => { v.choices[0].message.tool_calls = [{ function: { name: "fixture" } }]; }],
    ["function call", (v: any) => { v.choices[0].message.function_call = { name: "fixture" }; }],
    ["audio", (v: any) => { v.choices[0].message.audio = { data: "fixture" }; }],
    ["refusal", (v: any) => { v.choices[0].message.refusal = "refused"; }],
    ["malformed reasoning", (v: any) => { v.choices[0].message.reasoning = {}; }],
    ["invalid Unicode", (v: any) => { v.choices[0].message.content = "bad\ud800"; }],
    ["oversized text", (v: any) => { v.choices[0].message.content = "é".repeat(4_001); }],
    ["invalid usage", (v: any) => { v.usage.prompt_tokens = "8"; }],
    ["negative count", (v: any) => { v.usage.total_tokens = -1; }],
    ["unsafe count", (v: any) => { v.usage.completion_tokens = Number.MAX_SAFE_INTEGER + 1; }],
    ["impossible cache", (v: any) => { v.usage.prompt_tokens_details.cached_tokens = 9; }],
    ["error envelope", (v: any) => { v.error = { message: "secret upstream error" }; }],
    ["false success", (v: any) => { v.success = false; }],
    ["malformed success", (v: any) => { v.success = "false"; }]
  ])("rejects %s without retry", async (_name, mutate) => {
    const value = fixture(); mutate(value);
    const h = harness({ fetchImpl: async () => response(value) });
    await expect(h.run()).rejects.toMatchObject({ code: "invalid_response", remoteOutcome: "unknown" });
    expect(h.fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("rejects unsuccessful HTTP and sanitizes upstream error bodies", async () => {
    const h = harness({ fetchImpl: async () => new Response("secret provider body", { status: 429 }) });
    await expect(h.run()).rejects.toMatchObject({ message: "upstream_failed", remoteOutcome: "unknown" });
    expect(h.fetchImpl).toHaveBeenCalledTimes(1);
  });

  it.each(["redirect", "wrong-media", "invalid-json", "invalid-utf8"])("rejects %s responses", async kind => {
    let reply: Response;
    if (kind === "wrong-media") reply = new Response(JSON.stringify(fixture()), { headers: { "content-type": "text/plain" } });
    else if (kind === "invalid-json") reply = new Response("{not-json}", { headers: { "content-type": "application/json" } });
    else if (kind === "invalid-utf8") reply = new Response(new Uint8Array([0xff]), { headers: { "content-type": "application/json" } });
    else { reply = response(); Object.defineProperty(reply, "redirected", { value: true }); }
    await expect(harness({ fetchImpl: async () => reply }).run()).rejects.toMatchObject({ code: "invalid_response", remoteOutcome: "unknown" });
  });

  it("bounds actual streamed response bytes and cancels the reader", async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({ start(controller) {
      controller.enqueue(new TextEncoder().encode("{"));
      controller.enqueue(new Uint8Array(CLOUD_ANALYSIS_LIMITS.providerResponseBytes));
    }, cancel });
    const h = harness({ fetchImpl: async () => new Response(body, { headers: { "content-type": "application/json" } }) });
    await expect(h.run()).rejects.toMatchObject({ code: "invalid_response", remoteOutcome: "unknown" });
    expect(cancel).toHaveBeenCalledTimes(1);
  });
});

describe("Cloudflare dispatch admission", () => {
  it("requires explicit independent host callbacks before looking up credentials", async () => {
    const h = harness();
    await expect(h.provider.generate(REQUEST)).rejects.toMatchObject({ code: "approval_required", remoteOutcome: "not_started" });
    h.options.authorizeDispatch = () => false;
    await expect(h.run()).rejects.toMatchObject({ code: "approval_denied", remoteOutcome: "not_started" });
    expect(h.getAccessToken).not.toHaveBeenCalled();
    expect(h.fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    { contextMessages: [{}] }, { conversation: [] }, { memoryContext: [] },
    { agentId: "another-agent" }, { modelId: "other-model" }, { stage: "cross-review" }, { prompt: "x".repeat(4_001) }
  ])("refuses an unsupported inference context before credentials: %j", async changed => {
    const h = harness();
    await expect(h.provider.generate({ ...REQUEST, ...changed } as InferenceRequest, h.options)).rejects.toMatchObject({ code: "invalid_request", remoteOutcome: "not_started" });
    expect(h.getAccessToken).not.toHaveBeenCalled();
    expect(h.fetchImpl).not.toHaveBeenCalled();
  });

  it("prevents immediate cancellation from starting authorization, credentials or HTTP", async () => {
    const h = harness(); const controller = new AbortController(); h.options.signal = controller.signal;
    const pending = h.run(); controller.abort();
    await expect(pending).rejects.toMatchObject({ code: "cancelled", remoteOutcome: "not_started" });
    expect(h.options.authorizeDispatch).not.toHaveBeenCalled();
    expect(h.getAccessToken).not.toHaveBeenCalled();
    expect(h.fetchImpl).not.toHaveBeenCalled();
  });

  it("cannot resume into credentials after a cancelled asynchronous approval check", async () => {
    const h = harness(); const approval = deferred<boolean>(); const entered = deferred<void>();
    const controller = new AbortController(); h.options.signal = controller.signal;
    h.options.authorizeDispatch = async () => { entered.resolve(); return approval.promise; };
    const pending = h.run(); await entered.promise; controller.abort();
    await expect(pending).rejects.toMatchObject({ code: "cancelled", remoteOutcome: "not_started" });
    approval.resolve(true); await Promise.resolve(); await Promise.resolve();
    expect(h.getAccessToken).not.toHaveBeenCalled();
    expect(h.fetchImpl).not.toHaveBeenCalled();
  });

  it("rechecks approval after credentials and refuses a revoked decision", async () => {
    const token = deferred<string>(); const entered = deferred<void>(); let approved = true;
    const h = harness({ getAccessToken: async () => { entered.resolve(); return token.promise; } });
    h.options.authorizeDispatch = () => approved;
    const pending = h.run(); await entered.promise;
    approved = false; token.resolve("fixture-token");
    await expect(pending).rejects.toMatchObject({ code: "approval_denied", remoteOutcome: "not_started" });
    expect(h.fetchImpl).not.toHaveBeenCalled();
  });

  it("rechecks expiry against a clock jump during credentials with zero HTTP", async () => {
    const token = deferred<string>(); const entered = deferred<void>(); let now = NOW;
    const h = harness({ now: () => now, getAccessToken: async () => { entered.resolve(); return token.promise; } });
    const pending = h.run(); await entered.promise;
    now = h.options.consentExpiresAt; token.resolve("fixture-token");
    await expect(pending).rejects.toMatchObject({ code: "consent_expired", remoteOutcome: "not_started" });
    expect(h.fetchImpl).not.toHaveBeenCalled();
  });

  it("checks expiry again after the final synchronous host assertion", async () => {
    let now = NOW; const h = harness({ now: () => now });
    h.options.assertCanDispatch = () => { now = h.options.consentExpiresAt; };
    await expect(h.run()).rejects.toMatchObject({ code: "consent_expired", remoteOutcome: "not_started" });
    expect(h.fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses an accidentally async final assertion without an unhandled rejection", async () => {
    const h = harness(); h.options.assertCanDispatch = async () => { throw new Error("secret assertion detail"); };
    await expect(h.run()).rejects.toMatchObject({ code: "approval_denied", remoteOutcome: "not_started" });
    expect(h.fetchImpl).not.toHaveBeenCalled();
  });

  it("snapshots request options before a credential wait", async () => {
    const token = deferred<string>(); const entered = deferred<void>();
    const h = harness({ getAccessToken: async () => { entered.resolve(); return token.promise; } });
    const pending = h.run(); await entered.promise;
    h.options.maxOutputTokens = 1; h.options.purpose = "design-review"; token.resolve("fixture-token");
    await pending;
    const body = JSON.parse(String(h.fetchImpl.mock.calls[0][1]?.body));
    expect(body.max_tokens).toBe(128);
    expect(body.messages[0].content).toContain("selected documentation");
  });

  it.each(["bad\nvalue", "", "x".repeat(16_385)])("rejects malformed credentials without HTTP", async value => {
    const h = harness({ getAccessToken: async () => value });
    await expect(h.run()).rejects.toMatchObject({ code: "upstream_failed", remoteOutcome: "not_started" });
    expect(h.fetchImpl).not.toHaveBeenCalled();
  });

  it("sanitizes credential and authorization failures", async () => {
    const h = harness({ getAccessToken: async () => { throw new Error("secret credential error"); } });
    await expect(h.run()).rejects.toMatchObject({ message: "upstream_failed", remoteOutcome: "not_started" });
    h.options.authorizeDispatch = () => { throw new Error("secret policy error"); };
    await expect(h.run()).rejects.toMatchObject({ message: "approval_denied", remoteOutcome: "not_started" });
    expect(h.fetchImpl).not.toHaveBeenCalled();
  });

  it("bounds uncooperative credentials and prevents late resolution from dispatching", async () => {
    vi.useFakeTimers(); const token = deferred<string>(); const entered = deferred<void>();
    const h = harness({ getAccessToken: async () => { entered.resolve(); return token.promise; }, timeoutMs: 10 });
    const assertion = expect(h.run()).rejects.toMatchObject({ code: "deadline_exceeded", remoteOutcome: "not_started" });
    await entered.promise; await vi.advanceTimersByTimeAsync(10); await assertion;
    token.resolve("fixture-token"); await Promise.resolve(); await Promise.resolve();
    expect(h.fetchImpl).not.toHaveBeenCalled();
  });

  it("keeps a timed-out HTTP outcome unknown and never retries", async () => {
    vi.useFakeTimers(); const pendingResponse = deferred<Response>(); const entered = deferred<void>();
    const cancelled = deferred<void>(); const cancel = vi.fn(() => cancelled.resolve());
    const body = new ReadableStream<Uint8Array>({ cancel });
    const h = harness({ fetchImpl: async () => { entered.resolve(); return pendingResponse.promise; }, timeoutMs: 10 });
    const assertion = expect(h.run()).rejects.toMatchObject({ code: "deadline_exceeded", remoteOutcome: "unknown" });
    await entered.promise; await vi.advanceTimersByTimeAsync(10); await assertion;
    pendingResponse.resolve(new Response(body, { headers: { "content-type": "application/json" } }));
    await cancelled.promise;
    expect(h.fetchImpl).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(h.fetchImpl.mock.calls[0][1]?.signal?.aborted).toBe(true);
  });

  it.each(["consent_expired", "deadline_exceeded"] as const)("cancels headers and body after a clock jump causes %s", async code => {
    let now = NOW; const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({ cancel });
    const h = harness({ now: () => now, timeoutMs: 1_000, fetchImpl: async () => {
      now = code === "consent_expired" ? NOW + 300_000 : NOW + 1_000;
      return new Response(body, { headers: { "content-type": "application/json" } });
    } });
    await expect(h.run()).rejects.toMatchObject({ code, remoteOutcome: "unknown" });
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(h.fetchImpl.mock.calls[0][1]?.signal?.aborted).toBe(true);
  });

  it("retains unknown outcome on cancellation during a stalled response body", async () => {
    const controller = new AbortController(); const reading = deferred<void>(); const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({ pull() { reading.resolve(); return new Promise<void>(() => {}); }, cancel }, { highWaterMark: 0 });
    const h = harness({ fetchImpl: async () => new Response(body, { headers: { "content-type": "application/json" } }) });
    h.options.signal = controller.signal;
    const pending = h.run();
    await reading.promise; controller.abort();
    await expect(pending).rejects.toMatchObject({ code: "cancelled", remoteOutcome: "unknown" });
    expect(h.fetchImpl).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledTimes(1);
  });
});
