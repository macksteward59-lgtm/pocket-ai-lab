import { createHash } from "node:crypto";
import { CLOUD_ANALYSIS_LIMITS, CloudAnalysisFailure, type CloudAnalysisRequest } from "./types";

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REQUEST_KEYS = [
  "schemaVersion", "taskID", "attemptID", "profileID", "requestedModel", "inputText",
  "inputSHA256", "consentExpiresAt", "remoteConsent", "maxOutputTokens"
];
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

export function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function isIdentifier(value: unknown): value is string {
  return typeof value === "string" && IDENTIFIER.exec(value)?.[0] === value;
}

export function canonicalAttemptID(value: unknown): string | undefined {
  return typeof value === "string" && value.length === 36 && UUID.test(value) ? value.toLowerCase() : undefined;
}

export function isBoundedText(value: unknown, maximumBytes: number): value is string {
  if (typeof value !== "string" || !value.trim() || value.length > maximumBytes) return false;
  const bytes = encoder.encode(value);
  // Reject unpaired UTF-16 surrogates rather than silently hashing replacement characters.
  return bytes.length <= maximumBytes && decoder.decode(bytes) === value;
}

export function inputSHA256(inputText: string): string {
  return createHash("sha256").update(inputText, "utf8").digest("hex");
}

export function validateCloudAnalysisRequest(value: unknown, now: number): CloudAnalysisRequest {
  if (!isObject(value) || Object.keys(value).length !== REQUEST_KEYS.length ||
      REQUEST_KEYS.some(key => !Object.hasOwn(value, key)) || value.schemaVersion !== 1 ||
      !isIdentifier(value.taskID) || !canonicalAttemptID(value.attemptID) ||
      !isIdentifier(value.profileID) || !isIdentifier(value.requestedModel) ||
      !isBoundedText(value.inputText, CLOUD_ANALYSIS_LIMITS.inputBytes) ||
      typeof value.inputSHA256 !== "string" || value.inputSHA256.length !== 64 || !/^[0-9a-f]{64}$/.test(value.inputSHA256) ||
      !Number.isSafeInteger(value.maxOutputTokens) || Number(value.maxOutputTokens) < 1 ||
      Number(value.maxOutputTokens) > CLOUD_ANALYSIS_LIMITS.outputTokens) {
    throw new CloudAnalysisFailure("invalid_request");
  }
  if (value.remoteConsent !== true) throw new CloudAnalysisFailure("consent_required");
  if (!Number.isSafeInteger(now) || !Number.isSafeInteger(value.consentExpiresAt) ||
      Number(value.consentExpiresAt) <= now ||
      Number(value.consentExpiresAt) > now + CLOUD_ANALYSIS_LIMITS.consentLifetimeMs) {
    throw new CloudAnalysisFailure("consent_expired");
  }
  if (inputSHA256(value.inputText) !== value.inputSHA256) throw new CloudAnalysisFailure("input_mismatch");
  return { ...(value as unknown as CloudAnalysisRequest), attemptID: canonicalAttemptID(value.attemptID)! };
}

/** Race an operation against cancellation, even when an injected implementation ignores its signal. */
export async function withAbort<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    // Consume any eventual rejection of an operation already started by the caller.
    void operation.catch(() => {});
    throw new CloudAnalysisFailure("cancelled");
  }
  let onAbort: (() => void) | undefined;
  const cancelled = new Promise<never>((_resolve, reject) => {
    onAbort = () => reject(new CloudAnalysisFailure("cancelled"));
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try { return await Promise.race([operation, cancelled]); }
  finally { if (onAbort) signal.removeEventListener("abort", onAbort); }
}

/** Bounds actual bytes before UTF-8 decoding or JSON parsing; Content-Length is not trusted. */
export async function readBoundedJSON(
  body: ReadableStream<Uint8Array> | null,
  maximumBytes: number,
  signal: AbortSignal,
  failureCode: "invalid_request" | "invalid_response"
): Promise<unknown> {
  if (!body) throw new CloudAnalysisFailure(failureCode);
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let count = 0;
  let completed = false;
  try {
    while (true) {
      const next = await withAbort(reader.read(), signal);
      if (next.done) { completed = true; break; }
      count += next.value.byteLength;
      if (count > maximumBytes) {
        throw new CloudAnalysisFailure(failureCode === "invalid_request" ? "payload_too_large" : "invalid_response");
      }
      chunks.push(next.value);
    }
    const bytes = new Uint8Array(count);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
    catch { throw new CloudAnalysisFailure(failureCode); }
  } finally {
    if (!completed) void reader.cancel().catch(() => {});
    // A pending read may remain in a deliberately uncooperative injected stream.
    try { reader.releaseLock(); } catch { /* Abort still settles the public operation. */ }
  }
}
