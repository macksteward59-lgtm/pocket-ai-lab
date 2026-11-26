/** A bounded text-analysis exchange. None of these records grants action authority. */
export const CLOUD_ANALYSIS_PATH = "/v1/cloud-analysis";

export const CLOUD_ANALYSIS_LIMITS = Object.freeze({
  requestBytes: 32 * 1024,
  inputBytes: 4_000,
  outputBytes: 8_000,
  providerResponseBytes: 128 * 1024,
  gatewayResponseBytes: 64 * 1024,
  outputTokens: 512,
  consentLifetimeMs: 300_000,
  timeoutMs: 45_000,
  replayEntries: 1_024
});

export interface CloudAnalysisRequest {
  schemaVersion: 1;
  taskID: string;
  attemptID: string;
  profileID: string;
  requestedModel: string;
  inputText: string;
  inputSHA256: string;
  consentExpiresAt: number;
  remoteConsent: true;
  maxOutputTokens: number;
}

export interface CloudAnalysisUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface CloudAnalysisResponse {
  schemaVersion: 1;
  taskID: string;
  attemptID: string;
  profileID: string;
  requestedModel: string;
  inputSHA256: string;
  execution: "cloud";
  providerID: "deepseek";
  actualModel: string;
  providerResponseID: string;
  text: string;
  usage: CloudAnalysisUsage;
  finishReason: "stop";
  authorized: false;
}

export const NOT_STARTED_CODES = [
  "disabled", "unauthenticated", "invalid_request", "consent_required",
  "consent_expired", "profile_mismatch", "input_mismatch", "payload_too_large",
  "busy", "capacity", "unsupported_media_type", "method_not_allowed", "not_found"
] as const;
export const UNKNOWN_OUTCOME_CODES = [
  "duplicate_attempt", "upstream_timeout", "upstream_failed", "invalid_response",
  "cancelled", "internal_error"
] as const;
export type CloudAnalysisErrorCode = typeof NOT_STARTED_CODES[number] | typeof UNKNOWN_OUTCOME_CODES[number];

export interface CloudAnalysisErrorResponse {
  schemaVersion: 1;
  error: { code: CloudAnalysisErrorCode; remoteOutcome: "not_started" | "unknown" };
}

/** Safe, fixed public codes only; never include provider bodies or request content. */
export class CloudAnalysisFailure extends Error {
  readonly code: CloudAnalysisErrorCode;
  constructor(code: CloudAnalysisErrorCode) {
    super(code);
    this.name = "CloudAnalysisFailure";
    this.code = code;
  }
}

export function errorResponse(code: CloudAnalysisErrorCode): CloudAnalysisErrorResponse {
  return {
    schemaVersion: 1,
    error: {
      code,
      remoteOutcome: (NOT_STARTED_CODES as readonly string[]).includes(code) ? "not_started" : "unknown"
    }
  };
}
