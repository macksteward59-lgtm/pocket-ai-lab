import { createHash } from "node:crypto";
import type {
  PolicyIntakeInput,
  PolicySnapshot,
  PolicyVersionComparison
} from "./types";

export const MAX_POLICY_TEXT_BYTES = 512 * 1024;

const ISO_DATE_WITH_ZONE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;

/**
 * Captures policy text supplied by a human or another trusted UI boundary.
 * This function performs no network requests and treats all text as untrusted.
 */
export function capturePolicySnapshot(input: PolicyIntakeInput): PolicySnapshot {
  if (!input || typeof input !== "object") {
    throw new PolicyIntakeError("Policy intake input is required");
  }

  const programId = requiredText(input.programId, "programId");
  const platform = input.platform;
  if (!["hackerone", "bugcrowd", "intigriti", "manual"].includes(platform)) {
    throw new PolicyIntakeError("Unsupported bounty platform");
  }

  const sourceUrl = validateSourceUrl(input.sourceUrl);
  const retrievedAt = validateTimestamp(input.retrievedAt);
  if (input.contentFormat !== "text/plain" && input.contentFormat !== "text/markdown") {
    throw new PolicyIntakeError("Unsupported policy content format");
  }

  if (typeof input.policyText !== "string" || !input.policyText.trim()) {
    throw new PolicyIntakeError("Policy text cannot be empty");
  }
  if (input.policyText.includes("\u0000")) {
    throw new PolicyIntakeError("Policy text contains a null byte");
  }

  if (hasUnpairedSurrogate(input.policyText)) {
    throw new PolicyIntakeError("Policy text contains an unpaired UTF-16 surrogate");
  }

  const contentBytes = Buffer.byteLength(input.policyText, "utf8");
  if (contentBytes > MAX_POLICY_TEXT_BYTES) {
    throw new PolicyIntakeError(
      "Policy text exceeds the " + MAX_POLICY_TEXT_BYTES + " byte intake limit"
    );
  }

  const contentSha256 = createHash("sha256")
    .update(input.policyText, "utf8")
    .digest("hex");

  return Object.freeze({
    snapshotId: "sha256:" + contentSha256,
    programId,
    platform,
    sourceUrl,
    retrievedAt,
    contentFormat: input.contentFormat,
    contentSha256,
    contentBytes,
    policyText: input.policyText,
    authorized: false as const
  });
}

/**
 * Compares snapshots only when they refer to the same program and source.
 * A timestamp regression is surfaced rather than silently treated as a new
 * current version. Content hashes are over the exact supplied text.
 */
export function comparePolicySnapshots(
  previous: PolicySnapshot,
  current: PolicySnapshot
): PolicyVersionComparison {
  if (!previous || !current) {
    throw new PolicyIntakeError("Both policy snapshots are required");
  }
  if (
    previous.programId !== current.programId ||
    previous.platform !== current.platform ||
    previous.sourceUrl !== current.sourceUrl
  ) {
    throw new PolicyIntakeError("Snapshots must refer to the same program, platform, and source URL");
  }

  const previousTime = Date.parse(previous.retrievedAt);
  const currentTime = Date.parse(current.retrievedAt);
  const contentChanged = previous.contentSha256 !== current.contentSha256;

  if (currentTime === previousTime && contentChanged) {
    return Object.freeze({
      status: "timestamp-conflict" as const,
      previousSnapshotId: previous.snapshotId,
      currentSnapshotId: current.snapshotId,
      previousSha256: previous.contentSha256,
      currentSha256: current.contentSha256,
      contentChanged: true,
      reason: "Different policy text has the same retrieval timestamp; preserve both and resolve provenance before promotion",
      authorized: false as const
    });
  }

  if (currentTime < previousTime) {
    return Object.freeze({
      status: "out-of-order" as const,
      previousSnapshotId: previous.snapshotId,
      currentSnapshotId: current.snapshotId,
      previousSha256: previous.contentSha256,
      currentSha256: current.contentSha256,
      contentChanged,
      reason: "Current snapshot was retrieved before the previous snapshot; preserve both and resolve ordering",
      authorized: false as const
    });
  }

  return Object.freeze({
    status: contentChanged ? "changed" as const : "unchanged" as const,
    previousSnapshotId: previous.snapshotId,
    currentSnapshotId: current.snapshotId,
    previousSha256: previous.contentSha256,
    currentSha256: current.contentSha256,
    contentChanged,
    reason: contentChanged
      ? "Exact policy text differs; require policy re-extraction and human review"
      : "Exact policy text is unchanged",
    authorized: false as const
  });
}

function validateSourceUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(requiredText(value, "sourceUrl"));
  } catch {
    throw new PolicyIntakeError("sourceUrl must be a valid HTTPS URL");
  }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new PolicyIntakeError("sourceUrl must use HTTPS and cannot contain credentials");
  }
  return url.toString();
}

function validateTimestamp(value: string): string {
  const match = typeof value === "string"
    ? /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-](\d{2}):(\d{2}))$/.exec(value)
    : null;
  if (!match || !ISO_DATE_WITH_ZONE.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new PolicyIntakeError("retrievedAt must be an ISO-8601 timestamp with timezone");
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offsetHour = match[8] ? Number(match[8]) : 0;
  const offsetMinute = match[9] ? Number(match[9]) : 0;
  const calendar = new Date(Date.UTC(year, month - 1, day));
  const validCalendarDate = calendar.getUTCFullYear() === year &&
    calendar.getUTCMonth() === month - 1 &&
    calendar.getUTCDate() === day;
  const validClock = hour <= 23 && minute <= 59 && second <= 59;
  const validOffset = offsetHour <= 14 && offsetMinute <= 59 &&
    (offsetHour !== 14 || offsetMinute === 0);
  if (!validCalendarDate || !validClock || !validOffset) {
    throw new PolicyIntakeError("retrievedAt contains an invalid calendar date, clock time, or UTC offset");
  }
  return new Date(value).toISOString();
}

function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true;
    }
  }
  return false;
}

function requiredText(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new PolicyIntakeError(name + " is required");
  }
  return value.trim();
}

export class PolicyIntakeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PolicyIntakeError";
  }
}
