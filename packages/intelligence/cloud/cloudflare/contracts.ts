import { CLOUD_ANALYSIS_LIMITS } from "../../serverless/cloud-analysis/types";
import { canonicalAttemptID, inputSHA256, isBoundedText, isIdentifier } from "../../serverless/cloud-analysis/validation";
import {
  SELECTED_TEXT_PURPOSES, PURPOSE_INSTRUCTIONS, canonicalJSON, clonePlainJSON,
  exactKeys, freeze, match, validateComponentRelease,
  type ComponentRelease, type SelectedTextPurpose
} from "../shared/selectedTextContract";
import { CLOUDFLARE_AGENT_ID, CLOUDFLARE_COMPONENT_ID } from "./profile";
import type { CloudflareUsage } from "./CloudflareAnalysisProvider";

export const CLOUDFLARE_ANALYSIS_MODELS = Object.freeze(["@cf/openai/gpt-oss-120b"] as const);
export type CloudflareAnalysisModel = typeof CLOUDFLARE_ANALYSIS_MODELS[number];
export interface CloudflareDestination { accountID: string; modelID: CloudflareAnalysisModel }
export interface CloudflareRequestBody {
  model: CloudflareAnalysisModel;
  messages: [{ role: "system"; content: string }, { role: "user"; content: string }];
  reasoning_effort: "low";
  max_tokens: number;
  stream: false;
}
export interface CloudflarePreview {
  schemaVersion: 1;
  agentID: typeof CLOUDFLARE_AGENT_ID;
  componentID: typeof CLOUDFLARE_COMPONENT_ID;
  providerID: "cloudflare-workers-ai";
  taskID: string;
  attemptID: string;
  purpose: SelectedTextPurpose;
  release: ComponentRelease;
  destination: CloudflareDestination;
  endpoint: string;
  consentExpiresAt: number;
  inputSHA256: string;
  /** Requested max_tokens parameter; not a proved cap on separately reported reasoning or cost. */
  maxOutputTokens: number;
  reasoning: "low";
  reasoningBudgetSemantics: "unverified";
  requestBody: CloudflareRequestBody;
  digest: string;
}

/** Provider-reported candidate evidence; absent provenance and counters remain null. */
export interface CloudflareEvidence {
  schemaVersion: 1;
  kind: "cloud-analysis-candidate";
  agentID: typeof CLOUDFLARE_AGENT_ID;
  componentID: typeof CLOUDFLARE_COMPONENT_ID;
  taskID: string;
  attemptID: string;
  lifecycleTaskID: string;
  previewDigest: string;
  inputSHA256: string;
  purpose: SelectedTextPurpose;
  release: ComponentRelease;
  destination: CloudflareDestination;
  providerID: "cloudflare-workers-ai";
  execution: "cloud";
  requestedModel: string;
  returnedModel: string | null;
  providerResponseID: string | null;
  text: string;
  usage: CloudflareUsage;
  maxOutputTokens: number;
  reasoning: "low";
  reasoningBudgetSemantics: "unverified";
  reasoningOutputDiscarded: boolean;
  finishReason: "stop";
  authorized: false;
  verified: false;
}

export type CloudflareJobErrorCode =
  | "invalid_request" | "invalid_configuration" | "preview_mismatch" | "consent_expired"
  | "approval_required" | "approval_denied" | "release_unapproved" | "task_unavailable"
  | "duplicate_attempt" | "persistence_failed" | "cancelled" | "deadline_exceeded"
  | "provider_mismatch" | "upstream_failed" | "invalid_response";

/** Fixed public codes only; raw credentials, selected text and upstream errors never escape. */
export class CloudflareJobFailure extends Error {
  constructor(readonly code: CloudflareJobErrorCode, readonly remoteOutcome: "not_started" | "unknown" = "not_started") {
    super(code);
    this.name = "CloudflareJobFailure";
  }
}

export function validateCloudflareDestination(value: unknown): CloudflareDestination {
  if (!exactKeys(value, ["accountID", "modelID"]) || !match(value.accountID, /^[0-9a-f]{32}$/) ||
      !(CLOUDFLARE_ANALYSIS_MODELS as readonly unknown[]).includes(value.modelID)) {
    throw new CloudflareJobFailure("invalid_configuration");
  }
  return { accountID: value.accountID, modelID: value.modelID as CloudflareAnalysisModel };
}

