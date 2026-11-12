import { createHash } from "node:crypto";
import { isIP } from "node:net";
import type { PolicySnapshot } from "../intake";
import type {
  ExtractedPolicyClause,
  InterpretationEvidenceValidation,
  PolicyClauseKind,
  PolicyExtractionMethod,
  PolicyInterpretation,
  PolicyInterpretationIssue,
  PolicyReviewAssignment
} from "./types";

interface SourceLine {
  readonly text: string;
  readonly startOffset: number;
  readonly endOffset: number;
  readonly line: number;
}

interface Classification {
  readonly kind: PolicyClauseKind;
  readonly method: PolicyExtractionMethod;
}

export class PolicyInterpretationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PolicyInterpretationError";
  }
}

/**
 * Segments a supplied policy snapshot and labels only explicit headings,
 * labels, and narrow keyword patterns. It does not infer permission from prose.
 * Every clause remains review-required and every interpretation is unauthorized.
 */
export function interpretPolicySnapshot(
  snapshot: PolicySnapshot,
  interpretedAt: Date = new Date()
): PolicyInterpretation {
  assertSnapshotIntegrity(snapshot);
  if (!(interpretedAt instanceof Date) || !Number.isFinite(interpretedAt.getTime())) {
    throw new PolicyInterpretationError("interpretedAt must be a valid Date");
  }

  const clauses: ExtractedPolicyClause[] = [];
  const issues: PolicyInterpretationIssue[] = [];
  let activeSection: PolicyClauseKind | undefined;

  for (const sourceLine of splitSourceLines(snapshot.policyText)) {
    const trimmed = sourceLine.text.trim();
    if (!trimmed) continue;

    const heading = classifyHeading(trimmed);
    if (heading) {
      activeSection = heading;
      continue;
    }

    const classification = classifyClause(trimmed, activeSection);
    const clauseId = "clause-" + String(clauses.length + 1).padStart(4, "0");
    const candidateValue = extractCandidateValue(classification.kind, sourceLine.text);
    const clause = Object.freeze({
      clauseId,
      kind: classification.kind,
      text: sourceLine.text,
      startOffset: sourceLine.startOffset,
      endOffset: sourceLine.endOffset,
      line: sourceLine.line,
      extractionMethod: classification.method,
      ...(candidateValue ? { candidateValue } : {}),
      snapshotId: snapshot.snapshotId,
      contentSha256: snapshot.contentSha256,
      requiresHumanReview: true as const
    });
    clauses.push(clause);

    if (classification.kind === "unclassified") {
      issues.push(Object.freeze({
        code: "unclassified-clause" as const,
        message: "Clause did not match a supported explicit policy pattern",
        clauseIds: Object.freeze([clauseId])
      }));
    } else if (classification.kind === "ambiguous") {
      issues.push(Object.freeze({
        code: "ambiguous-language" as const,
        message: "Clause contains mixed or qualified language and requires human interpretation",
        clauseIds: Object.freeze([clauseId])
      }));
    } else if (requiresStrictCandidate(classification.kind) && !candidateValue) {
      issues.push(Object.freeze({
        code: "unparsed-candidate" as const,
        message: "Clause category was recognized, but its value did not match a supported explicit format",
        clauseIds: Object.freeze([clauseId])
      }));
    }
  }

  addPotentialConflictIssue(clauses, "rate-limit", issues,
    "Multiple rate-limit clauses were found; reconcile them against the source policy");
  addPotentialConflictIssue(clauses, "testing-window", issues,
    "Multiple testing-window clauses were found; reconcile them against the source policy");

  return Object.freeze({
    parserVersion: "1.0.0" as const,
    snapshotId: snapshot.snapshotId,
    programId: snapshot.programId,
    sourceUrl: snapshot.sourceUrl,
    contentSha256: snapshot.contentSha256,
    interpretedAt: interpretedAt.toISOString(),
    clauses: Object.freeze(clauses),
    issues: Object.freeze(issues),
    reviewState: "needs-human-review" as const,
    authorized: false as const
  });
}

/**
 * A deterministic evidence-integrity check. This is not semantic approval and
 * cannot promote a policy or authorize any action.
 */
