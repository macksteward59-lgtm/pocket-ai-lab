import { PURPOSE_INSTRUCTIONS, exactKeys, match, canonicalJSON, freeze, clonePlainJSON, validateComponentRelease, type ComponentRelease } from "../shared/selectedTextContract";
export { canonicalJSON } from "../shared/selectedTextContract";
import { CLOUD_ANALYSIS_LIMITS } from "../../serverless/cloud-analysis/types";
import { canonicalAttemptID, inputSHA256, isBoundedText, isIdentifier } from "../../serverless/cloud-analysis/validation";
import { GOOGLE_CLOUD_AGENT_ID, GOOGLE_CLOUD_COMPONENT_ID, GOOGLE_CLOUD_PURPOSES, type GoogleCloudPurpose } from "./profile";

export interface VertexDestination { projectID: string; location: string; modelID: string }
export type { ComponentRelease, SelectedTextRequest } from "../shared/selectedTextContract";

export interface VertexRequestBody {
  systemInstruction: { parts: [{ text: string }] };
  contents: [{ role: "user"; parts: [{ text: string }] }];
  generationConfig: { candidateCount: 1; maxOutputTokens: number; responseMimeType: "text/plain" };
}
export interface GoogleCloudPreview {
  schemaVersion: 1;
  agentID: typeof GOOGLE_CLOUD_AGENT_ID;
  componentID: typeof GOOGLE_CLOUD_COMPONENT_ID;
  providerID: "google-vertex";
  taskID: string;
  attemptID: string;
  purpose: GoogleCloudPurpose;
  release: ComponentRelease;
  destination: VertexDestination;
  endpoint: string;
  consentExpiresAt: number;
  inputSHA256: string;
  maxOutputTokens: number;
  thinking: "model-default";
  requestBody: VertexRequestBody;
  digest: string;
}
export interface VertexUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  thoughtsTokens: number;
  cachedContentTokens: number;
  toolUsePromptTokens: 0;
}
export interface GoogleCloudEvidence {
  schemaVersion: 1;
  kind: "cloud-analysis-candidate";
  agentID: typeof GOOGLE_CLOUD_AGENT_ID;
  componentID: typeof GOOGLE_CLOUD_COMPONENT_ID;
  taskID: string;
  attemptID: string;
  lifecycleTaskID: string;
  previewDigest: string;
  inputSHA256: string;
  purpose: GoogleCloudPurpose;
  release: ComponentRelease;
  destination: VertexDestination;
  providerID: "google-vertex";
  execution: "cloud";
  requestedModel: string;
  actualModel: string;
  providerResponseID: string;
  text: string;
  usage: VertexUsage;
  finishReason: "STOP";
  authorized: false;
  verified: false;
}

export type GoogleCloudJobErrorCode =
  | "invalid_request" | "invalid_configuration" | "preview_mismatch" | "consent_expired"
  | "approval_required" | "approval_denied" | "release_unapproved" | "task_unavailable"
  | "duplicate_attempt" | "persistence_failed" | "cancelled" | "deadline_exceeded"
  | "provider_mismatch" | "upstream_failed" | "invalid_response";

/** Public failures deliberately exclude selected text, credentials and raw errors. */
export class GoogleCloudJobFailure extends Error {
  constructor(readonly code: GoogleCloudJobErrorCode, readonly remoteOutcome: "not_started" | "unknown" = "not_started") {
    super(code);
    this.name = "GoogleCloudJobFailure";
  }
}

