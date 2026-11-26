/**
 * Turns backend text into the dual inference result.
 * Parse failures throw. This module never substitutes a fallback payload.
 */

import type { ZodError } from "zod";
import { LlamaCppInferenceError } from "./errors";
import {
  isLlamaCppDeliberationStage,
  LLAMA_CPP_STAGE_PAYLOAD_SCHEMAS,
  LLAMA_CPP_POLICY_REVIEW_PAYLOAD_SCHEMA
} from "./payloadSchema";
import type { LlamaCppInferenceResult } from "./result";

export function parseLlamaCppOutput(
  stage: string,
  content: string,
  responseContract?: "bug-bounty-policy-review"
): LlamaCppInferenceResult {
  if (typeof content !== "string" || content.trim().length === 0) {
    throw new LlamaCppInferenceError("empty_output", "llama.cpp returned empty output");
  }

  const jsonText = stripJsonFence(stripBom(content).trim());
  if (jsonText.length === 0) {
    throw new LlamaCppInferenceError("empty_output", "llama.cpp returned empty output");
  }

  if (responseContract !== undefined && responseContract !== "bug-bounty-policy-review") {
    throw new LlamaCppInferenceError("invalid_request", "unsupported inference response contract");
  }
  if (!isLlamaCppDeliberationStage(stage)) {
    throw new LlamaCppInferenceError(
      "invalid_request",
      `stage ${JSON.stringify(stage)} has no llama.cpp payload schema`
    );
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(jsonText);
  } catch (error) {
    throw new LlamaCppInferenceError(
      "malformed_response",
      `llama.cpp output is not JSON: ${snippet(jsonText)}`,
      { cause: error }
    );
  }

  if (!isPlainObject(parsedJson)) {
    throw new LlamaCppInferenceError(
      "malformed_response",
      `llama.cpp output must be a JSON object, received ${receivedKind(parsedJson)}`
    );
  }

  const schema = responseContract === "bug-bounty-policy-review"
    ? LLAMA_CPP_POLICY_REVIEW_PAYLOAD_SCHEMA
    : LLAMA_CPP_STAGE_PAYLOAD_SCHEMAS[stage];
  const parsed = schema.safeParse(parsedJson);
  if (!parsed.success) {
    throw new LlamaCppInferenceError(
      "malformed_response",
      `llama.cpp output does not match the ${stage} payload schema: ${formatZodError(parsed.error)}`
    );
  }

  const payload = parsed.data as Record<string, unknown>;
  const result: LlamaCppInferenceResult = {
    text: content,
    payload
  };
  if (Array.isArray(payload.evidenceRefs) && payload.evidenceRefs.every(ref => typeof ref === "string")) {
    result.evidenceRefs = payload.evidenceRefs as string[];
  }
  if (typeof payload.confidence === "number" && Number.isFinite(payload.confidence)) {
    result.confidence = payload.confidence;
  }
  return deepFreeze(result);
}

function stripBom(value: string): string {
  return value.charCodeAt(0) === 0xfeff ? value.slice(1) : value;
}

function stripJsonFence(value: string): string {
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(value);
  return fenced ? fenced[1].trim() : value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function receivedKind(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function formatZodError(error: ZodError): string {
  return error.issues.map(issue => {
    const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
    return `${path}: ${issue.message}`;
  }).join("; ");
}

function snippet(value: string): string {
  const compact = value.replace(/\s+/g, " ").trim();
  return compact.length > 180 ? `${compact.slice(0, 180)}…` : compact;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}
