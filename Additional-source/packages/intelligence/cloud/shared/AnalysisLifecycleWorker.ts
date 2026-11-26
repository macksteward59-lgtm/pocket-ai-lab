import {
  TaskLifecycleCoordinator, TaskLifecycleError, type StepClaim
} from "../../autonomy/TaskLifecycleCoordinator";
import { CLOUD_ANALYSIS_LIMITS, CloudAnalysisFailure } from "../../serverless/cloud-analysis/types";
import { withAbort } from "../../serverless/cloud-analysis/validation";
import { canonicalJSON, type ComponentRelease } from "./selectedTextContract";

/** Fields used by the lifecycle, independent of provider request and evidence formats. */
export interface AnalysisLifecyclePreview {
  agentID: string;
  componentID: string;
  providerID: string;
  taskID: string;
  attemptID: string;
  release: ComponentRelease;
  consentExpiresAt: number;
  inputSHA256: string;
  digest: string;
}

export type AnalysisLifecycleErrorCode =
  | "invalid_request" | "invalid_configuration" | "preview_mismatch" | "consent_expired"
  | "approval_required" | "approval_denied" | "release_unapproved" | "task_unavailable"
  | "duplicate_attempt" | "persistence_failed" | "cancelled" | "deadline_exceeded"
  | "provider_mismatch" | "upstream_failed" | "invalid_response";
export interface AnalysisLifecycleFailure extends Error {
  code: AnalysisLifecycleErrorCode;
  remoteOutcome: "not_started" | "unknown";
}

export interface AnalysisLifecycleOptions<P extends AnalysisLifecyclePreview> {
  enabled: true;
  /** Initialized by the host with atomic CAS/transactions or one exclusive writer. */
  coordinator: TaskLifecycleCoordinator;
  verifyApproval: (preview: P, receipt: unknown) => boolean | Promise<boolean>;
  verifyRelease: (release: ComponentRelease) => boolean | Promise<boolean>;
  taskExists: (taskID: string) => boolean | Promise<boolean>;
  now?: () => number;
  timeoutMs?: number;
}
export interface AnalysisLifecycleRunInput {
  preview: unknown;
  approvedDigest: string;
  receipt: unknown;
  signal?: AbortSignal;
}
export interface AnalysisDispatchGuards {
  signal: AbortSignal;
  /** Repeated independent verification; provider facades adapt the return type. */
  verifyBeforeDispatch: () => Promise<void>;
  /** Must remain synchronous at the provider's HTTP boundary. */
  assertCanDispatch: () => void;
}

/** Trusted provider facades supply formats; they cannot change retry or reservation policy. */
export interface AnalysisLifecycleAdapter<P extends AnalysisLifecyclePreview, R, E> {
  providerConfigured: boolean;
  kind: string;
  objective: string;
  lifecycleTaskID: (preview: P) => string;
  evidenceRef: (preview: P) => string;
  destinationMetadata: (preview: P) => Record<string, string>;
  validatePreview: (input: unknown, now: number) => P;
  assertProviderMatches: (preview: P) => void;
  generate: (preview: P, guards: AnalysisDispatchGuards) => Promise<R>;
  buildEvidence: (preview: P, lifecycleTaskID: string, result: R) => E;
  failure: (code: AnalysisLifecycleErrorCode, outcome?: "not_started" | "unknown") => AnalysisLifecycleFailure;
  isFailure: (error: unknown) => error is AnalysisLifecycleFailure;
}

const STEP_ID = "analyze-selected-text";
const SETTLEMENT_TIMEOUT_MS = 1_000;

/**
 * Shared single-attempt selected-text lifecycle. It reuses the host coordinator and store;
 * it creates no service, grants no authority and never retries an unknown remote outcome.
 */
export class AnalysisLifecycleWorker<P extends AnalysisLifecyclePreview, R, E> {
  private readonly coordinator: TaskLifecycleCoordinator;
  private readonly verifyApproval: AnalysisLifecycleOptions<P>["verifyApproval"];
  private readonly verifyRelease: AnalysisLifecycleOptions<P>["verifyRelease"];
  private readonly taskExists: AnalysisLifecycleOptions<P>["taskExists"];
  private readonly now: () => number;
  private readonly timeoutMs: number;