export function validateInterpretationEvidence(
  snapshot: PolicySnapshot,
  interpretation: PolicyInterpretation
): InterpretationEvidenceValidation {
  const reasons: string[] = [];
  try {
    assertSnapshotIntegrity(snapshot);
  } catch (error) {
    reasons.push(error instanceof Error ? error.message : "Snapshot integrity check failed");
  }

  if (interpretation.snapshotId !== snapshot.snapshotId) {
    reasons.push("Interpretation snapshot ID does not match the supplied snapshot");
  }
  if (interpretation.contentSha256 !== snapshot.contentSha256) {
    reasons.push("Interpretation content hash does not match the supplied snapshot");
  }
  if (interpretation.programId !== snapshot.programId || interpretation.sourceUrl !== snapshot.sourceUrl) {
    reasons.push("Interpretation program or source metadata does not match the supplied snapshot");
  }
  if (interpretation.authorized !== false || interpretation.reviewState !== "needs-human-review") {
    reasons.push("Interpretation authority or review-state invariant was changed");
  }

  const seen = new Set<string>();
  for (const clause of interpretation.clauses) {
    if (seen.has(clause.clauseId)) reasons.push("Duplicate clause ID: " + clause.clauseId);
    seen.add(clause.clauseId);
    if (clause.snapshotId !== snapshot.snapshotId || clause.contentSha256 !== snapshot.contentSha256) {
      reasons.push("Clause provenance does not match the supplied snapshot: " + clause.clauseId);
    }
    if (!Number.isInteger(clause.startOffset) || !Number.isInteger(clause.endOffset) ||
        clause.startOffset < 0 || clause.endOffset < clause.startOffset ||
        clause.endOffset > snapshot.policyText.length) {
      reasons.push("Clause offsets are outside the source text: " + clause.clauseId);
      continue;
    }
    if (snapshot.policyText.slice(clause.startOffset, clause.endOffset) !== clause.text) {
      reasons.push("Clause text does not match its source offsets: " + clause.clauseId);
    }
    const actualLine = snapshot.policyText.slice(0, clause.startOffset).split(/\r\n|\n|\r/).length;
    if (actualLine !== clause.line) {
      reasons.push("Clause line number does not match its source offset: " + clause.clauseId);
    }
    const expectedCandidate = extractCandidateValue(clause.kind, clause.text);
    if (JSON.stringify(expectedCandidate) !== JSON.stringify(clause.candidateValue)) {
      reasons.push("Candidate value does not match the explicit source text: " + clause.clauseId);
    }
    if (clause.requiresHumanReview !== true) {
      reasons.push("Clause cannot bypass human review: " + clause.clauseId);
    }
  }

  return Object.freeze({
    valid: reasons.length === 0,
    snapshotId: snapshot.snapshotId,
    reasons: Object.freeze(reasons),
    authorized: false as const
  });
}

/** Returns pending assignments only; it does not invoke or impersonate agents. */
export function createPolicyReviewAssignments(
  interpretation: PolicyInterpretation
): readonly PolicyReviewAssignment[] {
  return Object.freeze([
    Object.freeze({
      reviewer: "critic" as const,
      status: "pending" as const,
      snapshotId: interpretation.snapshotId,
      focus: "Challenge extraction assumptions, identify ambiguity, omitted constraints, and possible policy conflicts",
      completed: false as const,
      authorized: false as const
    }),
    Object.freeze({
      reviewer: "validator" as const,
      status: "pending" as const,
      snapshotId: interpretation.snapshotId,
      focus: "Independently verify source hash, clause offsets, source text, and structural invariants",
      completed: false as const,
      authorized: false as const
    })
  ]);
}

function assertSnapshotIntegrity(snapshot: PolicySnapshot): void {
  if (!snapshot || typeof snapshot !== "object" || typeof snapshot.policyText !== "string") {
    throw new PolicyInterpretationError("A valid policy snapshot is required");
  }
  if (snapshot.authorized !== false) {
    throw new PolicyInterpretationError("Policy snapshot must remain unauthorized");
  }
  if (hasUnpairedSurrogate(snapshot.policyText)) {
    throw new PolicyInterpretationError("Policy snapshot contains an unpaired UTF-16 surrogate");
  }
  const digest = createHash("sha256").update(snapshot.policyText, "utf8").digest("hex");
  if (digest !== snapshot.contentSha256 || snapshot.snapshotId !== "sha256:" + digest) {
    throw new PolicyInterpretationError("Policy snapshot content hash or snapshot ID is invalid");
  }
  if (snapshot.contentBytes !== Buffer.byteLength(snapshot.policyText, "utf8")) {
    throw new PolicyInterpretationError("Policy snapshot byte length does not match its exact text");
  }
}

