import type { BountyPlatform } from "../types";

export type PolicyContentFormat = "text/plain" | "text/markdown";

export interface PolicyIntakeInput {
  readonly programId: string;
  readonly platform: BountyPlatform;
  readonly sourceUrl: string;
  readonly retrievedAt: string;
  readonly contentFormat: PolicyContentFormat;
  /** Exact operator-supplied policy text; never fetched by this module. */
  readonly policyText: string;
}

export interface PolicySnapshot {
  readonly snapshotId: string;
  readonly programId: string;
  readonly platform: BountyPlatform;
  readonly sourceUrl: string;
  readonly retrievedAt: string;
  readonly contentFormat: PolicyContentFormat;
  readonly contentSha256: string;
  readonly contentBytes: number;
  /** Retained as supplied so reviewers can inspect the source wording. */
  readonly policyText: string;
  /** Intake never grants authority. */
  readonly authorized: false;
}

export type PolicyVersionStatus = "unchanged" | "changed" | "out-of-order" | "timestamp-conflict";

export interface PolicyVersionComparison {
  readonly status: PolicyVersionStatus;
  readonly previousSnapshotId: string;
  readonly currentSnapshotId: string;
  readonly previousSha256: string;
  readonly currentSha256: string;
  readonly contentChanged: boolean;
  readonly reason: string;
  readonly authorized: false;
}
