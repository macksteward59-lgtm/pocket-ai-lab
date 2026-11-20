import type { InferenceProvider, InferenceRequest, InferenceResult } from "../../orchestrator/Orchestrator";
import { CLOUD_ANALYSIS_LIMITS, CloudAnalysisFailure } from "../../serverless/cloud-analysis/types";
import { isBoundedText, isObject, readBoundedJSON, withAbort } from "../../serverless/cloud-analysis/validation";
import { GoogleCloudJobFailure, validateDestination, vertexEndpoint, vertexRequestBody, type VertexDestination, type VertexUsage } from "./contracts";
import { GOOGLE_CLOUD_AGENT_ID, type GoogleCloudPurpose } from "./profile";

export interface VertexAnalysisOptions {
  enabled: true;
  destination: VertexDestination;
  /** Trusted host supplies ADC/workload-identity credentials; never included in previews. */
  getAccessToken: (signal: AbortSignal) => Promise<string>;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}
export interface VertexAnalysisResult extends InferenceResult {
  payload: { analysis: string };
  providerID: "google-vertex";
  requestedModel: string;
  actualModel: string;
  providerResponseID: string;
  usage: VertexUsage;
  finishReason: "STOP";
}
export interface VertexGenerateOptions {
  purpose: GoogleCloudPurpose;
  maxOutputTokens: number;
  signal?: AbortSignal;
  /** Revalidate independent host authorization after asynchronous credential acquisition. */
  authorizeDispatch?: () => Promise<void>;
  /** Synchronous host recheck immediately before the outbound request, after credential acquisition. */
  assertCanDispatch?: () => void;
}

/** One regional text request. No listener, credential lookup, registration or network on import. */
export class VertexAnalysisProvider implements InferenceProvider {
  readonly providerID = "google-vertex" as const;
  readonly destination: VertexDestination;
  readonly endpoint: string;
  readonly requestedModel: string;
  private readonly getAccessToken: VertexAnalysisOptions["getAccessToken"];
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;