function splitSourceLines(text: string): SourceLine[] {
  const lines: SourceLine[] = [];
  let offset = 0;
  let line = 1;
  while (offset < text.length) {
    let end = offset;
    while (end < text.length && text[end] !== "\n" && text[end] !== "\r") end += 1;
    lines.push({
      text: text.slice(offset, end),
      startOffset: offset,
      endOffset: end,
      line
    });
    if (text[end] === "\r" && text[end + 1] === "\n") offset = end + 2;
    else if (end < text.length) offset = end + 1;
    else offset = end;
    line += 1;
  }
  return lines;
}

function classifyHeading(line: string): PolicyClauseKind | undefined {
  const heading = line.replace(/^#{1,6}\s*/, "").replace(/:$/, "").trim();
  const classification = classifyLabel(heading);
  return classification?.kind;
}

function classifyClause(line: string, activeSection?: PolicyClauseKind): Classification {
  const cleaned = line.replace(/^(?:[-*+]\s+|\d+[.)]\s+)/, "").trim();
  const colon = cleaned.indexOf(":");
  if (colon > 0) {
    const explicitLabel = classifyLabel(cleaned.slice(0, colon));
    if (explicitLabel) return explicitLabel;
  }
  const explicit = classifyLabel(cleaned);
  if (explicit) return explicit;

  if (/\b(?:case[- ]by[- ]case|contact (?:the )?program|where possible|at our discretion|subject to approval|may be permitted)\b/i.test(cleaned)) {
    return { kind: "ambiguous", method: "keyword-pattern" };
  }

  const mentionsDisclosure = /\bdisclos(?:e|ure|ing)\b|\bpublic release\b/i.test(cleaned);
  const allows = /\b(?:allowed|permitted|may test)\b/i.test(cleaned);
  const prohibits = /\b(?:prohibited|forbidden|not allowed|not permitted|must not|do not)\b/i.test(cleaned);
  if (allows && prohibits) return { kind: "ambiguous", method: "keyword-pattern" };
  if (mentionsDisclosure) return { kind: "disclosure", method: "keyword-pattern" };
  if (/\b(?:requests?\s*(?:per|\/)\s*(?:second|sec|minute|min)|rate limit)\b/i.test(cleaned)) {
    return { kind: "rate-limit", method: "keyword-pattern" };
  }
  if (/\b(?:testing window|testing hours|test window)\b/i.test(cleaned)) {
    return { kind: "testing-window", method: "keyword-pattern" };
  }
  if (prohibits || /\b(?:denial of service|social engineering|credential stuffing)\b/i.test(cleaned)) {
    return { kind: "prohibited-method", method: "keyword-pattern" };
  }
  if (allows) return { kind: "allowed-activity", method: "keyword-pattern" };
  if (activeSection) return { kind: activeSection, method: "section-context" };
  if (/\b(?:case[- ]by[- ]case|contact (?:the )?program|where possible|at our discretion)\b/i.test(cleaned)) {
    return { kind: "ambiguous", method: "keyword-pattern" };
  }
  return { kind: "unclassified", method: "keyword-pattern" };
}

function classifyLabel(value: string): Classification | undefined {
  const label = value.replace(/^[-*+]\s+/, "").trim().toLowerCase();
  if (/^(?:in[- ]scope|included assets?|scope inclusion)$/.test(label)) {
    return { kind: "scope-inclusion", method: "explicit-label" };
  }
  if (/^(?:out[- ]of[- ]scope|excluded assets?|scope exclusions?)$/.test(label)) {
    return { kind: "scope-exclusion", method: "explicit-label" };
  }
  if (/^(?:allowed(?: testing)? activities|permitted activities|allowed testing)$/.test(label)) {
    return { kind: "allowed-activity", method: "explicit-label" };
  }
  if (/^(?:prohibited(?: testing)? activities|forbidden methods|prohibited methods)$/.test(label)) {
    return { kind: "prohibited-method", method: "explicit-label" };
  }
  if (/^(?:rate limits?|request limits?)$/.test(label)) {
    return { kind: "rate-limit", method: "explicit-label" };
  }
  if (/^(?:testing windows?|testing hours|test windows?)$/.test(label)) {
    return { kind: "testing-window", method: "explicit-label" };
  }
  if (/^(?:disclosure|disclosure rules?|coordinated disclosure)$/.test(label)) {
    return { kind: "disclosure", method: "explicit-label" };
  }
  return undefined;
}

function requiresStrictCandidate(kind: PolicyClauseKind): boolean {
  return kind === "scope-inclusion" || kind === "scope-exclusion" ||
    kind === "rate-limit" || kind === "testing-window";
}

