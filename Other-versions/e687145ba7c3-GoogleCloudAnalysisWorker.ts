import { TaskLifecycleCoordinator } from "../../autonomy/TaskLifecycleCoordinator";
import { CLOUD_ANALYSIS_LIMITS } from "../../serverless/cloud-analysis/types";
import { isBoundedText, isObject } from "../../serverless/cloud-analysis/validation";
import { AnalysisLifecycleWorker } from "../shared/AnalysisLifecycleWorker";
import {
  canonicalJSON, GoogleCloudJobFailure, validateGoogleCloudPreview, vertexEndpoint,
  type ComponentRelease, type GoogleCloudEvidence, type GoogleCloudPreview, type VertexUsage
} from "./contracts";
import { GOOGLE_CLOUD_AGENT_ID, GOOGLE_CLOUD_COMPONENT_ID } from "./profile";
import type { VertexAnalysisProvider, VertexAnalysisResult } from "./VertexAnalysisProvider";

type AnalysisProvider = Pick<VertexAnalysisProvider,
  "providerID" | "destination" | "endpoint" | "requestedModel" | "generate">;

export interface GoogleCloudAnalysisWorkerOptions {
  enabled: true;
  /** Initialized by the host, using an atomic store with CAS/transactions or one exclusive writer. */
  coordinator: TaskLifecycleCoordinator;
  provider: AnalysisProvider;
  /** Independent host verification, including export/action authority where applicable. */
  verifyApproval: (preview: GoogleCloudPreview, receipt: unknown) => boolean | Promise<boolean>;
  /** Verify the actual approved component release; metadata alone is not evidence of approval. */
  verifyRelease: (release: ComponentRelease) => boolean | Promise<boolean>;
  /** Resolve the existing originating task without copying its contents into cloud context. */
  taskExists: (taskID: string) => boolean | Promise<boolean>;
  now?: () => number;
  timeoutMs?: number;
}

export interface GoogleCloudRunInput {
  preview: unknown;
  approvedDigest: string;
  receipt: unknown;
  signal?: AbortSignal;
}

/** Stable across processes; reusing an attempt never silently starts another inference. */
export function googleCloudLifecycleTaskID(preview: Pick<GoogleCloudPreview, "attemptID">): string {
  return "google-cloud-analysis:" + preview.attemptID;
}

/** Google facade preserving its public contract, preview bytes and provider evidence. */
export class GoogleCloudAnalysisWorker {
  private readonly provider: AnalysisProvider;
  private readonly lifecycle: AnalysisLifecycleWorker<GoogleCloudPreview, VertexAnalysisResult, GoogleCloudEvidence>;

  constructor(options: GoogleCloudAnalysisWorkerOptions) {
    this.provider = options?.provider;
    this.lifecycle = new AnalysisLifecycleWorker(options, {
      providerConfigured: !!this.provider && typeof this.provider.generate === "function",
      kind: "google-cloud-analysis",
      objective: "Supplemental Google Cloud selected-text analysis",
      lifecycleTaskID: googleCloudLifecycleTaskID,
      evidenceRef: preview => "google-cloud-preview-sha256:" + preview.digest,
      destinationMetadata: preview => ({
        projectID: preview.destination.projectID, location: preview.destination.location,
        requestedModel: preview.destination.modelID
      }),
      validatePreview: validateGoogleCloudPreview,
      assertProviderMatches: preview => this.assertProviderMatches(preview),
      generate: (preview, guards) => this.provider.generate({
        agentId: GOOGLE_CLOUD_AGENT_ID, modelId: preview.destination.modelID,
        prompt: preview.requestBody.contents[0].parts[0].text,
        stage: "independent", contextMessages: []
      }, {
        purpose: preview.purpose, maxOutputTokens: preview.maxOutputTokens, signal: guards.signal,
        authorizeDispatch: guards.verifyBeforeDispatch,
        assertCanDispatch: guards.assertCanDispatch
      }),
      buildEvidence: (preview, lifecycleTaskID, result) => this.buildEvidence(preview, lifecycleTaskID, result),
      failure: (code, outcome) => new GoogleCloudJobFailure(code, outcome),
      isFailure: (error): error is GoogleCloudJobFailure => error instanceof GoogleCloudJobFailure
    });
  }