  constructor(options: VertexAnalysisOptions) {
    if (options?.enabled !== true || typeof options.getAccessToken !== "function") {
      throw new Error("An explicitly enabled Vertex provider and host credential callback are required.");
    }
    this.destination = Object.freeze(validateDestination(options.destination));
    this.endpoint = vertexEndpoint(this.destination);
    this.requestedModel = this.destination.modelID;
    this.getAccessToken = options.getAccessToken;
    this.timeoutMs = options.timeoutMs ?? CLOUD_ANALYSIS_LIMITS.timeoutMs;
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs < 1 || this.timeoutMs > CLOUD_ANALYSIS_LIMITS.timeoutMs) {
      throw new Error("Vertex timeout is outside the bounded profile.");
    }
    this.fetchImpl = options.fetchImpl ?? fetch;
    Object.freeze(this);
  }

  async generate(request: InferenceRequest, options: VertexGenerateOptions = {
    purpose: "documentation", maxOutputTokens: CLOUD_ANALYSIS_LIMITS.outputTokens
  }): Promise<VertexAnalysisResult> {
    const { purpose, maxOutputTokens, signal, authorizeDispatch, assertCanDispatch } = options;
    if (!request || request.agentId !== GOOGLE_CLOUD_AGENT_ID || request.modelId !== this.requestedModel ||
        request.stage !== "independent" || !Array.isArray(request.contextMessages) || request.contextMessages.length !== 0 ||
        request.conversation !== undefined || request.memoryContext !== undefined) {
      throw new CloudAnalysisFailure("invalid_request");
    }
    // Build the very same body that the pure preview constructor displays.
    const body = vertexRequestBody(request.prompt, purpose, maxOutputTokens);
    if (signal?.aborted) throw new CloudAnalysisFailure("cancelled");
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    signal?.addEventListener("abort", onAbort, { once: true });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, this.timeoutMs);
    try {
      const token = await withAbort(Promise.resolve().then(() => {
        if (controller.signal.aborted) throw new CloudAnalysisFailure("cancelled");
        return this.getAccessToken(controller.signal);
      }), controller.signal);
      if (controller.signal.aborted) throw new CloudAnalysisFailure("cancelled");
      // RFC 6750 bearer token characters, bounded before creating headers; no raw errors escape.
      if (typeof token !== "string" || token.length < 1 || token.length > 16_384 ||
          /^[A-Za-z0-9._~+/-]+=*$/.exec(token)?.[0] !== token) throw new CloudAnalysisFailure("upstream_failed");
      if (authorizeDispatch) {
        await withAbort(Promise.resolve().then(() => {
          if (controller.signal.aborted) throw new CloudAnalysisFailure("cancelled");
          return authorizeDispatch();
        }), controller.signal);
      }
      assertCanDispatch?.();
      if (controller.signal.aborted) throw new CloudAnalysisFailure("cancelled");
      const response = await withAbort(this.fetchImpl(this.endpoint, {
        method: "POST", redirect: "error", cache: "no-store",
        headers: { authorization: "Bearer " + token, "content-type": "application/json", accept: "application/json" },
        // Identity, release, task, attempt, digest, receipt and credentials are never in the body.
        body: JSON.stringify(body), signal: controller.signal
      }), controller.signal);
      if (!response.ok) {
        void response.body?.cancel().catch(() => {});
        throw new CloudAnalysisFailure("upstream_failed");
      }
      if (response.redirected || !/^application\/json(?:\s*;|$)/i.test(response.headers.get("content-type") ?? "")) {
        void response.body?.cancel().catch(() => {});
        throw new CloudAnalysisFailure("invalid_response");
      }
      const value = await readBoundedJSON(response.body, CLOUD_ANALYSIS_LIMITS.providerResponseBytes, controller.signal, "invalid_response");
      if (controller.signal.aborted) throw new CloudAnalysisFailure("cancelled");
      return this.parseResponse(value, maxOutputTokens);
    } catch (error) {
      if (timedOut) throw new CloudAnalysisFailure("upstream_timeout");
      if (signal?.aborted) throw new CloudAnalysisFailure("cancelled");
      if (error instanceof CloudAnalysisFailure) throw error;
      if (error instanceof GoogleCloudJobFailure) throw error;
      throw new CloudAnalysisFailure("upstream_failed");
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }
  }

  private parseResponse(value: unknown, maxOutputTokens: number): VertexAnalysisResult {
    const invalid = (): never => { throw new CloudAnalysisFailure("invalid_response"); };
    const metadataText = (text: unknown, maximum: number): text is string =>
      isBoundedText(text, maximum) && !/[\u0000-\u0020\u007f]/.test(text);
    if (!isObject(value) || !metadataText(value.modelVersion, 256) || !metadataText(value.responseId, 512) ||
        !Array.isArray(value.candidates) || value.candidates.length !== 1 || !isObject(value.usageMetadata)) return invalid();
    if (value.promptFeedback !== undefined) {
      if (!isObject(value.promptFeedback) || Object.hasOwn(value.promptFeedback, "blockReason")) return invalid();
    }
    const validSafety = (ratings: unknown): boolean => ratings === undefined ||
      (Array.isArray(ratings) && ratings.every(rating => isObject(rating) &&
        (rating.blocked === undefined || rating.blocked === false)));
    if (isObject(value.promptFeedback) && !validSafety(value.promptFeedback.safetyRatings)) return invalid();
    const candidate = value.candidates[0];
    if (!isObject(candidate) || (candidate.index !== undefined && candidate.index !== 0) ||
        candidate.finishReason !== "STOP" || !isObject(candidate.content) || candidate.content.role !== "model" ||
        !Array.isArray(candidate.content.parts) || candidate.content.parts.length < 1 || candidate.content.parts.length > 32) return invalid();
    if (!validSafety(candidate.safetyRatings)) return invalid();
    // A tool-free request cannot turn returned tool/grounding metadata into trusted evidence.
    if (candidate.groundingMetadata !== undefined || candidate.urlContextMetadata !== undefined) return invalid();
    let text = "";
    for (const part of candidate.content.parts) {
      if (!isObject(part) || Object.keys(part).some(key => !["text", "thought", "thoughtSignature"].includes(key)) ||
          typeof part.text !== "string" || (part.thought !== undefined && part.thought !== false) ||
          (part.thoughtSignature !== undefined && typeof part.thoughtSignature !== "string")) return invalid();
      text += part.text;
      if (text.length > CLOUD_ANALYSIS_LIMITS.outputBytes) return invalid();
    }
    if (!isBoundedText(text, CLOUD_ANALYSIS_LIMITS.outputBytes)) return invalid();
    const usage = value.usageMetadata;
    const counter = (key: string, optional = false): number => {
      const count = usage[key] === undefined && optional ? 0 : usage[key];
      if (!Number.isSafeInteger(count) || Number(count) < 0) return invalid();
      return Number(count);
    };
    const promptTokens = counter("promptTokenCount");
    const completionTokens = counter("candidatesTokenCount");
    const totalTokens = counter("totalTokenCount");
    const thoughtsTokens = counter("thoughtsTokenCount", true);
    const cachedContentTokens = counter("cachedContentTokenCount", true);
    const toolUsePromptTokens = counter("toolUsePromptTokenCount", true);
    // Cached tokens are already part of promptTokens. Model-default thinking is disclosed separately.
    const expectedTotal = promptTokens + completionTokens + thoughtsTokens + toolUsePromptTokens;
    if (toolUsePromptTokens !== 0 || cachedContentTokens > promptTokens || completionTokens > maxOutputTokens ||
        !Number.isSafeInteger(expectedTotal) || totalTokens !== expectedTotal) return invalid();
    return {
      payload: { analysis: text }, providerID: this.providerID, requestedModel: this.requestedModel,
      actualModel: value.modelVersion, providerResponseID: value.responseId,
      usage: { promptTokens, completionTokens, totalTokens, thoughtsTokens, cachedContentTokens, toolUsePromptTokens: 0 },
      finishReason: "STOP"
    };
  }
}
