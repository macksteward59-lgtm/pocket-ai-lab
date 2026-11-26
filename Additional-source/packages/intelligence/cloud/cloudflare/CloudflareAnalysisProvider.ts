import type { InferenceProvider, InferenceRequest, InferenceResult } from "../../orchestrator/Orchestrator";
import { CLOUD_ANALYSIS_LIMITS, CloudAnalysisFailure } from "../../serverless/cloud-analysis/types";
import { isBoundedText, isObject, readBoundedJSON, withAbort } from "../../serverless/cloud-analysis/validation";
import type { SelectedTextPurpose } from "../shared/selectedTextContract";
import {
  CloudflareJobFailure, cloudflareEndpoint, cloudflareRequestBody, validateCloudflareDestination,
  type CloudflareDestination, type CloudflareJobErrorCode
} from "./contracts";
import { CLOUDFLARE_AGENT_ID } from "./profile";

export interface CloudflareAnalysisOptions {
  enabled: true;
  destination: CloudflareDestination;
  /** Runtime-scoped, server-held token. This callback is not an authorization grant. */
  getAccessToken: (signal: AbortSignal) => Promise<string>;
  timeoutMs?: number;
  now?: () => number;
  fetchImpl?: typeof fetch;
}
export interface CloudflareGenerateOptions {
  purpose: SelectedTextPurpose;
  maxOutputTokens: number;
  consentExpiresAt: number;
  signal?: AbortSignal;
  /** Host independently binds the exact preview/request, release, budget, task and receipt. */
  authorizeDispatch: () => boolean | Promise<boolean>;
  /** Synchronous final host check, e.g. its durable claim and revocation state. Must return void. */
  assertCanDispatch: () => void;
}
export interface CloudflareUsage {
  reported: boolean;
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
  cachedPromptTokens: number | null;
  /** Current verified schema does not establish a separate reasoning-token counter. */
  reasoningTokens: null;
}
export interface CloudflareAnalysisResult extends InferenceResult {
  payload: { analysis: string };
  providerID: "cloudflare-workers-ai";
  requestedModel: string;
  /** Provider-reported metadata, not a proved model revision or weight attestation. */
  returnedModel: string | null;
  providerResponseID: string | null;
  usage: CloudflareUsage;
  reasoningOutputDiscarded: boolean;
  finishReason: "stop";
  authorized: false;
  verified: false;
}

/**
 * Bounded transport only: no worker, listener, persistent store, retries or default host authority.
 * The host must independently verify the preview and reserve its attempt before using this adapter.
 * Callback success and a returned text result do not issue a receipt or prove billing/quality.
 */