  run(input: GoogleCloudRunInput): Promise<GoogleCloudEvidence> {
    return this.lifecycle.run(input);
  }

  private assertProviderMatches(preview: GoogleCloudPreview): void {
    try {
      if (this.provider.providerID !== "google-vertex" || this.provider.requestedModel !== preview.destination.modelID ||
          this.provider.endpoint !== preview.endpoint || vertexEndpoint(this.provider.destination) !== preview.endpoint ||
          canonicalJSON(this.provider.destination) !== canonicalJSON(preview.destination)) throw new Error();
    } catch { throw new GoogleCloudJobFailure("provider_mismatch"); }
  }

  private buildEvidence(preview: GoogleCloudPreview, lifecycleTaskID: string, result: VertexAnalysisResult): GoogleCloudEvidence {
    // Preserve provider attribution, but never accept a provider's claimed verification/authority.
    const metadataText = (value: unknown, maximum: number) =>
      isBoundedText(value, maximum) && !/[\u0000-\u0020\u007f]/.test(value);
    if (!result || result.providerID !== "google-vertex" || result.requestedModel !== preview.destination.modelID ||
        result.finishReason !== "STOP" || !metadataText(result.actualModel, 256) || !metadataText(result.providerResponseID, 512) ||
        !isObject(result.payload) || !isBoundedText(result.payload.analysis, CLOUD_ANALYSIS_LIMITS.outputBytes) ||
        !isObject(result.usage)) throw new GoogleCloudJobFailure("invalid_response", "unknown");
    const usageKeys: (keyof VertexUsage)[] = [
      "promptTokens", "completionTokens", "totalTokens", "thoughtsTokens", "cachedContentTokens", "toolUsePromptTokens"
    ];
    if (usageKeys.some(key => !Number.isSafeInteger(result.usage[key]) || result.usage[key] < 0) ||
        result.usage.toolUsePromptTokens !== 0 || result.usage.completionTokens > preview.maxOutputTokens ||
        result.usage.cachedContentTokens > result.usage.promptTokens ||
        !Number.isSafeInteger(result.usage.promptTokens + result.usage.completionTokens + result.usage.thoughtsTokens) ||
        result.usage.totalTokens !== result.usage.promptTokens + result.usage.completionTokens + result.usage.thoughtsTokens) {
      throw new GoogleCloudJobFailure("invalid_response", "unknown");
    }
    return Object.freeze({
      schemaVersion: 1, kind: "cloud-analysis-candidate", agentID: GOOGLE_CLOUD_AGENT_ID,
      componentID: GOOGLE_CLOUD_COMPONENT_ID, taskID: preview.taskID, attemptID: preview.attemptID,
      lifecycleTaskID, previewDigest: preview.digest, inputSHA256: preview.inputSHA256,
      purpose: preview.purpose, release: Object.freeze({ ...preview.release }),
      destination: Object.freeze({ ...preview.destination }), providerID: "google-vertex", execution: "cloud",
      requestedModel: result.requestedModel, actualModel: result.actualModel, providerResponseID: result.providerResponseID,
      text: result.payload.analysis,
      usage: Object.freeze({
        promptTokens: result.usage.promptTokens, completionTokens: result.usage.completionTokens,
        totalTokens: result.usage.totalTokens, thoughtsTokens: result.usage.thoughtsTokens,
        cachedContentTokens: result.usage.cachedContentTokens, toolUsePromptTokens: 0
      }),
      finishReason: "STOP", authorized: false, verified: false
    });
  }

}
