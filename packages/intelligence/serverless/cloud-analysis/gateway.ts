import { DeepSeekAnalysisProvider } from "./DeepSeekAnalysisProvider";
import {
  CLOUD_ANALYSIS_LIMITS, CLOUD_ANALYSIS_PATH, CloudAnalysisFailure, errorResponse,
  type CloudAnalysisErrorCode, type CloudAnalysisResponse
} from "./types";
import { canonicalAttemptID, isIdentifier, isObject, readBoundedJSON, validateCloudAnalysisRequest, withAbort } from "./validation";

export interface CloudAnalysisProfile {
  profileID: string;
  model: string;
}

export interface CloudAnalysisGatewayOptions {
  enabled?: boolean;
  profile?: CloudAnalysisProfile;
  provider?: DeepSeekAnalysisProvider;
  /** Application authentication, independent of the provider credential. Must return literal true. */
  authenticate?: (authorizationHeader: string | undefined) => boolean | Promise<boolean>;
  now?: () => number;
  /** A smaller test/deployment bound is allowed; no eviction or distributed guarantee. */
  maxReplayEntries?: number;
}

export type CloudAnalysisHandler = (request: Request) => Promise<Response>;

const ERROR_STATUS: Record<CloudAnalysisErrorCode, number> = {
  disabled: 503, unauthenticated: 401, invalid_request: 400, consent_required: 403,
  consent_expired: 403, profile_mismatch: 409, input_mismatch: 400, payload_too_large: 413,
  busy: 429, capacity: 503, unsupported_media_type: 415, method_not_allowed: 405,
  not_found: 404, duplicate_attempt: 409, upstream_timeout: 504, upstream_failed: 502,
  invalid_response: 502, cancelled: 499, internal_error: 500
};

export function cloudAnalysisError(code: CloudAnalysisErrorCode): Response {
  return new Response(JSON.stringify(errorResponse(code)), {
    status: ERROR_STATUS[code],
    headers: { "content-type": "application/json", "cache-control": "no-store" }
  });
}

/**
 * An explicit text-only endpoint. It does not schedule jobs, execute tools, write memory,
 * issue authorization receipts, retry requests, or claim durable/cross-process idempotency.
 */
export function createCloudAnalysisHandler(options: CloudAnalysisGatewayOptions = {}): CloudAnalysisHandler {
  if (options.enabled !== true) return async () => cloudAnalysisError("disabled");
  const provider = options.provider;
  const authenticate = options.authenticate;
  const profile = options.profile ? { ...options.profile } : undefined;
  if (!provider || !profile || !isIdentifier(profile.profileID) || !isIdentifier(profile.model) ||
      profile.model !== provider.requestedModel || typeof authenticate !== "function") {
    throw new Error("An enabled cloud analysis endpoint requires a matching profile, provider and authenticator.");
  }
  const maxReplayEntries = options.maxReplayEntries ?? CLOUD_ANALYSIS_LIMITS.replayEntries;
  if (!Number.isSafeInteger(maxReplayEntries) || maxReplayEntries < 1 || maxReplayEntries > CLOUD_ANALYSIS_LIMITS.replayEntries) {
    throw new Error("Cloud analysis replay capacity is outside the supported limit.");
  }
  const now = options.now ?? Date.now;
  const consumedIDs = new Set<string>();
  let activeRequests = 0;

  return async function handle(request: Request): Promise<Response> {
    const controller = new AbortController();
    const onCancel = () => controller.abort();
    request.signal.addEventListener("abort", onCancel, { once: true });
    if (request.signal.aborted) controller.abort();
    const timer = setTimeout(() => controller.abort(), CLOUD_ANALYSIS_LIMITS.timeoutMs + 1_000);
    let admitted = false;
    let dispatched = false;
    try {
      const url = new URL(request.url);
      if (url.pathname !== CLOUD_ANALYSIS_PATH || url.search) return cloudAnalysisError("not_found");
      if (request.method !== "POST") return cloudAnalysisError("method_not_allowed");
      const authenticated = await withAbort(Promise.resolve(authenticate(request.headers.get("authorization") ?? undefined)), controller.signal);
      if (authenticated !== true) return cloudAnalysisError("unauthenticated");
      if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? "")) {
        return cloudAnalysisError("unsupported_media_type");
      }
      const value = await readBoundedJSON(request.body, CLOUD_ANALYSIS_LIMITS.requestBytes, controller.signal, "invalid_request");
      const attemptID = isObject(value) ? canonicalAttemptID(value.attemptID) : undefined;
      // A repeat may already have reached the provider, even if its other fields changed.
      if (attemptID && consumedIDs.has(attemptID)) return cloudAnalysisError("duplicate_attempt");
      const input = validateCloudAnalysisRequest(value, now());
      if (input.profileID !== profile.profileID || input.requestedModel !== profile.model) {
        return cloudAnalysisError("profile_mismatch");
      }
      if (activeRequests !== 0) return cloudAnalysisError("busy");
      if (consumedIDs.size >= maxReplayEntries) return cloudAnalysisError("capacity");
      if (controller.signal.aborted) return cloudAnalysisError("cancelled");
      // No await between admission and consumption. Never evict: refreshed client expiry
      // must not make a previously consumed UUID appear new in this process.
      consumedIDs.add(input.attemptID);
      activeRequests += 1;
      admitted = true;
      dispatched = true;
      const result = await provider.generate({
        agentId: "cloud-analysis",
        modelId: profile.model,
        prompt: input.inputText,
        stage: "independent",
        contextMessages: []
      }, { signal: controller.signal, maxOutputTokens: input.maxOutputTokens });
      if (controller.signal.aborted) return cloudAnalysisError("cancelled");
      const payload: CloudAnalysisResponse = {
        schemaVersion: 1,
        taskID: input.taskID,
        attemptID: input.attemptID,
        profileID: input.profileID,
        requestedModel: input.requestedModel,
        inputSHA256: input.inputSHA256,
        execution: "cloud",
        providerID: result.providerID,
        actualModel: result.actualModel,
        providerResponseID: result.providerResponseID,
        text: result.payload.analysis,
        usage: result.usage,
        finishReason: result.finishReason,
        authorized: false
      };
      const serialized = JSON.stringify(payload);
      if (new TextEncoder().encode(serialized).length > CLOUD_ANALYSIS_LIMITS.gatewayResponseBytes) {
        return cloudAnalysisError("invalid_response");
      }
      return new Response(serialized, {
        status: 200,
        headers: { "content-type": "application/json", "cache-control": "no-store" }
      });
    } catch (error) {
      if (error instanceof CloudAnalysisFailure) {
        // A provider/library failure must never downgrade an admitted attempt to not_started.
        if (dispatched && errorResponse(error.code).error.remoteOutcome === "not_started") {
          return cloudAnalysisError("internal_error");
        }
        return cloudAnalysisError(error.code);
      }
      return cloudAnalysisError("internal_error");
    } finally {
      if (admitted) activeRequests -= 1;
      clearTimeout(timer);
      request.signal.removeEventListener("abort", onCancel);
    }
  };
}
