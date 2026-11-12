import { randomUUID } from "node:crypto";
import { validateInterpretationEvidence } from "../interpretation";
import type {
  PolicyReviewAgent,
  PolicyReviewAgentPayload,
  PolicyReviewCompleted,
  PolicyReviewFailureCode,
  PolicyReviewFailed,
  PolicyReviewFinding,
  PolicyReviewFindingCode,
  PolicyReviewAgentSet,
  PolicyReviewRequest,
  PolicyReviewRun,
  PolicyReviewSeverity,
  PolicyReviewerRole
} from "./types";

const FINDING_CODES = new Set<string>([
  "omitted-condition",
  "misclassified-clause",
  "ambiguous-permission",
  "conflicting-policy",
  "unsupported-value",
  "evidence-mismatch",
  "other"
]);
const SEVERITIES = new Set<string>(["critical", "high", "medium", "low", "info"]);

export class PolicyReviewError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PolicyReviewError";
  }
}

/**
 * Runs two separate reviewer executions over the same immutable policy input.
 * The Critic never receives Validator output, and the Validator never receives
 * Critic output. This coordinator does not calculate consensus or authority.
 */
export async function runIndependentPolicyReviews(
  request: PolicyReviewRequest,
  agents: PolicyReviewAgentSet,
  now: () => Date = () => new Date()
): Promise<PolicyReviewRun> {
  if (!agents?.critic || !agents?.validator ||
      agents.critic.reviewer !== "critic" || agents.validator.reviewer !== "validator") {
    throw new PolicyReviewError("Distinct Critic and Validator agents are required");
  }
  if (agents.critic === agents.validator) {
    throw new PolicyReviewError("Critic and Validator must be separate agent instances");
  }

  const evidence = validateInterpretationEvidence(request?.snapshot, request?.interpretation);
  if (!evidence.valid) {
    throw new PolicyReviewError("Policy interpretation evidence failed validation: " + evidence.reasons.join("; "));
  }

  const started = now();
  if (!(started instanceof Date) || !Number.isFinite(started.getTime())) {
    throw new PolicyReviewError("Review start time is invalid");
  }

  // The frozen packet contains only the source snapshot and interpretation.
  // No prior conversation, memory, target access, or peer-review result is passed.
  const packet = createSafePacket(request);

  const critic = await runOne("critic", agents.critic, packet);
  const validator = await runOne("validator", agents.validator, packet);
  const completed = now();
  if (!(completed instanceof Date) || !Number.isFinite(completed.getTime()) ||
      completed.getTime() < started.getTime()) {
    throw new PolicyReviewError("Review completion time is invalid");
  }

  const reviews = Object.freeze([critic, validator]) as readonly [typeof critic, typeof validator];
  const successful = reviews.filter(review => review.status === "completed").length;
  const status = successful === 2 ? "complete" : successful === 1 ? "partial" : "failed";

  return Object.freeze({
    runId: randomUUID(),
    snapshotId: request.snapshot.snapshotId,
    contentSha256: request.snapshot.contentSha256,
    startedAt: started.toISOString(),
    completedAt: completed.toISOString(),
    status,
    reviews,
    requiresHumanReview: true as const,
    authorized: false as const
  });
}

async function runOne(
  reviewer: PolicyReviewerRole,
  agent: PolicyReviewAgent,
  request: PolicyReviewRequest
): Promise<PolicyReviewCompleted | PolicyReviewFailed> {
  let payload: unknown;
  try {
    payload = await agent.review(request);
  } catch {
    return failure(reviewer, request, "execution-failed",
      "The reviewer execution failed; inspect the configured inference provider logs.");
  }

  try {
    const normalized = validateAgentPayload(payload, request, reviewer);
    return Object.freeze({
      reviewer,
      status: "completed" as const,
      snapshotId: request.snapshot.snapshotId,
      contentSha256: request.snapshot.contentSha256,
      summary: normalized.summary,
      findings: normalized.findings,
      authorized: false as const
    });
  } catch {
    return failure(reviewer, request, "invalid-response",
      "The reviewer returned a malformed or ungrounded response; human review is required.");
  }
}

function failure(
  reviewer: PolicyReviewerRole,
  request: PolicyReviewRequest,
  failureCode: PolicyReviewFailureCode,
  message: string
): PolicyReviewFailed {
  return Object.freeze({
    reviewer,
    status: "failed",
    snapshotId: request.snapshot.snapshotId,
    contentSha256: request.snapshot.contentSha256,
    failureCode,
    message,
    authorized: false as const
  });
}

function validateAgentPayload(
  payload: unknown,
  request: PolicyReviewRequest,
  reviewer: PolicyReviewerRole
): PolicyReviewAgentPayload {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new PolicyReviewError("Reviewer payload must be an object");
  }
  const record = payload as Record<string, unknown>;
  if (Object.keys(record).sort().join(",") !== "findings,summary") {
    throw new PolicyReviewError("Reviewer payload must contain only summary and findings");
  }
  if (typeof record.summary !== "string" || !record.summary.trim() || record.summary.length > 4000) {
    throw new PolicyReviewError("Reviewer summary is invalid");
  }
  if (!Array.isArray(record.findings) || record.findings.length > 100) {
    throw new PolicyReviewError("Reviewer findings must be an array of at most 100 items");
  }

  const clauses = new Map(request.interpretation.clauses.map(clause => [clause.clauseId, clause]));
  const findings = record.findings.map((value, index) =>
    validateFinding(value, request, clauses, reviewer, index)
  );
  return Object.freeze({
    summary: record.summary.trim(),
    findings: Object.freeze(findings)
  });
}