function extractCandidateValue(
  kind: PolicyClauseKind,
  sourceLine: string
): ExtractedPolicyClause["candidateValue"] {
  if (!requiresStrictCandidate(kind)) return undefined;

  let value = sourceLine.trim().replace(/^(?:[-*+]\s+|\d+[.)]\s+)/, "").trim();
  const colon = value.indexOf(":");
  if (colon > 0 && classifyLabel(value.slice(0, colon))) {
    value = value.slice(colon + 1).trim();
  }

  if (kind === "scope-inclusion" || kind === "scope-exclusion") {
    const slash = value.lastIndexOf("/");
    if (slash > 0) {
      const address = value.slice(0, slash);
      const prefix = value.slice(slash + 1);
      const version = isIP(address);
      const maximum = version === 4 ? 32 : version === 6 ? 128 : -1;
      if (maximum >= 0 && /^\d+$/.test(prefix) && Number(prefix) <= maximum) {
        return Object.freeze({ kind: "asset" as const, assetKind: "cidr" as const, value });
      }
    }
    if (isIP(value) !== 0) {
      return Object.freeze({ kind: "asset" as const, assetKind: "ip" as const, value });
    }
    if (/^(?:\*\.)?(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.?$/i.test(value)) {
      return Object.freeze({ kind: "asset" as const, assetKind: "domain" as const, value });
    }
    try {
      const url = new URL(value);
      if ((url.protocol === "https:" || url.protocol === "http:") &&
          !url.username && !url.password && !url.search && !url.hash) {
        return Object.freeze({ kind: "asset" as const, assetKind: "url" as const, value });
      }
    } catch {
      // Non-URL scope text remains an unparsed candidate for human review.
    }
    return undefined;
  }

  if (kind === "rate-limit") {
    const matches = [...value.matchAll(/\b(\d+(?:\.\d+)?)\s*(?:requests?|reqs?)\s*(?:per|\/)\s*(second|sec|minute|min)\b/gi)];
    if (matches.length !== 1) return undefined;
    const limit = Number(matches[0][1]);
    if (!Number.isFinite(limit) || limit <= 0) return undefined;
    const unit = /^(?:second|sec)$/i.test(matches[0][2])
      ? "requests-per-second" as const
      : "requests-per-minute" as const;
    return Object.freeze({ kind: "rate-limit" as const, limit, unit });
  }

  if (kind === "testing-window") {
    const timestamp = "\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,3})?(?:Z|[+-]\\d{2}:\\d{2})";
    const match = new RegExp("^(" + timestamp + ")\\s+(?:to|through|until)\\s+(" + timestamp + ")$", "i").exec(value);
    if (!match || !isStrictZonedTimestamp(match[1]) || !isStrictZonedTimestamp(match[2]) ||
        Date.parse(match[2]) <= Date.parse(match[1])) {
      return undefined;
    }
    return Object.freeze({
      kind: "testing-window" as const,
      startsAt: match[1],
      endsAt: match[2]
    });
  }
  return undefined;
}

function isStrictZonedTimestamp(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|[+-](\d{2}):(\d{2}))$/.exec(value);
  if (!match || !Number.isFinite(Date.parse(value))) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offsetHour = match[7] ? Number(match[7]) : 0;
  const offsetMinute = match[8] ? Number(match[8]) : 0;
  const calendar = new Date(0);
  calendar.setUTCHours(0, 0, 0, 0);
  calendar.setUTCFullYear(year, month - 1, day);
  return month >= 1 && month <= 12 && day >= 1 && day <= 31 &&
    calendar.getUTCFullYear() === year && calendar.getUTCMonth() === month - 1 &&
    calendar.getUTCDate() === day && hour <= 23 && minute <= 59 && second <= 59 &&
    offsetHour <= 14 && offsetMinute <= 59 && (offsetHour !== 14 || offsetMinute === 0);
}

function addPotentialConflictIssue(
  clauses: readonly ExtractedPolicyClause[],
  kind: PolicyClauseKind,
  issues: PolicyInterpretationIssue[],
  message: string
): void {
  const matches = clauses.filter(clause => clause.kind === kind);
  const distinct = new Set(matches.map(clause => clause.text.trim().toLowerCase()));
  if (distinct.size > 1) {
    issues.push(Object.freeze({
      code: "potential-conflict" as const,
      message,
      clauseIds: Object.freeze(matches.map(clause => clause.clauseId))
    }));
  }
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