export class CloudflareAnalysisProvider implements InferenceProvider {
  readonly providerID = "cloudflare-workers-ai" as const;
  readonly destination: CloudflareDestination;
  readonly endpoint: string;
  readonly requestedModel: string;
  private readonly getAccessToken: CloudflareAnalysisOptions["getAccessToken"];
  private readonly timeoutMs: number;
  private readonly now: () => number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: CloudflareAnalysisOptions) {
    if (options?.enabled !== true || typeof options.getAccessToken !== "function" ||
        (options.now !== undefined && typeof options.now !== "function")) {
      throw new CloudflareJobFailure("invalid_configuration");
    }
    this.destination = Object.freeze(validateCloudflareDestination(options.destination));
    this.endpoint = cloudflareEndpoint(this.destination);
    this.requestedModel = this.destination.modelID;
    this.getAccessToken = options.getAccessToken;
    this.timeoutMs = options.timeoutMs ?? CLOUD_ANALYSIS_LIMITS.timeoutMs;
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs < 1 || this.timeoutMs > CLOUD_ANALYSIS_LIMITS.timeoutMs) {
      throw new CloudflareJobFailure("invalid_configuration");
    }
    this.now = options.now ?? Date.now;
    this.fetchImpl = options.fetchImpl ?? fetch;
    Object.freeze(this);
  }

  async generate(request: InferenceRequest, options?: CloudflareGenerateOptions): Promise<CloudflareAnalysisResult> {
    if (!options || typeof options.authorizeDispatch !== "function" || typeof options.assertCanDispatch !== "function") {
      throw new CloudflareJobFailure("approval_required");
    }
    // Snapshot all per-call options before awaiting any host operation.
    const { purpose, maxOutputTokens, consentExpiresAt, signal, authorizeDispatch, assertCanDispatch } = options;
    if (!request || request.agentId !== CLOUDFLARE_AGENT_ID || request.modelId !== this.requestedModel ||
        request.stage !== "independent" || !Array.isArray(request.contextMessages) || request.contextMessages.length !== 0 ||
        request.conversation !== undefined || request.memoryContext !== undefined) {
      throw new CloudflareJobFailure("invalid_request");
    }
    const body = cloudflareRequestBody(request.prompt, purpose, maxOutputTokens);
    const startedAt = this.readClock();
    if (!Number.isSafeInteger(consentExpiresAt) || consentExpiresAt <= startedAt ||
        consentExpiresAt > startedAt + CLOUD_ANALYSIS_LIMITS.consentLifetimeMs) {
      throw new CloudflareJobFailure("consent_expired");
    }
    if (signal?.aborted) throw new CloudflareJobFailure("cancelled");

    const controller = new AbortController();
    const onAbort = () => controller.abort();
    signal?.addEventListener("abort", onAbort, { once: true });
    let dispatched = false;
    let ownedResponse: Response | undefined;
    let timerFailure: "consent_expired" | "deadline_exceeded" | undefined;
    const remainingConsent = consentExpiresAt - startedAt;
    const timer = setTimeout(() => {
      timerFailure = remainingConsent <= this.timeoutMs ? "consent_expired" : "deadline_exceeded";
      controller.abort();
    }, Math.min(remainingConsent, this.timeoutMs));
    const fail = (code: CloudflareJobErrorCode): never => {
      throw new CloudflareJobFailure(code, dispatched ? "unknown" : "not_started");
    };
    const checkCurrent = () => {
      if (controller.signal.aborted) fail(timerFailure ?? "cancelled");
      const now = this.readClock();
      if (now >= consentExpiresAt) fail("consent_expired");
      if (now >= startedAt + this.timeoutMs) fail("deadline_exceeded");
    };
    const verify = async () => {
      checkCurrent();
      let allowed: boolean;
      try {
        allowed = await withAbort(Promise.resolve().then(() => {
          checkCurrent();
          return authorizeDispatch();
        }), controller.signal);
      } catch {
        checkCurrent();
        return fail("approval_denied");
      }
      checkCurrent();
      if (allowed !== true) fail("approval_denied");
    };

    try {
      await verify();
      const token = await withAbort(Promise.resolve().then(() => {
        checkCurrent();
        return this.getAccessToken(controller.signal);
      }), controller.signal);
      checkCurrent();
      if (typeof token !== "string" || token.length < 1 || token.length > 16_384 ||
          /^[A-Za-z0-9._~+/-]+=*$/.exec(token)?.[0] !== token) fail("upstream_failed");
      // A credential wait cannot carry a revoked/expired authorization into HTTP.
      await verify();
      try {
        const returned = assertCanDispatch();
        if (returned !== undefined) {
          // An accidentally async assertion is not a synchronous final gate.
          void Promise.resolve(returned).catch(() => {});
          fail("approval_denied");
        }
      } catch {
        checkCurrent();
        fail("approval_denied");
      }
      checkCurrent();
      dispatched = true;
      const pendingResponse = this.fetchImpl(this.endpoint, {
        method: "POST", redirect: "error", cache: "no-store",
        headers: { authorization: "Bearer " + token, "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify(body), signal: controller.signal
      }).then(response => {
        ownedResponse = response;
        // An injected/uncooperative transport can resolve after the abort race has ended.
        if (controller.signal.aborted) void response.body?.cancel().catch(() => {});
        return response;
      });
      const response = await withAbort(pendingResponse, controller.signal);
      checkCurrent();
      if (!response.ok) {
        fail("upstream_failed");
      }
      if (response.redirected || !/^application\/json(?:\s*;|$)/i.test(response.headers.get("content-type") ?? "")) {
        fail("invalid_response");
      }
      const value = await readBoundedJSON(response.body, CLOUD_ANALYSIS_LIMITS.providerResponseBytes, controller.signal, "invalid_response");
      checkCurrent();
      return this.parseResponse(value);
    } catch (error) {
      if (controller.signal.aborted) return fail(timerFailure ?? "cancelled");
      if (error instanceof CloudflareJobFailure) return fail(error.code);
      if (error instanceof CloudAnalysisFailure && error.code === "invalid_response") return fail("invalid_response");
      return fail("upstream_failed");
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      // Classification above is retained; cleanup also covers a clock jump after headers arrive.
      controller.abort();
      void ownedResponse?.body?.cancel().catch(() => {});
    }
  }

  private readClock(): number {
    let value: number;
    try { value = this.now(); } catch { throw new CloudflareJobFailure("invalid_configuration"); }
    if (!Number.isSafeInteger(value) || value < 0 || value > 8_640_000_000_000_000 - CLOUD_ANALYSIS_LIMITS.consentLifetimeMs) {
      throw new CloudflareJobFailure("invalid_configuration");
    }
    return value;
  }

  private parseResponse(value: unknown): CloudflareAnalysisResult {
    const invalid = (): never => { throw new CloudflareJobFailure("invalid_response", "unknown"); };
    if (!isObject(value) || (value.object !== undefined && value.object !== "chat.completion") ||
        !Array.isArray(value.choices) || value.choices.length !== 1 ||
        (value.error !== undefined && value.error !== null) ||
        (value.success !== undefined && value.success !== true)) return invalid();
    if (value.errors !== undefined && (!Array.isArray(value.errors) || value.errors.length !== 0)) return invalid();
    const choice = value.choices[0];
    if (!isObject(choice) || (choice.index !== undefined && choice.index !== 0) ||
        choice.finish_reason !== "stop" || !isObject(choice.message)) return invalid();
    const message = choice.message;
    if (message.role !== "assistant" || !isBoundedText(message.content, CLOUD_ANALYSIS_LIMITS.outputBytes)) return invalid();
    for (const key of ["tool_calls", "server_tool_calls"]) {
      if (message[key] !== undefined && message[key] !== null &&
          (!Array.isArray(message[key]) || (message[key] as unknown[]).length !== 0)) return invalid();
    }
    for (const key of ["function_call", "audio", "images", "video", "attachments", "refusal"]) {
      if (message[key] !== undefined && message[key] !== null && message[key] !== "") return invalid();
    }
    let reasoningOutputDiscarded = false;
    for (const key of ["reasoning_content", "reasoning"]) {
      const text = message[key];
      if (text === undefined || text === null) continue;
      if (typeof text !== "string" || text.length > CLOUD_ANALYSIS_LIMITS.providerResponseBytes) return invalid();
      const bytes = new TextEncoder().encode(text);
      if (bytes.length > CLOUD_ANALYSIS_LIMITS.providerResponseBytes || new TextDecoder().decode(bytes) !== text) return invalid();
      reasoningOutputDiscarded ||= text.length > 0;
    }
    const reportedText = (text: unknown, maximum: number): string | null => {
      if (text === undefined || text === null) return null;
      if (!isBoundedText(text, maximum) || /[\u0000-\u0020\u007f]/.test(text)) return invalid();
      return text;
    };
    const returnedModel = reportedText(value.model, 256);
    const providerResponseID = reportedText(value.id, 512);
    if (value.usage !== undefined && value.usage !== null && !isObject(value.usage)) return invalid();
    const usage = isObject(value.usage) ? value.usage : undefined;
    const counter = (count: unknown): number | null => {
      if (count === undefined) return null;
      if (!Number.isSafeInteger(count) || Number(count) < 0) return invalid();
      return Number(count);
    };
    const promptTokens = counter(usage?.prompt_tokens);
    const completionTokens = counter(usage?.completion_tokens);
    const totalTokens = counter(usage?.total_tokens);
    const details = usage?.prompt_tokens_details;
    if (details !== undefined && details !== null && !isObject(details)) return invalid();
    const cachedPromptTokens = counter(isObject(details) ? details.cached_tokens : undefined);
    if (promptTokens !== null && cachedPromptTokens !== null && cachedPromptTokens > promptTokens) return invalid();
    // Keep reported counts, including totals, without guessing absent counters or reasoning semantics.
    return {
      payload: { analysis: message.content }, providerID: this.providerID, requestedModel: this.requestedModel,
      returnedModel, providerResponseID,
      usage: { reported: usage !== undefined, promptTokens, completionTokens, totalTokens, cachedPromptTokens, reasoningTokens: null },
      reasoningOutputDiscarded, finishReason: "stop", authorized: false, verified: false
    };
  }
}
