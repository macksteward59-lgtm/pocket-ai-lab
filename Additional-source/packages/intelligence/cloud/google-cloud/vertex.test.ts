import { afterEach, describe, expect, it, vi } from "vitest";
import type { InferenceRequest } from "../../orchestrator/Orchestrator";
import { CLOUD_ANALYSIS_LIMITS } from "../../serverless/cloud-analysis/types";
import { prepareGoogleCloudAnalysis, type VertexDestination } from "./contracts";
import { GOOGLE_CLOUD_AGENT_ID } from "./profile";
import { VertexAnalysisProvider, type VertexAnalysisOptions, type VertexGenerateOptions } from "./VertexAnalysisProvider";

const DESTINATION: VertexDestination = { projectID: "pocket-fixture", location: "us-central1", modelID: "gemini-test-alias" };
const SELECTED_TEXT = "Tests observed: 12 passed, 1 failed. Investigate the missing assertion. 🧪";
const TOKEN = "fixture-access-token.private";
const NOW = 1_800_000_000_000;
const GENERATE: VertexGenerateOptions = { purpose: "test-summary", maxOutputTokens: 128 };

function input(overrides: Partial<InferenceRequest> = {}): InferenceRequest {
  return {
    agentId: GOOGLE_CLOUD_AGENT_ID, modelId: DESTINATION.modelID, prompt: SELECTED_TEXT,
    stage: "independent", contextMessages: [], ...overrides
  };
}

function responseValue(): Record<string, any> {
  return {
    modelVersion: "gemini-fixture-version-001", responseId: "-fixture-response_/==",
    candidates: [{ content: { role: "model", parts: [{ text: "Twelve tests passed; one assertion failed." }] }, finishReason: "STOP" }],
    usageMetadata: { promptTokenCount: 8, candidatesTokenCount: 4, totalTokenCount: 12 }
  };
}

function json(value = responseValue()): Response {
  return new Response(JSON.stringify(value), { headers: { "content-type": "application/json; charset=utf-8" } });
}

function rig(options: {
  upstream?: () => Response | Promise<Response>;
  getAccessToken?: VertexAnalysisOptions["getAccessToken"];
  timeoutMs?: number;
  destination?: VertexDestination;
} = {}) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const getAccessToken = vi.fn(options.getAccessToken ?? (async () => TOKEN));
  const provider = new VertexAnalysisProvider({
    enabled: true, destination: options.destination ?? DESTINATION,
    getAccessToken, timeoutMs: options.timeoutMs,
    fetchImpl: (async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      return options.upstream ? options.upstream() : json();
    }) as typeof fetch
  });
  return { provider, calls, getAccessToken };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

afterEach(() => vi.useRealTimers());