function validateFinding(
  value: unknown,
  request: PolicyReviewRequest,
  clauses: ReadonlyMap<string, PolicyReviewRequest["interpretation"]["clauses"][number]>,
  reviewer: PolicyReviewerRole,
  index: number
): PolicyReviewFinding {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PolicyReviewError(reviewer + " finding " + index + " is malformed");
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort().join(",");
  const allowedWithClause = "clauseId,code,endOffset,explanation,severity,sourceText,startOffset";
  const allowedWithoutClause = "code,endOffset,explanation,severity,sourceText,startOffset";
  if (keys !== allowedWithClause && keys !== allowedWithoutClause) {
    throw new PolicyReviewError(reviewer + " finding " + index + " has unexpected fields");
  }
  if (typeof record.code !== "string" || !FINDING_CODES.has(record.code) ||
      typeof record.severity !== "string" || !SEVERITIES.has(record.severity)) {
    throw new PolicyReviewError(reviewer + " finding " + index + " has an unsupported code or severity");
  }
  if (record.clauseId !== undefined && typeof record.clauseId !== "string") {
    throw new PolicyReviewError(reviewer + " finding " + index + " has an invalid clause ID");
  }
  if (!Number.isInteger(record.startOffset) || !Number.isInteger(record.endOffset) ||
      (record.startOffset as number) < 0 || (record.endOffset as number) <= (record.startOffset as number) ||
      (record.endOffset as number) > request.snapshot.policyText.length) {
    throw new PolicyReviewError(reviewer + " finding " + index + " has invalid source offsets");
  }
  const startOffset = record.startOffset as number;
  const endOffset = record.endOffset as number;
  const sourceText = request.snapshot.policyText.slice(startOffset, endOffset);
  if (typeof record.sourceText !== "string" || record.sourceText !== sourceText ||
      !isCompleteSourceLine(request.snapshot.policyText, startOffset, endOffset)) {
    throw new PolicyReviewError(reviewer + " finding " + index + " is not grounded in a complete exact source line");
  }
  if (typeof record.explanation !== "string" || !record.explanation.trim() || record.explanation.length > 2000) {
    throw new PolicyReviewError(reviewer + " finding " + index + " has an invalid explanation");
  }
  if (typeof record.clauseId === "string") {
    const clause = clauses.get(record.clauseId);
    if (!clause || clause.startOffset !== startOffset || clause.endOffset !== endOffset) {
      throw new PolicyReviewError(reviewer + " finding " + index + " references a mismatched clause");
    }
  }

  return Object.freeze({
    code: record.code as PolicyReviewFindingCode,
    severity: record.severity as PolicyReviewSeverity,
    ...(typeof record.clauseId === "string" ? { clauseId: record.clauseId } : {}),
    startOffset,
    endOffset,
    sourceText,
    explanation: record.explanation.trim()
  });
}

function createSafePacket(request: PolicyReviewRequest): PolicyReviewRequest {
  const snapshot = {
    snapshotId: request.snapshot.snapshotId,
    programId: request.snapshot.programId,
    platform: request.snapshot.platform,
    sourceUrl: request.snapshot.sourceUrl,
    retrievedAt: request.snapshot.retrievedAt,
    contentFormat: request.snapshot.contentFormat,
    contentSha256: request.snapshot.contentSha256,
    contentBytes: request.snapshot.contentBytes,
    policyText: request.snapshot.policyText,
    authorized: false as const
  };
  const clauses = request.interpretation.clauses.map(clause => ({
    clauseId: clause.clauseId,
    kind: clause.kind,
    text: clause.text,
    startOffset: clause.startOffset,
    endOffset: clause.endOffset,
    line: clause.line,
    extractionMethod: clause.extractionMethod,
    ...(clause.candidateValue ? { candidateValue: cloneCandidateValue(clause.candidateValue) } : {}),
    snapshotId: clause.snapshotId,
    contentSha256: clause.contentSha256,
    requiresHumanReview: true as const
  }));
  const issues = request.interpretation.issues.map(issue => ({
    code: issue.code,
    message: issue.message,
    clauseIds: [...issue.clauseIds]
  }));
  const interpretation = {
    parserVersion: request.interpretation.parserVersion,
    snapshotId: request.interpretation.snapshotId,
    programId: request.interpretation.programId,
    sourceUrl: request.interpretation.sourceUrl,
    contentSha256: request.interpretation.contentSha256,
    interpretedAt: request.interpretation.interpretedAt,
    clauses,
    issues,
    reviewState: "needs-human-review" as const,
    authorized: false as const
  };
  return deepFreeze({ snapshot, interpretation });
}

function cloneCandidateValue(
  value: NonNullable<PolicyReviewRequest["interpretation"]["clauses"][number]["candidateValue"]>
): NonNullable<PolicyReviewRequest["interpretation"]["clauses"][number]["candidateValue"]> {
  if (value.kind === "asset") {
    return { kind: "asset", assetKind: value.assetKind, value: value.value };
  }
  if (value.kind === "rate-limit") {
    return { kind: "rate-limit", limit: value.limit, unit: value.unit };
  }
  return { kind: "testing-window", startsAt: value.startsAt, endsAt: value.endsAt };
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

function isCompleteSourceLine(text: string, start: number, end: number): boolean {
  let lineStart = start;
  while (lineStart > 0 && text[lineStart - 1] !== "\n" && text[lineStart - 1] !== "\r") {
    lineStart -= 1;
  }
  let lineEnd = end;
  while (lineEnd < text.length && text[lineEnd] !== "\n" && text[lineEnd] !== "\r") {
    lineEnd += 1;
  }
  return lineStart === start && lineEnd === end;
}