  constructor(options: AnalysisLifecycleOptions<P>, private readonly adapter: AnalysisLifecycleAdapter<P, R, E>) {
    if (options?.enabled !== true || !(options.coordinator instanceof TaskLifecycleCoordinator) ||
        !adapter.providerConfigured ||
        typeof options.verifyRelease !== "function" || typeof options.taskExists !== "function" ||
        (options.now !== undefined && typeof options.now !== "function")) {
      throw this.adapter.failure("invalid_configuration");
    }
    if (typeof options.verifyApproval !== "function") throw this.adapter.failure("approval_required");
    const timeoutMs = options.timeoutMs ?? CLOUD_ANALYSIS_LIMITS.timeoutMs;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > CLOUD_ANALYSIS_LIMITS.timeoutMs) {
      throw this.adapter.failure("invalid_configuration");
    }
    this.coordinator = options.coordinator;
    this.verifyApproval = options.verifyApproval;
    this.verifyRelease = options.verifyRelease;
    this.taskExists = options.taskExists;
    this.now = options.now ?? Date.now;
    this.timeoutMs = timeoutMs;
  }

  async run(input: AnalysisLifecycleRunInput): Promise<E> {
    const startedAt = this.readClock();
    const preview = this.adapter.validatePreview(input?.preview, startedAt);
    if (typeof input?.approvedDigest !== "string" || input.approvedDigest !== preview.digest) {
      throw this.adapter.failure("preview_mismatch");
    }
    const externalSignal = input.signal;
    const receipt = input.receipt;
    this.adapter.assertProviderMatches(preview);
    if (externalSignal?.aborted) throw this.adapter.failure("cancelled");

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
    const lifecycleTaskID = this.adapter.lifecycleTaskID(preview);

    const checkCurrent = () => {
      if (controller.signal.aborted) {
        throw this.adapter.failure(consentExpired ? "consent_expired" : timedOut ? "deadline_exceeded" : "cancelled", dispatched ? "unknown" : "not_started");
      }
      const now = this.readClock();
      if (now >= startedAt + this.timeoutMs) throw this.adapter.failure("deadline_exceeded", dispatched ? "unknown" : "not_started");
      if (now >= preview.consentExpiresAt) throw this.adapter.failure("consent_expired", dispatched ? "unknown" : "not_started");
    };
    const bounded = async <T>(operation: () => T | Promise<T>): Promise<T> => {
      checkCurrent();
      // Recheck inside the microtask so aborting before invocation prevents the operation.
      const pending = Promise.resolve().then(() => { checkCurrent(); return operation(); });
      const result = await withAbort(pending, controller.signal);
      checkCurrent();
      return result;
    };
    const verify = async (operation: () => boolean | Promise<boolean>, failure: AnalysisLifecycleErrorCode) => {
      let accepted: boolean;
      try { accepted = await bounded(operation); }
      catch (error) {
        checkCurrent();
        if (this.adapter.isFailure(error)) throw error;
        throw this.adapter.failure(failure);
      }
      if (accepted !== true) throw this.adapter.failure(failure);
    };
    const preflight = async () => {
      await verify(() => this.taskExists(preview.taskID), "task_unavailable");
      await verify(() => this.verifyRelease(preview.release), "release_unapproved");
      await verify(() => this.verifyApproval(preview, receipt), "approval_denied");
      checkCurrent();
      this.adapter.assertProviderMatches(preview);
    };

    try {
      await preflight();
      // Stores only linkage metadata, not selected text, credentials, or approval receipts.
      await bounded(() => this.coordinator.createTask({
        id: lifecycleTaskID,
        objective: this.adapter.objective,
        steps: [{ id: STEP_ID, description: "Analyze independently approved selected text", maxAttempts: 1, uncertainOnExpiredLease: true }],
        maxConcurrentSteps: 1,
        leaseMs: Math.max(1_000, this.timeoutMs + 5_000),
        metadata: {
          // Protected linkage fields override any provider-specific metadata keys.
          ...this.adapter.destinationMetadata(preview),
          kind: this.adapter.kind, originalTaskID: preview.taskID,
          agentID: preview.agentID, componentID: preview.componentID, attemptID: preview.attemptID,
          previewDigest: preview.digest, inputSHA256: preview.inputSHA256,
          releaseID: preview.release.releaseID, commitSHA: preview.release.commitSHA,
          artifactSHA256: preview.release.artifactSHA256,
          providerID: preview.providerID
        }
      }));
      const acquired = await bounded(() => this.coordinator.claimNextStep(lifecycleTaskID));
      if (!acquired || acquired.taskId !== lifecycleTaskID || acquired.stepId !== STEP_ID || acquired.attemptNumber !== 1) {
        throw this.adapter.failure("persistence_failed");
      }
      claim = acquired;

      // Authorization may be withdrawn or the source task deleted while storage is awaited.
      await preflight();
      this.assertClaimCurrent(claim);
      const result = await bounded(() => {
        checkCurrent();
        this.adapter.assertProviderMatches(preview);
        this.assertClaimCurrent(claim!);
        dispatched = true;
        return this.adapter.generate(preview, {
          signal: controller.signal,
          verifyBeforeDispatch: preflight,
          assertCanDispatch: () => {
            checkCurrent();
            this.adapter.assertProviderMatches(preview);
            this.assertClaimCurrent(claim!);
          }
        });
      });
      const evidence = this.adapter.buildEvidence(preview, lifecycleTaskID, result);
      const encoded = canonicalJSON(evidence);
      // The existing lifecycle result limit is 16,000 characters, including JSON escaping.
      if (encoded.length > 16_000) throw this.adapter.failure("invalid_response", "unknown");
      try {
        await bounded(() => this.coordinator.completeStep({
          taskId: claim!.taskId, stepId: claim!.stepId, attemptId: claim!.attemptId,
          result: encoded, evidenceRefs: [this.adapter.evidenceRef(preview)]
        }));
      } catch (error) {
        if (this.adapter.isFailure(error) || error instanceof CloudAnalysisFailure || error instanceof TaskLifecycleError) throw error;
        throw this.adapter.failure("persistence_failed", "unknown");
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
    try { value = this.now(); } catch { throw this.adapter.failure("invalid_configuration"); }
    if (!Number.isSafeInteger(value) || value < 0 || value > 8_640_000_000_000_000 - CLOUD_ANALYSIS_LIMITS.timeoutMs) {
      throw this.adapter.failure("invalid_configuration");
    }
    return value;
  }

  private assertClaimCurrent(claim: StepClaim): void {
    const record = this.coordinator.getTask(claim.taskId);
    if (record.events.some(event => event.type === "task.cancel_requested") || record.status === "cancelled") {
      throw this.adapter.failure("cancelled");
    }
    const step = record.steps.find(item => item.id === claim.stepId);
    if (record.status !== "running" || step?.status !== "running" || step.currentAttempt?.id !== claim.attemptId ||
        step.currentAttempt.ownerId !== claim.ownerId || Date.parse(step.currentAttempt.leaseExpiresAt) <= this.readClock()) {
      throw this.adapter.failure("persistence_failed");
    }
  }

  private normalizeFailure(error: unknown, dispatched: boolean, aborted: boolean, timedOut: boolean, consentExpired: boolean): AnalysisLifecycleFailure {
    const outcome = dispatched ? "unknown" : "not_started";
    if (aborted) return this.adapter.failure(consentExpired ? "consent_expired" : timedOut ? "deadline_exceeded" : "cancelled", outcome);
    if (this.adapter.isFailure(error)) {
      return this.adapter.failure(error.code, dispatched ? "unknown" : error.remoteOutcome);
    }
    if (error instanceof TaskLifecycleError) {
      return error.code === "duplicate_task"
        ? this.adapter.failure("duplicate_attempt", "unknown")
        : this.adapter.failure("persistence_failed", outcome);
    }
    if (error instanceof CloudAnalysisFailure) {
      const code = error.code === "invalid_response" ? "invalid_response"
        : error.code === "upstream_timeout" ? "deadline_exceeded"
        : error.code === "cancelled" ? "cancelled" : "upstream_failed";
      return this.adapter.failure(code, outcome);
    }
    return this.adapter.failure(dispatched ? "upstream_failed" : "persistence_failed", outcome);
  }

  private async recordFailure(claim: StepClaim, failure: AnalysisLifecycleFailure, dispatched: boolean): Promise<void> {
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