describe("Vertex selected-text transport", () => {
  it("previews without credentials/network and sends exactly the reviewed regional request", async () => {
    const { provider, calls, getAccessToken } = rig();
    const preview = prepareGoogleCloudAnalysis({ task_id: "task-local-not-outbound", purpose: "test-summary", selected_text: SELECTED_TEXT }, {
      attemptID: "b1234567-89ab-4cde-8fab-0123456789ab", destination: DESTINATION,
      release: { releaseID: "release-local-not-outbound", commitSHA: "a".repeat(40), artifactSHA256: "b".repeat(64) },
      consentExpiresAt: NOW + 60_000, maxOutputTokens: 128, now: NOW
    });
    expect(getAccessToken).not.toHaveBeenCalled();
    expect(calls).toHaveLength(0);
    const result = await provider.generate(input(), GENERATE);
    expect(getAccessToken).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(1);
    const { url, init } = calls[0];
    expect(url).toBe("https://us-central1-aiplatform.googleapis.com/v1/projects/pocket-fixture/locations/us-central1/publishers/google/models/gemini-test-alias:generateContent");
    expect(url).toBe(preview.endpoint);
    expect(init).toMatchObject({ method: "POST", redirect: "error", cache: "no-store" });
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer " + TOKEN);
    const body = JSON.parse(init.body as string);
    expect(body).toEqual(preview.requestBody);
    expect(Object.keys(body).sort()).toEqual(["contents", "generationConfig", "systemInstruction"]);
    expect(body.contents).toEqual([{ role: "user", parts: [{ text: SELECTED_TEXT }] }]);
    expect(body.generationConfig).toEqual({ candidateCount: 1, maxOutputTokens: 128, responseMimeType: "text/plain" });
    for (const localOnly of [TOKEN, preview.taskID, preview.attemptID, preview.release.releaseID, preview.digest, GOOGLE_CLOUD_AGENT_ID]) {
      expect(init.body).not.toContain(localOnly);
    }
    expect(result).toMatchObject({
      payload: { analysis: "Twelve tests passed; one assertion failed." }, providerID: "google-vertex",
      requestedModel: DESTINATION.modelID, actualModel: "gemini-fixture-version-001",
      providerResponseID: "-fixture-response_/==", finishReason: "STOP"
    });
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });

  it("copies and freezes the configured destination rather than following later host mutation", async () => {
    const destination = { ...DESTINATION };
    const { provider, calls } = rig({ destination });
    destination.projectID = "another-project";
    destination.location = "europe-west1";
    expect(Object.isFrozen(provider.destination)).toBe(true);
    expect(Object.isFrozen(provider)).toBe(true);
    await provider.generate(input(), GENERATE);
    expect(calls[0].url).toContain("/projects/pocket-fixture/locations/us-central1/");
  });

  it("keeps response validation bound to the sent token cap when the host mutates options during credential lookup", async () => {
    const options: VertexGenerateOptions = { purpose: "test-summary", maxOutputTokens: 1 };
    const value = responseValue();
    value.usageMetadata = { promptTokenCount: 8, candidatesTokenCount: 512, totalTokenCount: 520 };
    const { provider, calls } = rig({
      getAccessToken: async () => { options.maxOutputTokens = 512; return TOKEN; },
      upstream: () => json(value)
    });
    await expect(provider.generate(input(), options)).rejects.toMatchObject({ code: "invalid_response" });
    expect(JSON.parse(calls[0].init.body as string).generationConfig.maxOutputTokens).toBe(1);
    expect(options.maxOutputTokens).toBe(512);
  });

  it.each([
    ["disabled", { enabled: false }],
    ["missing credential callback", { getAccessToken: undefined }],
    ["global endpoint", { destination: { ...DESTINATION, location: "global" } }],
    ["project path injection", { destination: { ...DESTINATION, projectID: "pocket/other" } }],
    ["model path injection", { destination: { ...DESTINATION, modelID: "gemini/other" } }],
    ["model query injection", { destination: { ...DESTINATION, modelID: "gemini?key=secret" } }],
    ["region newline", { destination: { ...DESTINATION, location: "us-central1\n" } }],
    ["unbounded timeout", { timeoutMs: CLOUD_ANALYSIS_LIMITS.timeoutMs + 1 }],
    ["zero timeout", { timeoutMs: 0 }]
  ])("fails closed for %s configuration", (_name, override) => {
    const token = vi.fn(async () => TOKEN);
    expect(() => new VertexAnalysisProvider({ enabled: true, destination: DESTINATION, getAccessToken: token, ...override } as VertexAnalysisOptions)).toThrow();
    expect(token).not.toHaveBeenCalled();
  });

  it.each([
    ["foreign agent", { agentId: "director" }],
    ["foreign requested model", { modelId: "different-model" }],
    ["deliberation context", { contextMessages: [{ text: "private context" }] }],
    ["conversation even when empty", { conversation: [] }],
    ["memory even when empty", { memoryContext: [] }],
    ["wrong deliberation stage", { stage: "synthesis" }],
    ["empty selected text", { prompt: "  " }],
    ["oversized UTF-8 selected text", { prompt: "🧪".repeat(1_001) }],
    ["invalid Unicode selected text", { prompt: "invalid \ud800" }]
  ])("refuses %s before credentials or transport", async (_name, overrides) => {
    const { provider, calls, getAccessToken } = rig();
    await expect(provider.generate(input(overrides as Partial<InferenceRequest>), GENERATE)).rejects.toMatchObject({ code: "invalid_request" });
    expect(calls).toHaveLength(0);
    expect(getAccessToken).not.toHaveBeenCalled();
  });

  it.each([
    { purpose: "execute-tools", maxOutputTokens: 128 },
    { purpose: "documentation", maxOutputTokens: 0 },
    { purpose: "documentation", maxOutputTokens: CLOUD_ANALYSIS_LIMITS.outputTokens + 1 }
  ])("rejects unsupported generation options before credentials", async options => {
    const { provider, calls, getAccessToken } = rig();
    await expect(provider.generate(input(), options as VertexGenerateOptions)).rejects.toMatchObject({ code: "invalid_request" });
    expect(calls).toHaveLength(0);
    expect(getAccessToken).not.toHaveBeenCalled();
  });
});

