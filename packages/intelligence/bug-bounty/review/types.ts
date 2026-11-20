import type { PolicySnapshot } from "../intake";
import type { PolicyInterpretation } from "../interpretation";

export const POLICY_REVIEW_FINDING_CODES = [
  "omitted-condition",
  "misclassified-clause",
  "ambiguous-permission",
  "conflicting-policy",
  "unsupported-value",
  "evidence-mismatch",
  "other"
] as const;

export type PolicyReviewFindingCode = typeof POLICY_REVIEW_FINDING_CODES[number];
export type PolicyReviewSeverity = "critical" | "high" | "medium" | "low" | "info";
export type PolicyReviewerRole = "critic" | "validator";

export interface PolicyReviewRequest {
  readonly snapshot: PolicySnapshot;
  readonly interpretation: PolicyInterpretation;
}

export interface PolicyReviewFinding {
  readonly code: PolicyReviewFindingCode;
  readonly severity: PolicyReviewSeverity;
  readonly clauseId?: string;
  /** UTF-16 offsets into the exact immutable policy text; end is exclusive. */
  readonly startOffset: number;
  readonly endOffset: number;
  /** Must equal the complete source line at the supplied offsets. */
  readonly sourceText: string;
  readonly explanation: string;
}

export interface PolicyReviewAgentPayload {
  readonly summary: string;
  readonly findings: readonly PolicyReviewFinding[];
}

/** A role-specific executor. Implementations must not receive the other reviewer's output. */
export interface PolicyReviewAgent {
  readonly reviewer: PolicyReviewerRole;
  review(request: PolicyReviewRequest): Promise<unknown>;
}

export type PolicyReviewFailureCode =
  | "execution-failed"
  | "invalid-response";

export interface PolicyReviewCompleted {
  readonly reviewer: PolicyReviewerRole;
  readonly status: "completed";
  readonly snapshotId: string;
  readonly contentSha256: string;
  readonly summary: string;
  readonly findings: readonly PolicyReviewFinding[];
  readonly authorized: false;
}

export interface PolicyReviewFailed {
  readonly reviewer: PolicyReviewerRole;
  readonly status: "failed";
  readonly snapshotId: string;
  readonly contentSha256: string;
  readonly failureCode: PolicyReviewFailureCode;
  readonly message: string;
  readonly authorized: false;
}

export type PolicyReviewOutcome = PolicyReviewCompleted | PolicyReviewFailed;

export interface PolicyReviewRun {
  readonly runId: string;
  readonly snapshotId: string;
  readonly contentSha256: string;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly status: "complete" | "partial" | "failed";
  readonly reviews: readonly [PolicyReviewOutcome, PolicyReviewOutcome];
  readonly requiresHumanReview: true;
  /** Independent model reviews are advisory evidence, never permission. */
  readonly authorized: false;
}

export interface PolicyReviewAgentSet {
  readonly critic: PolicyReviewAgent;
  readonly validator: PolicyReviewAgent;
}