export function cloudflareEndpoint(destination: CloudflareDestination): string {
  const value = validateCloudflareDestination(destination);
  return `https://api.cloudflare.com/client/v4/accounts/${value.accountID}/ai/v1/chat/completions`;
}

export function cloudflareRequestBody(selectedText: string, purpose: SelectedTextPurpose, maxOutputTokens: number): CloudflareRequestBody {
  if (!SELECTED_TEXT_PURPOSES.includes(purpose) || !isBoundedText(selectedText, CLOUD_ANALYSIS_LIMITS.inputBytes) ||
      !Number.isSafeInteger(maxOutputTokens) || maxOutputTokens < 1 || maxOutputTokens > CLOUD_ANALYSIS_LIMITS.outputTokens) {
    throw new CloudflareJobFailure("invalid_request");
  }
  return {
    model: CLOUDFLARE_ANALYSIS_MODELS[0],
    messages: [{ role: "system", content: PURPOSE_INSTRUCTIONS[purpose] }, { role: "user", content: selectedText }],
    reasoning_effort: "low", max_tokens: maxOutputTokens, stream: false
  };
}

export function prepareCloudflareAnalysis(request: unknown, options: {
  attemptID: string; destination: CloudflareDestination; release: ComponentRelease;
  consentExpiresAt: number; maxOutputTokens?: number; now?: number;
}): CloudflarePreview {
  const now = options.now ?? Date.now();
  const attemptID = canonicalAttemptID(options.attemptID);
  if (!exactKeys(request, ["task_id", "purpose", "selected_text"]) || !isIdentifier(request.task_id) ||
      !SELECTED_TEXT_PURPOSES.includes(request.purpose as SelectedTextPurpose) ||
      !isBoundedText(request.selected_text, CLOUD_ANALYSIS_LIMITS.inputBytes) || !attemptID) {
    throw new CloudflareJobFailure("invalid_request");
  }
  if (!Number.isSafeInteger(now) || now < 0 || now > 8_640_000_000_000_000 - CLOUD_ANALYSIS_LIMITS.consentLifetimeMs ||
      !Number.isSafeInteger(options.consentExpiresAt) || options.consentExpiresAt <= now ||
      options.consentExpiresAt > now + CLOUD_ANALYSIS_LIMITS.consentLifetimeMs) {
    throw new CloudflareJobFailure("consent_expired");
  }
  const destination = validateCloudflareDestination(options.destination);
  const purpose = request.purpose as SelectedTextPurpose;
  const maxOutputTokens = options.maxOutputTokens ?? CLOUD_ANALYSIS_LIMITS.outputTokens;
  const bound: Omit<CloudflarePreview, "digest"> = {
    schemaVersion: 1, agentID: CLOUDFLARE_AGENT_ID, componentID: CLOUDFLARE_COMPONENT_ID,
    providerID: "cloudflare-workers-ai", taskID: request.task_id, attemptID, purpose,
    release: validateComponentRelease(options.release, () => new CloudflareJobFailure("invalid_configuration")),
    destination, endpoint: cloudflareEndpoint(destination), consentExpiresAt: options.consentExpiresAt,
    inputSHA256: inputSHA256(request.selected_text), maxOutputTokens,
    reasoning: "low", reasoningBudgetSemantics: "unverified",
    requestBody: cloudflareRequestBody(request.selected_text, purpose, maxOutputTokens)
  };
  return freeze({ ...bound, digest: inputSHA256(canonicalJSON(bound)) });
}

/** Reconstruct exact outbound bytes and bindings without invoking accessors or serialization hooks. */
export function validateCloudflarePreview(value: unknown, now = Date.now()): CloudflarePreview {
  try {
    const copy = clonePlainJSON(value) as CloudflarePreview;
    const expected = prepareCloudflareAnalysis({ task_id: copy.taskID, purpose: copy.purpose,
      selected_text: copy.requestBody?.messages?.[1]?.content }, {
      attemptID: copy.attemptID, destination: copy.destination, release: copy.release,
      consentExpiresAt: copy.consentExpiresAt, maxOutputTokens: copy.maxOutputTokens, now
    });
    if (canonicalJSON(copy) !== canonicalJSON(expected)) throw new Error();
    return expected;
  } catch (error) {
    if (error instanceof CloudflareJobFailure && error.code === "consent_expired") throw error;
    throw new CloudflareJobFailure("preview_mismatch");
  }
}
