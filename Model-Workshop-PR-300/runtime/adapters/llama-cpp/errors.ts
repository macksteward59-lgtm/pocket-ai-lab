/**
 * Typed failures for the llama.cpp adapter.
 * A failure is always thrown. Callers must not treat error text as model output.
 */

export type LlamaCppErrorCode =
  | "invalid_config"
  | "invalid_request"
  | "backend_unreachable"
  | "timeout"
  | "cancelled"
  | "http_error"
  | "malformed_response"
  | "empty_output";

export class LlamaCppInferenceError extends Error {
  readonly code: LlamaCppErrorCode;
  readonly status?: number;

  constructor(
    code: LlamaCppErrorCode,
    message: string,
    options?: { status?: number; cause?: unknown }
  ) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "LlamaCppInferenceError";
    this.code = code;
    this.status = options?.status;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export function isAbortError(error: unknown): boolean {
  const name = readErrorName(error);
  if (name === "AbortError" || name === "TimeoutError") return true;
  if (error && typeof error === "object" && "cause" in error) {
    const causeName = readErrorName((error as { cause: unknown }).cause);
    return causeName === "AbortError" || causeName === "TimeoutError";
  }
  return false;
}

function readErrorName(error: unknown): string {
  if (!error || typeof error !== "object" || !("name" in error)) return "";
  return String((error as { name: unknown }).name);
}

export function classifyAbort(
  timeoutSignal: AbortSignal,
  userSignal: AbortSignal | undefined,
  timeoutMs: number
): LlamaCppInferenceError {
  if (userSignal?.aborted) {
    return new LlamaCppInferenceError("cancelled", "Inference cancelled");
  }
  if (timeoutSignal.aborted) {
    return new LlamaCppInferenceError(
      "timeout",
      `llama.cpp inference timed out after ${timeoutMs}ms`
    );
  }
  return new LlamaCppInferenceError("cancelled", "Inference cancelled");
}
