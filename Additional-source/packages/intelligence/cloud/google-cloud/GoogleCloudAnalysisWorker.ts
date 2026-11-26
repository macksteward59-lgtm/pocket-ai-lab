import {
  TaskLifecycleCoordinator, TaskLifecycleError, type StepClaim
} from "../../autonomy/TaskLifecycleCoordinator";
import { CLOUD_ANALYSIS_LIMITS, CloudAnalysisFailure } from "../../serverless/cloud-analysis/types";
import { isBoundedText, isObject, withAbort } from "../../serverless/cloud-analysis/validation";
import {
  canonicalJSON, GoogleCloudJobFailure, validateGoogleCloudPreview, vertexEndpoint,
  type ComponentRelease, type GoogleCloudEvidence, type GoogleCloudJobErrorCode,
  type GoogleCloudPreview, type VertexUsage
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

const STEP_ID = "analyze-selected-text";
const SETTLEMENT_TIMEOUT_MS = 1_000;

/** Stable across processes; reusing an attempt never silently starts another inference. */
export function googleCloudLifecycleTaskID(preview: Pick<GoogleCloudPreview, "attemptID">): string {
  return "google-cloud-analysis:" + preview.attemptID;
}

/**
 * A supplemental, single-attempt worker using the existing lifecycle kernel.
 * The host supplies authorization, task lookup, release verification and atomic storage.
 * Verifiers are checked before persistence, after the durable claim, and after credentials
 * resolve immediately before HTTP dispatch. They must support repeated verification of the
 * same receipt, and must not grant approval from model output.
 * This class creates no HTTP service, edits no original task, and grants no action authority.
 */
export class GoogleCloudAnalysisWorker {
  private readonly coordinator: TaskLifecycleCoordinator;
  private readonly provider: AnalysisProvider;
  private readonly verifyApproval: GoogleCloudAnalysisWorkerOptions["verifyApproval"];
  private readonly verifyRelease: GoogleCloudAnalysisWorkerOptions["verifyRelease"];
  private readonly taskExists: GoogleCloudAnalysisWorkerOptions["taskExists"];
  private readonly now: () => number;
  private readonly timeoutMs: number;

  constructor(options: GoogleCloudAnalysisWorkerOptions) {
    if (options?.enabled !== true || !(options.coordinator instanceof TaskLifecycleCoordinator) ||
        !options.provider || typeof options.provider.generate !== "function" ||
        typeof options.verifyRelease !== "function" || typeof options.taskExists !== "function" ||
        (options.now !== undefined && typeof options.now !== "function")) {
      throw new GoogleCloudJobFailure("invalid_configuration");
    }
    if (typeof options.verifyApproval !== "function") throw new GoogleCloudJobFailure("approval_required");
    const timeoutMs = options.timeoutMs ?? CLOUD_ANALYSIS_LIMITS.timeoutMs;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > CLOUD_ANALYSIS_LIMITS.timeoutMs) {
      throw new GoogleCloudJobFailure("invalid_configuration");
    }
    this.coordinator = options.coordinator;
    this.provider = options.provider;
    this.verifyApproval = options.verifyApproval;
    this.verifyRelease = options.verifyRelease;
    this.taskExists = options.taskExists;
    this.now = options.now ?? Date.now;
    this.timeoutMs = timeoutMs;
  }

  async run(input: GoogleCloudRunInput): Promise<GoogleCloudEvidence> {
    const startedAt = this.readClock();
    const preview = validateGoogleCloudPreview(input?.preview, startedAt);
    if (typeof input?.approvedDigest !== "string" || input.approvedDigest !== preview.digest) {
      throw new GoogleCloudJobFailure("preview_mismatch");
    }
    const externalSignal = input.signal;
    const receipt = input.receipt;
    this.assertProviderMatches(preview);
    if (externalSignal?.aborted) throw new GoogleCloudJobFailure("cancelled");

    const controller = new AbortController();
    let timedOut = false;
    let consentExpired = false;
    let dispatched = false;
    let claim: StepClaim | undefined;
    const onCancel = () => controller.abort();
    externalSignal?.addEventListener("abort", onCancel, { once: true });
    const consentRemainingMs = preview.consentExpiresAt - startedAt;
    const timeout = setTimeout(() => {
      consentExpired = consentRemainingMs <= this.timeoutMs;
      timedOut = !consentExpired;
      controller.abort();
    }, Math.min(this.timeoutMs, consentRemainingMs));
    const lifecycleTaskID = googleCloudLifecycleTaskID(preview);

    const checkCurrent = () => {
      if (controller.signal.aborted) {
        throw new GoogleCloudJobFailure(consentExpired ? "consent_expired" : timedOut ? "deadline_exceeded" : "cancelled", dispatched ? "unknown" : "not_started");
      }
      const now = this.readClock();
      if (now >= startedAt + this.timeoutMs) throw new GoogleCloudJobFailure("deadline_exceeded", dispatched ? "unknown" : "not_started");
      if (now >= preview.consentExpiresAt) throw new GoogleCloudJobFailure("consent_expired", dispatched ? "unknown" : "not_started");
    };
    const bounded = async <T>(operation: () => T | Promise<T>): Promise<T> => {
      checkCurrent();
      // Recheck inside the microtask so aborting before invocation prevents the operation.
      const pending = Promise.resolve().then(() => { checkCurrent(); return operation(); });
      const result = await withAbort(pending, controller.signal);
      checkCurrent();
      return result;
    };
    const verify = async (operation: () => boolean | Promise<boolean>, failure: GoogleCloudJobErrorCode) => {
      let accepted: boolean;
      try { accepted = await bounded(operation); }
      catch (error) {
        checkCurrent();
        if (error instanceof GoogleCloudJobFailure) throw error;
        throw new GoogleCloudJobFailure(failure);
      }
      if (accepted !== true) throw new GoogleCloudJobFailure(failure);
    };
    const preflight = async () => {
      await verify(() => this.taskExists(preview.taskID), "task_unavailable");
      await verify(() => this.verifyRelease(preview.release), "release_unapproved");
      await verify(() => this.verifyApproval(preview, receipt), "approval_denied");
      checkCurrent();
      this.assertProviderMatches(preview);
    };

    try {
      await preflight();
      // Stores only linkage metadata, not selected text, credentials, or approval receipts.
      await bounded(() => this.coordinator.createTask({
        id: lifecycleTaskID,
        objective: "Supplemental Google Cloud selected-text analysis",
        steps: [{ id: STEP_ID, description: "Analyze independently approved selected text", maxAttempts: 1, uncertainOnExpiredLease: true }],
        maxConcurrentSteps: 1,
        leaseMs: Math.max(1_000, this.timeoutMs + 5_000),
        metadata: {
          kind: "google-cloud-analysis", originalTaskID: preview.taskID,
          agentID: preview.agentID, componentID: preview.componentID, attemptID: preview.attemptID,
          previewDigest: preview.digest, inputSHA256: preview.inputSHA256,
          releaseID: preview.release.releaseID, commitSHA: preview.release.commitSHA,
          artifactSHA256: preview.release.artifactSHA256,
          providerID: preview.providerID, projectID: preview.destination.projectID,
          location: preview.destination.location, requestedModel: preview.destination.modelID
        }
      }));
      const acquired = await bounded(() => this.coordinator.claimNextStep(lifecycleTaskID));
      if (!acquired || acquired.taskId !== lifecycleTaskID || acquired.stepId !== STEP_ID || acquired.attemptNumber !== 1) {
        throw new GoogleCloudJobFailure("persistence_failed");
      }
      claim = acquired;

      // Authorization may be withdrawn or the source task deleted while storage is awaited.
      await preflight();
      this.assertClaimCurrent(claim);
      const result = await bounded(() => {
        checkCurrent();
        this.assertProviderMatches(preview);
        this.assertClaimCurrent(claim!);
        dispatched = true;
        return this.provider.generate({
          agentId: GOOGLE_CLOUD_AGENT_ID, modelId: preview.destination.modelID,
          prompt: preview.requestBody.contents[0].parts[0].text,
          stage: "independent", contextMessages: []
        }, {
          purpose: preview.purpose, maxOutputTokens: preview.maxOutputTokens, signal: controller.signal,
          // Recheck revocation/deletion after asynchronous credential acquisition as well.
          authorizeDispatch: preflight,
          // Credential acquisition may await. Recheck synchronously at the actual HTTP boundary.
          assertCanDispatch: () => {
            checkCurrent();
            this.assertProviderMatches(preview);
            this.assertClaimCurrent(claim!);
          }
        });
      });
      const evidence = this.buildEvidence(preview, lifecycleTaskID, result);
      const encoded = canonicalJSON(evidence);
      // The existing lifecycle result limit is 16,000 characters, including JSON escaping.
      if (encoded.length > 16_000) throw new GoogleCloudJobFailure("invalid_response", "unknown");
      try {
        await bounded(() => this.coordinator.completeStep({
          taskId: claim!.taskId, stepId: claim!.stepId, attemptId: claim!.attemptId,
          result: encoded, evidenceRefs: ["google-cloud-preview-sha256:" + preview.digest]
        }));
      } catch (error) {
        if (error instanceof GoogleCloudJobFailure || error instanceof CloudAnalysisFailure || error instanceof TaskLifecycleError) throw error;
        throw new GoogleCloudJobFailure("persistence_failed", "unknown");
      }
      return evidence;
    } catch (error) {
      let cause = error;
      // The provider sanitizes callback errors; retain the current deadline/consent classification.
      try { checkCurrent(); } catch (current) { cause = current; }
      const failure = this.normalizeFailure(cause, dispatched, controller.signal.aborted, timedOut, consentExpired);
      if (claim) await this.recordFailure(claim, failure, dispatched);
      throw failure;
    } finally {
      clearTimeout(timeout);
      externalSignal?.removeEventListener("abort", onCancel);
    }
  }

  private readClock(): number {
    let value: number;
    try { value = this.now(); } catch { throw new GoogleCloudJobFailure("invalid_configuration"); }
    if (!Number.isSafeInteger(value) || value < 0 || value > 8_640_000_000_000_000 - CLOUD_ANALYSIS_LIMITS.timeoutMs) {
      throw new GoogleCloudJobFailure("invalid_configuration");
    }
    return value;
  }

  private assertProviderMatches(preview: GoogleCloudPreview): void {
    try {
      if (this.provider.providerID !== "google-vertex" || this.provider.requestedModel !== preview.destination.modelID ||
          this.provider.endpoint !== preview.endpoint || vertexEndpoint(this.provider.destination) !== preview.endpoint ||
          canonicalJSON(this.provider.destination) !== canonicalJSON(preview.destination)) throw new Error();
    } catch { throw new GoogleCloudJobFailure("provider_mismatch"); }
  }

  private assertClaimCurrent(claim: StepClaim): void {
    const record = this.coordinator.getTask(claim.taskId);
    if (record.events.some(event => event.type === "task.cancel_requested") || record.status === "cancelled") {
      throw new GoogleCloudJobFailure("cancelled");
    }
    const step = record.steps.find(item => item.id === claim.stepId);
    if (record.status !== "running" || step?.status !== "running" || step.currentAttempt?.id !== claim.attemptId ||
        step.currentAttempt.ownerId !== claim.ownerId || Date.parse(step.currentAttempt.leaseExpiresAt) <= this.readClock()) {
      throw new GoogleCloudJobFailure("persistence_failed");
    }
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

  private normalizeFailure(error: unknown, dispatched: boolean, aborted: boolean, timedOut: boolean, consentExpired: boolean): GoogleCloudJobFailure {
    const outcome = dispatched ? "unknown" : "not_started";
    if (aborted) return new GoogleCloudJobFailure(consentExpired ? "consent_expired" : timedOut ? "deadline_exceeded" : "cancelled", outcome);
    if (error instanceof GoogleCloudJobFailure) {
      return new GoogleCloudJobFailure(error.code, dispatched ? "unknown" : error.remoteOutcome);
    }
    if (error instanceof TaskLifecycleError) {
      return error.code === "duplicate_task"
        ? new GoogleCloudJobFailure("duplicate_attempt", "unknown")
        : new GoogleCloudJobFailure("persistence_failed", outcome);
    }
    if (error instanceof CloudAnalysisFailure) {
      const code = error.code === "invalid_response" ? "invalid_response"
        : error.code === "upstream_timeout" ? "deadline_exceeded"
        : error.code === "cancelled" ? "cancelled" : "upstream_failed";
      return new GoogleCloudJobFailure(code, outcome);
    }
    return new GoogleCloudJobFailure(dispatched ? "upstream_failed" : "persistence_failed", outcome);
  }

  private async recordFailure(claim: StepClaim, failure: GoogleCloudJobFailure, dispatched: boolean): Promise<void> {
    // No retry. If the store is unavailable, the retained lease must be recovered as uncertain.
    // Do not settle as cancelled: a local AbortSignal does not establish remote provider drain.
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), SETTLEMENT_TIMEOUT_MS);
    try {
      await withAbort(this.coordinator.failStep({
        taskId: claim.taskId, stepId: claim.stepId, attemptId: claim.attemptId,
        error: failure.code, retryable: false, outcome: dispatched ? "unknown" : "definitive"
      }), controller.signal);
    } catch { /* Original fixed failure remains authoritative; no automatic persistence retry. */ }
    finally { clearTimeout(timeout); }
  }
}
