import type { PolicySnapshot } from "../intake";

export type PolicyClauseKind =
  | "scope-inclusion"
  | "scope-exclusion"
  | "allowed-activity"
  | "prohibited-method"
  | "rate-limit"
  | "testing-window"
  | "disclosure"
  | "ambiguous"
  | "unclassified";

export type PolicyExtractionMethod =
  | "explicit-label"
  | "section-heading"
  | "section-context"
  | "keyword-pattern";

export type PolicyCandidateValue =
  | { readonly kind: "asset"; readonly assetKind: "domain" | "url"; readonly value: string }
  | { readonly kind: "rate-limit"; readonly limit: number; readonly unit: "requests-per-second" | "requests-per-minute" }
  | { readonly kind: "testing-window"; readonly startsAt: string; readonly endsAt: string };

export interface ExtractedPolicyClause {
  readonly clauseId: string;
  readonly kind: PolicyClauseKind;
  /** Exact source line, including original indentation but excluding its line ending. */
  readonly text: string;
  /** UTF-16 code-unit offsets into PolicySnapshot.policyText; end is exclusive. */
  readonly startOffset: number;
  readonly endOffset: number;
  readonly line: number;
  readonly extractionMethod: PolicyExtractionMethod;
  /** Strictly parsed candidate data; never an authorization decision. */
  readonly candidateValue?: PolicyCandidateValue;
  readonly snapshotId: string;
  readonly contentSha256: string;
  readonly requiresHumanReview: true;
}

export type PolicyInterpretationIssueCode =
  | "unclassified-clause"
  | "ambiguous-language"
  | "potential-conflict"
  | "unparsed-candidate";

export interface PolicyInterpretationIssue {
  readonly code: PolicyInterpretationIssueCode;
  readonly message: string;
  readonly clauseIds: readonly string[];
}

export interface PolicyInterpretation {
  readonly parserVersion: "1.0.0";
  readonly snapshotId: string;
  readonly programId: string;
  readonly sourceUrl: string;
  readonly contentSha256: string;
  readonly interpretedAt: string;
  readonly clauses: readonly ExtractedPolicyClause[];
  readonly issues: readonly PolicyInterpretationIssue[];
  readonly reviewState: "needs-human-review";
  /** Interpretation is evidence, never permission. */
  readonly authorized: false;
}

export interface PolicyReviewAssignment {
  readonly reviewer: "critic" | "validator";
  readonly status: "pending";
  readonly snapshotId: string;
  readonly focus: string;
  /** Assignments do not claim that an agent has run or approved anything. */
  readonly completed: false;
  readonly authorized: false;
}

export interface InterpretationEvidenceValidation {
  readonly valid: boolean;
  readonly snapshotId: string;
  readonly reasons: readonly string[];
  readonly authorized: false;
}

export interface PolicyInterpretationInput {
  readonly snapshot: PolicySnapshot;
  /** Injectable for deterministic tests; defaults to current time. */
  readonly interpretedAt?: Date;
}
