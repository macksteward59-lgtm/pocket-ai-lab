import { CLOUD_ANALYSIS_LIMITS } from "../../serverless/cloud-analysis/types";
import { isBoundedText, isObject } from "../../serverless/cloud-analysis/validation";
import {
  AnalysisLifecycleWorker, type AnalysisLifecycleOptions, type AnalysisLifecycleRunInput
} from "../shared/AnalysisLifecycleWorker";
import { canonicalJSON } from "../shared/selectedTextContract";
import {
  cloudflareEndpoint, CloudflareJobFailure, validateCloudflarePreview,
  type CloudflareEvidence, type CloudflarePreview
} from "./contracts";
import { CLOUDFLARE_AGENT_ID, CLOUDFLARE_COMPONENT_ID } from "./profile";
import type { CloudflareAnalysisProvider, CloudflareAnalysisResult, CloudflareUsage } from "./CloudflareAnalysisProvider";

type AnalysisProvider = Pick<CloudflareAnalysisProvider,
  "providerID" | "destination" | "endpoint" | "requestedModel" | "generate">;

export interface CloudflareAnalysisWorkerOptions extends AnalysisLifecycleOptions<CloudflarePreview> {
  provider: AnalysisProvider;
}
export interface CloudflareRunInput extends AnalysisLifecycleRunInput {}

/** Reusing an attempt, including after restart or with a new digest, never starts inference again. */
export function cloudflareLifecycleTaskID(preview: Pick<CloudflarePreview, "attemptID">): string {
  return "cloudflare-analysis:" + preview.attemptID;
}

/**
 * Supplemental selected-text analysis through the existing host lifecycle.
 * The host supplies initialized atomic storage and independent, repeatable verifiers.
 * This facade creates no deployed endpoint and grants no tool or action authority.
 */
export class CloudflareAnalysisWorker {
  private readonly provider: AnalysisProvider;
  private readonly lifecycle: AnalysisLifecycleWorker<CloudflarePreview, CloudflareAnalysisResult, CloudflareEvidence>;

  constructor(options: CloudflareAnalysisWorkerOptions) {
    this.provider = options?.provider;
    this.lifecycle = new AnalysisLifecycleWorker(options, {
      providerConfigured: !!this.provider && typeof this.provider.generate === "function",
      kind: "cloudflare-analysis",
      objective: "Supplemental Cloudflare selected-text analysis",
      lifecycleTaskID: cloudflareLifecycleTaskID,
      evidenceRef: preview => "cloudflare-preview-sha256:" + preview.digest,
      destinationMetadata: preview => ({ accountID: preview.destination.accountID, requestedModel: preview.destination.modelID }),
      validatePreview: validateCloudflarePreview,
      assertProviderMatches: preview => this.assertProviderMatches(preview),
      generate: (preview, guards) => this.provider.generate({
        agentId: CLOUDFLARE_AGENT_ID, modelId: preview.destination.modelID,
        prompt: preview.requestBody.messages[1].content,
        stage: "independent", contextMessages: []
      }, {
        purpose: preview.purpose, maxOutputTokens: preview.maxOutputTokens,
        consentExpiresAt: preview.consentExpiresAt, signal: guards.signal,
        // Cloudflare requires literal true; shared verification intentionally returns void.
        authorizeDispatch: async () => { await guards.verifyBeforeDispatch(); return true; },
        assertCanDispatch: guards.assertCanDispatch
      }),
      buildEvidence: (preview, lifecycleTaskID, result) => this.buildEvidence(preview, lifecycleTaskID, result),
      failure: (code, outcome) => new CloudflareJobFailure(code, outcome),
      isFailure: (error): error is CloudflareJobFailure => error instanceof CloudflareJobFailure
    });
  }

  run(input: CloudflareRunInput): Promise<CloudflareEvidence> {
    return this.lifecycle.run(input);
  }

  private assertProviderMatches(preview: CloudflarePreview): void {
    try {
      if (this.provider.providerID !== "cloudflare-workers-ai" || this.provider.requestedModel !== preview.destination.modelID ||
          this.provider.endpoint !== preview.endpoint || cloudflareEndpoint(this.provider.destination) !== preview.endpoint ||
          canonicalJSON(this.provider.destination) !== canonicalJSON(preview.destination)) throw new Error();
    } catch { throw new CloudflareJobFailure("provider_mismatch"); }
  }

  private buildEvidence(preview: CloudflarePreview, lifecycleTaskID: string, result: CloudflareAnalysisResult): CloudflareEvidence {
    const metadataText = (value: unknown, maximum: number) =>
      value === null || (isBoundedText(value, maximum) && !/[\u0000-\u0020\u007f]/.test(value));
    if (!result || result.providerID !== "cloudflare-workers-ai" || result.requestedModel !== preview.destination.modelID ||
        result.finishReason !== "stop" || !metadataText(result.returnedModel, 256) || !metadataText(result.providerResponseID, 512) ||
        typeof result.reasoningOutputDiscarded !== "boolean" ||
        !isObject(result.payload) || !isBoundedText(result.payload.analysis, CLOUD_ANALYSIS_LIMITS.outputBytes) ||
        !isObject(result.usage) || typeof result.usage.reported !== "boolean" || result.usage.reasoningTokens !== null) {
      throw new CloudflareJobFailure("invalid_response", "unknown");
    }
    const usageKeys = ["promptTokens", "completionTokens", "totalTokens", "cachedPromptTokens"] as const;
    if (usageKeys.some(key => result.usage[key] !== null && (!Number.isSafeInteger(result.usage[key]) || result.usage[key]! < 0)) ||
        (!result.usage.reported && usageKeys.some(key => result.usage[key] !== null)) ||
        (result.usage.promptTokens !== null && result.usage.cachedPromptTokens !== null &&
          result.usage.cachedPromptTokens > result.usage.promptTokens)) {
      throw new CloudflareJobFailure("invalid_response", "unknown");
    }
    // No invented token equation or reasoning cap: these are only provider-reported counters.
    const usage: CloudflareUsage = Object.freeze({
      reported: result.usage.reported, promptTokens: result.usage.promptTokens,
      completionTokens: result.usage.completionTokens, totalTokens: result.usage.totalTokens,
      cachedPromptTokens: result.usage.cachedPromptTokens, reasoningTokens: null
    });
    return Object.freeze({
      schemaVersion: 1, kind: "cloud-analysis-candidate", agentID: CLOUDFLARE_AGENT_ID,
      componentID: CLOUDFLARE_COMPONENT_ID, taskID: preview.taskID, attemptID: preview.attemptID,
      lifecycleTaskID, previewDigest: preview.digest, inputSHA256: preview.inputSHA256,
      purpose: preview.purpose, release: Object.freeze({ ...preview.release }),
      destination: Object.freeze({ ...preview.destination }), providerID: "cloudflare-workers-ai", execution: "cloud",
      requestedModel: result.requestedModel, returnedModel: result.returnedModel, providerResponseID: result.providerResponseID,
      text: result.payload.analysis, usage, maxOutputTokens: preview.maxOutputTokens,
      reasoning: "low", reasoningBudgetSemantics: "unverified", reasoningOutputDiscarded: result.reasoningOutputDiscarded,
      finishReason: "stop", authorized: false, verified: false
    });
  }
}