describe("Vertex cancellation, deadlines and failure privacy", () => {
  it("does not acquire credentials for a request already cancelled", async () => {
    const { provider, calls, getAccessToken } = rig();
    await expect(provider.generate(input(), { ...GENERATE, signal: AbortSignal.abort() })).rejects.toMatchObject({ code: "cancelled" });
    expect(calls).toHaveLength(0);
    expect(getAccessToken).not.toHaveBeenCalled();
  });

  it("times out a credential callback that ignores cancellation and never fetches after it resolves", async () => {
    vi.useFakeTimers();
    const token = deferred<string>();
    const { provider, calls } = rig({ getAccessToken: () => token.promise, timeoutMs: 10 });
    const outcome = provider.generate(input(), GENERATE).catch(error => error);
    await vi.advanceTimersByTimeAsync(10);
    expect(await outcome).toMatchObject({ code: "upstream_timeout" });
    token.resolve(TOKEN);
    await vi.advanceTimersByTimeAsync(0);
    expect(calls).toHaveLength(0);
  });

  it("cancels while credentials are pending and never dispatches a late token", async () => {
    const token = deferred<string>();
    const controller = new AbortController();
    const { provider, calls, getAccessToken } = rig({ getAccessToken: () => token.promise });
    const outcome = provider.generate(input(), { ...GENERATE, signal: controller.signal }).catch(error => error);
    await Promise.resolve();
    expect(getAccessToken).toHaveBeenCalledOnce();
    controller.abort();
    expect(await outcome).toMatchObject({ code: "cancelled" });
    token.resolve(TOKEN);
    await Promise.resolve();
    expect(calls).toHaveLength(0);
  });

  it("times out an uncooperative fetch with one attempt and no retry", async () => {
    vi.useFakeTimers();
    const upstream = deferred<Response>();
    const { provider, calls } = rig({ upstream: () => upstream.promise, timeoutMs: 10 });
    const outcome = provider.generate(input(), GENERATE).catch(error => error);
    await vi.advanceTimersByTimeAsync(10);
    expect(await outcome).toMatchObject({ code: "upstream_timeout" });
    expect(calls).toHaveLength(1);
    expect(calls[0].init.signal?.aborted).toBe(true);
    upstream.resolve(json());
    await vi.advanceTimersByTimeAsync(20);
    expect(calls).toHaveLength(1);
  });

  it("bounds a stalled response stream under the same deadline", async () => {
    vi.useFakeTimers();
    const cancelled = vi.fn();
    const body = new ReadableStream<Uint8Array>({ cancel: cancelled });
    const { provider, calls } = rig({ upstream: () => new Response(body, { headers: { "content-type": "application/json" } }), timeoutMs: 10 });
    const outcome = provider.generate(input(), GENERATE).catch(error => error);
    await vi.advanceTimersByTimeAsync(10);
    expect(await outcome).toMatchObject({ code: "upstream_timeout" });
    expect(calls).toHaveLength(1);
    expect(cancelled).toHaveBeenCalledOnce();
  });

  it("cancels after provider dispatch without accepting a later reply or retrying", async () => {
    const upstream = deferred<Response>();
    const reachedFetch = deferred<void>();
    const controller = new AbortController();
    const { provider, calls } = rig({ upstream: () => { reachedFetch.resolve(); return upstream.promise; } });
    const outcome = provider.generate(input(), { ...GENERATE, signal: controller.signal }).catch(error => error);
    await reachedFetch.promise;
    controller.abort();
    expect(await outcome).toMatchObject({ code: "cancelled" });
    upstream.resolve(json());
    await Promise.resolve();
    expect(calls).toHaveLength(1);
  });

  it.each([429, 500, 503])("does not retry HTTP %i or expose a provider body", async status => {
    const { provider, calls } = rig({ upstream: () => new Response("private upstream: " + TOKEN, { status }) });
    const error = await provider.generate(input(), GENERATE).catch(error => error);
    expect(error).toMatchObject({ code: "upstream_failed", message: "upstream_failed" });
    expect(String(error)).not.toContain(TOKEN);
    expect(calls).toHaveLength(1);
  });

  it.each(["", "credential\nheader", "has a space", "x".repeat(16_385)])("rejects an invalid bearer credential without echoing it", async token => {
    const { provider, calls } = rig({ getAccessToken: async () => token });
    const error = await provider.generate(input(), GENERATE).catch(error => error);
    expect(error).toMatchObject({ code: "upstream_failed", message: "upstream_failed" });
    expect(calls).toHaveLength(0);
  });

  it("redacts exceptions from the host credential callback", async () => {
    const { provider, calls } = rig({ getAccessToken: async () => { throw new Error(TOKEN); } });
    const error = await provider.generate(input(), GENERATE).catch(error => error);
    expect(error).toMatchObject({ code: "upstream_failed", message: "upstream_failed" });
    expect(String(error)).not.toContain(TOKEN);
    expect(calls).toHaveLength(0);
  });
});

