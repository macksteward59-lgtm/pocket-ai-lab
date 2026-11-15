/**
 * Data contracts for program intelligence.
 *
 * These records describe a program's published rules. They are not proof of
 * authorization and must never be treated as execution credentials.
 */

export type BountyPlatform = "hackerone" | "bugcrowd" | "intigriti" | "manual";
export type AssetKind = "domain" | "url" | "ip" | "cidr" | "mobile_app" | "source_code";
export type PolicyReviewState = "ready-for-human-review" | "needs-review" | "blocked";

export interface ScopeRuleInput {
  kind: AssetKind;
  value: string;
  includeSubdomains?: boolean;
  note?: string;
}

export interface RateLimitInput {
  requestsPerSecond?: number;
  requestsPerMinute?: number;
}

export interface TestingWindowInput {
  startsAt?: string;
  endsAt?: string;
  timezone?: string;
}

/**
 * Model-extracted or operator-entered candidate data is untrusted.
 * The normalizer validates it but cannot establish the truth of the source.
 */
export interface ProgramPolicyCandidate {
  programId: string;
  programName: string;
  platform: BountyPlatform;
  sourceUrl: string;
  retrievedAt: string;
  effectiveAt?: string;
  expiresAt?: string;
  scope: {
    inScope: ScopeRuleInput[];
    outOfScope: ScopeRuleInput[];
  };
  allowedActivities: string[];
  prohibitedActivities: string[];
  vulnerabilityExclusions: string[];
  rateLimit?: RateLimitInput;
  testingWindow?: TestingWindowInput;
  disclosureRules?: string[];
  policyText?: string;
}

export interface NormalizedScopeRule {
  readonly kind: AssetKind;
  readonly value: string;
  readonly includeSubdomains: boolean;
  readonly includeApex: boolean;
  readonly note?: string;
}

export interface NormalizedProgramPolicy {
  readonly programId: string;
  readonly programName: string;
  readonly platform: BountyPlatform;
  readonly sourceUrl: string;
  readonly retrievedAt: string;
  readonly effectiveAt?: string;
  readonly expiresAt?: string;
  readonly inScope: readonly NormalizedScopeRule[];
  readonly outOfScope: readonly NormalizedScopeRule[];
  readonly allowedActivities: readonly string[];
  readonly prohibitedActivities: readonly string[];
  readonly vulnerabilityExclusions: readonly string[];
  readonly rateLimit?: Readonly<RateLimitInput>;
  readonly testingWindow?: Readonly<TestingWindowInput>;
  readonly disclosureRules: readonly string[];
  readonly reviewState: PolicyReviewState;
  readonly reviewReasons: readonly string[];
  /** Constant false. Program parsing cannot grant authority. */
  readonly authorized: false;
}

export type ScopeDisposition = "in-scope" | "out-of-scope" | "indeterminate";

export interface ScopeEvaluation {
  readonly target: string;
  readonly disposition: ScopeDisposition;
  readonly matchedRule?: NormalizedScopeRule;
  readonly reason: string;
  /** Constant false, even when the target matches a published scope rule. */
  readonly authorized: false;
}

export type ProgramAction =
  | "read_program_policy"
  | "analyze_supplied_source"
  | "passive_recon"
  | "active_test"
  | "exploit_validation"
  | "access_sensitive_data"
  | "submit_report";

export interface ActionDecision {
  readonly action: ProgramAction;
  readonly allowed: false;
  readonly authorized: false;
  readonly reason: string;
}