export function validateDestination(value: unknown): VertexDestination {
  if (!exactKeys(value, ["projectID", "location", "modelID"]) ||
      !match(value.projectID, /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/) ||
      !match(value.location, /^[a-z]+(?:-[a-z]+)+[1-9][0-9]?$/) ||
      value.location.length > 32 ||
      !match(value.modelID, /^[a-z][a-z0-9._-]{0,127}$/)) {
    throw new GoogleCloudJobFailure("invalid_configuration");
  }
  return { projectID: value.projectID, location: value.location, modelID: value.modelID };
}
export function vertexEndpoint(destination: VertexDestination): string {
  const d = validateDestination(destination);
  return `https://${d.location}-aiplatform.googleapis.com/v1/projects/${d.projectID}/locations/${d.location}/publishers/google/models/${d.modelID}:generateContent`;
}
export function validateRelease(value: unknown): ComponentRelease {
  return validateComponentRelease(value, () => new GoogleCloudJobFailure("invalid_configuration"));
}
export function vertexRequestBody(selectedText: string, purpose: GoogleCloudPurpose, maxOutputTokens: number): VertexRequestBody {
  if (!GOOGLE_CLOUD_PURPOSES.includes(purpose) || !isBoundedText(selectedText, CLOUD_ANALYSIS_LIMITS.inputBytes) ||
      !Number.isSafeInteger(maxOutputTokens) || maxOutputTokens < 1 || maxOutputTokens > CLOUD_ANALYSIS_LIMITS.outputTokens) {
    throw new GoogleCloudJobFailure("invalid_request");
  }
  return {
    systemInstruction: { parts: [{ text: PURPOSE_INSTRUCTIONS[purpose] }] },
    contents: [{ role: "user", parts: [{ text: selectedText }] }],
    // No tools, conversation, files, caching, routing, safety override or model-specific thinking flags.
    generationConfig: { candidateCount: 1, maxOutputTokens, responseMimeType: "text/plain" }
  };
}

export function prepareGoogleCloudAnalysis(request: unknown, options: {
  attemptID: string; destination: VertexDestination; release: ComponentRelease;
  consentExpiresAt: number; maxOutputTokens?: number; now?: number;
}): GoogleCloudPreview {
  const now = options.now ?? Date.now();
  const attemptID = canonicalAttemptID(options.attemptID);
  if (!exactKeys(request, ["task_id", "purpose", "selected_text"]) || !isIdentifier(request.task_id) ||
      !GOOGLE_CLOUD_PURPOSES.includes(request.purpose as GoogleCloudPurpose) ||
      !isBoundedText(request.selected_text, CLOUD_ANALYSIS_LIMITS.inputBytes) || !attemptID) {
    throw new GoogleCloudJobFailure("invalid_request");
  }
  if (!Number.isSafeInteger(now) || now < 0 || !Number.isSafeInteger(options.consentExpiresAt) ||
      options.consentExpiresAt <= now || options.consentExpiresAt > now + CLOUD_ANALYSIS_LIMITS.consentLifetimeMs) {
    throw new GoogleCloudJobFailure("consent_expired");
  }
  const destination = validateDestination(options.destination);
  const purpose = request.purpose as GoogleCloudPurpose;
  const maxOutputTokens = options.maxOutputTokens ?? CLOUD_ANALYSIS_LIMITS.outputTokens;
  const bound: Omit<GoogleCloudPreview, "digest"> = {
    schemaVersion: 1 as const, agentID: GOOGLE_CLOUD_AGENT_ID, componentID: GOOGLE_CLOUD_COMPONENT_ID,
    providerID: "google-vertex" as const, taskID: request.task_id, attemptID, purpose,
    release: validateRelease(options.release), destination, endpoint: vertexEndpoint(destination),
    consentExpiresAt: options.consentExpiresAt, inputSHA256: inputSHA256(request.selected_text), maxOutputTokens,
    thinking: "model-default" as const,
    requestBody: vertexRequestBody(request.selected_text, purpose, maxOutputTokens)
  };
  return freeze({ ...bound, digest: inputSHA256(canonicalJSON(bound)) });
}

/** Reconstruct the exact bounded payload; reject additions, altered destinations and stale consent. */
export function validateGoogleCloudPreview(value: unknown, now = Date.now()): GoogleCloudPreview {
  try {
    const copy = clonePlainJSON(value) as GoogleCloudPreview;
    const expected = prepareGoogleCloudAnalysis({ task_id: copy.taskID, purpose: copy.purpose,
      selected_text: copy.requestBody?.contents?.[0]?.parts?.[0]?.text }, {
      attemptID: copy.attemptID, destination: copy.destination, release: copy.release,
      consentExpiresAt: copy.consentExpiresAt, maxOutputTokens: copy.maxOutputTokens, now
    });
    if (canonicalJSON(copy) !== canonicalJSON(expected)) throw new Error();
    return expected;
  } catch (error) {
    if (error instanceof GoogleCloudJobFailure && error.code === "consent_expired") throw error;
    throw new GoogleCloudJobFailure("preview_mismatch");
  }
}