describe("Vertex response contract", () => {
  it("preserves thought usage and counts cached tokens inside the prompt exactly once", async () => {
    const value = responseValue();
    value.promptFeedback = {};
    value.candidates[0].index = 0;
    value.candidates[0].content.parts = [{ text: "First ", thought: false, thoughtSignature: "opaque-not-output" }, { text: "second." }];
    value.usageMetadata = { promptTokenCount: 8, candidatesTokenCount: 4, thoughtsTokenCount: 2, cachedContentTokenCount: 3, totalTokenCount: 14 };
    const { provider } = rig({ upstream: () => json(value) });
    const result = await provider.generate(input(), GENERATE);
    expect(result.payload.analysis).toBe("First second.");
    expect(result.usage).toEqual({ promptTokens: 8, completionTokens: 4, thoughtsTokens: 2, cachedContentTokens: 3, toolUsePromptTokens: 0, totalTokens: 14 });
    expect(JSON.stringify(result)).not.toContain("opaque-not-output");
  });

  const rejectedResponses: Array<[string, (value: Record<string, any>) => void]> = [
    ["truncated output", v => { v.candidates[0].finishReason = "MAX_TOKENS"; }],
    ["continuation request", v => { v.candidates[0].finishReason = "CONTINUATION"; }],
    ["prompt safety block", v => { v.promptFeedback = { blockReason: "SAFETY" }; }],
    ["unspecified prompt block", v => { v.promptFeedback = { blockReason: "BLOCKED_REASON_UNSPECIFIED" }; }],
    ["candidate safety block", v => { v.candidates[0].safetyRatings = [{ blocked: true }]; }],
    ["string candidate block flag", v => { v.candidates[0].safetyRatings = [{ blocked: "false" }]; }],
    ["numeric candidate block flag", v => { v.candidates[0].safetyRatings = [{ blocked: 1 }]; }],
    ["string prompt block flag", v => { v.promptFeedback = { safetyRatings: [{ blocked: "false" }] }; }],
    ["numeric prompt block flag", v => { v.promptFeedback = { safetyRatings: [{ blocked: 1 }] }; }],
    ["multiple candidates", v => { v.candidates.push(structuredClone(v.candidates[0])); }],
    ["nonzero candidate index", v => { v.candidates[0].index = 1; }],
    ["wrong content role", v => { v.candidates[0].content.role = "user"; }],
    ["tool call", v => { v.candidates[0].content.parts = [{ functionCall: { name: "execute", args: {} } }]; }],
    ["mixed text and media", v => { v.candidates[0].content.parts[0].inlineData = { mimeType: "image/png", data: "AA==" }; }],
    ["file reference", v => { v.candidates[0].content.parts = [{ fileData: { fileUri: "gs://bucket/private" } }]; }],
    ["returned thoughts", v => { v.candidates[0].content.parts[0].thought = true; }],
    ["grounding metadata", v => { v.candidates[0].groundingMetadata = {}; }],
    ["URL tool metadata", v => { v.candidates[0].urlContextMetadata = {}; }],
    ["blank text", v => { v.candidates[0].content.parts[0].text = " \n "; }],
    ["invalid Unicode text", v => { v.candidates[0].content.parts[0].text = "bad\ud800"; }],
    ["oversized UTF-8 output", v => { v.candidates[0].content.parts[0].text = "🧪".repeat(2_001); }],
    ["missing provider identity", v => { delete v.modelVersion; }],
    ["unsafe provider response ID", v => { v.responseId = "id\nsecret"; }],
    ["missing usage total", v => { delete v.usageMetadata.totalTokenCount; }],
    ["inconsistent total", v => { v.usageMetadata.totalTokenCount = 13; }],
    ["negative usage", v => { v.usageMetadata.promptTokenCount = -1; }],
    ["fractional usage", v => { v.usageMetadata.candidatesTokenCount = 0.5; }],
    ["string usage", v => { v.usageMetadata.promptTokenCount = "8"; }],
    ["excess cached usage", v => { v.usageMetadata.cachedContentTokenCount = 9; }],
    ["tool-use accounting", v => { v.usageMetadata.toolUsePromptTokenCount = 1; v.usageMetadata.totalTokenCount = 13; }],
    ["output token overflow", v => { v.usageMetadata.candidatesTokenCount = 129; v.usageMetadata.totalTokenCount = 137; }]
  ];
  it.each(rejectedResponses)("rejects %s without treating the reply as completed evidence", async (_name, change) => {
    const value = responseValue();
    change(value);
    const { provider, calls } = rig({ upstream: () => json(value) });
    await expect(provider.generate(input(), GENERATE)).rejects.toMatchObject({ code: "invalid_response" });
    expect(calls).toHaveLength(1);
  });

  it("rejects a redirect even if an injected transport returns otherwise valid JSON", async () => {
    const response = json();
    Object.defineProperty(response, "redirected", { value: true });
    const { provider, calls } = rig({ upstream: () => response });
    await expect(provider.generate(input(), GENERATE)).rejects.toMatchObject({ code: "invalid_response" });
    expect(calls).toHaveLength(1);
  });

  it.each(["text/html", "application/jsonp", ""])("rejects untrusted media type %s before interpretation", async contentType => {
    const { provider } = rig({ upstream: () => new Response(JSON.stringify(responseValue()), { headers: { "content-type": contentType } }) });
    await expect(provider.generate(input(), GENERATE)).rejects.toMatchObject({ code: "invalid_response" });
  });

  it("rejects malformed UTF-8 instead of silently replacing bytes", async () => {
    const { provider } = rig({ upstream: () => new Response(new Uint8Array([0x7b, 0x22, 0x78, 0x22, 0x3a, 0x22, 0xc3, 0x28, 0x22, 0x7d]), { headers: { "content-type": "application/json" } }) });
    await expect(provider.generate(input(), GENERATE)).rejects.toMatchObject({ code: "invalid_response" });
  });

  it("bounds actual streamed bytes despite a misleading Content-Length", async () => {
    let chunk = 0;
    const cancelled = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        chunk += 1;
        controller.enqueue(new Uint8Array(65_537));
      },
      cancel: cancelled
    });
    const { provider, calls } = rig({ upstream: () => new Response(body, { headers: { "content-type": "application/json", "content-length": "2" } }) });
    await expect(provider.generate(input(), GENERATE)).rejects.toMatchObject({ code: "invalid_response" });
    expect(cancelled).toHaveBeenCalledOnce();
    expect(chunk).toBeLessThanOrEqual(3);
    expect(calls).toHaveLength(1);
  });
});
