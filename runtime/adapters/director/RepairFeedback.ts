import type { DirectorCommand } from "../../../packages/intelligence/director/DirectorCommandRouter";
import { LlamaCppInferenceError } from "../llama-cpp/errors";

export const REPAIR_FEEDBACK_CONTRACT = "host-artifact-summary-v1";
const MAX_FINDINGS = 3;
const MAX_FINDING_CHARACTERS = 200;
const MAX_TESTS = 10_000;

/** Host projection provenance, not a permission, approval, or trusted instruction. */
export interface RepairFeedback {
  readonly feedbackContract: typeof REPAIR_FEEDBACK_CONTRACT;
  readonly status: "ready" | "quarantined";
  readonly toolId: string;
  readonly version: number;
  readonly digest: string;
  readonly testSummary: {
    readonly passed: boolean;
    readonly testsRun: number;
    readonly testsPassed: number;
    readonly findings: readonly string[];
    readonly findingsTotal: number;
    readonly findingsIncluded: number;
    readonly findingsTextTruncated: boolean;
    readonly findingsTruncated: boolean;
  };
}

/**
 * Project the actual workshop result before the generic runner snapshots it.
 * Full source and findings remain in the artifact store; no source is executed
 * or rewritten here. The runner still sanitizes/freezes this bounded projection.
 */
export function projectRepairFeedback(input: { command: Readonly<DirectorCommand>; result: unknown }): RepairFeedback {
  if (!input || input.command?.kind !== "develop-tool" || !isRecord(input.command.spec) || !isRecord(input.result)) {
    throw invalid("Repair feedback requires an actual develop-tool result");
  }
  const result = input.result;
  const summary = isRecord(result.testSummary) ? result.testSummary : {};
  if (!isRecord(result.spec) || result.spec.id !== result.toolId || result.toolId !== input.command.spec.id ||
      !Array.isArray(summary.findings) || summary.findings.length > MAX_TESTS ||
      !summary.findings.every(finding => typeof finding === "string")) {
    throw invalid("Repair artifact identity or findings are invalid");
  }
  const originalFindings = summary.findings as string[];
  const selected = originalFindings.slice(0, MAX_FINDINGS);
  const findings = selected.map(clipFinding);
  const findingsTextTruncated = selected.some((finding, index) => finding !== findings[index]);
  return parseRepairFeedback({
    feedbackContract: REPAIR_FEEDBACK_CONTRACT,
    status: result.status,
    toolId: result.toolId,
    version: result.version,
    digest: result.digest,
    testSummary: {
      passed: summary.passed,
      testsRun: summary.testsRun,
      testsPassed: summary.testsPassed,
      findings,
      findingsTotal: originalFindings.length,
      findingsIncluded: findings.length,
      findingsTextTruncated,
      findingsTruncated: originalFindings.length > findings.length || findingsTextTruncated
    }
  });
}

/** Validate an explicitly selected projected observation; never infer authority from it. */
export function parseRepairFeedback(value: unknown): RepairFeedback {
  if (!isRecord(value) || !hasExactly(value, ["feedbackContract", "status", "toolId", "version", "digest", "testSummary"]) ||
      value.feedbackContract !== REPAIR_FEEDBACK_CONTRACT ||
      !["ready", "quarantined"].includes(String(value.status)) ||
      typeof value.toolId !== "string" || value.toolId.length > 128 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.toolId) ||
      !Number.isSafeInteger(value.version) || (value.version as number) < 1 ||
      typeof value.digest !== "string" || !/^[a-f0-9]{64}$/.test(value.digest) || !isRecord(value.testSummary)) {
    throw invalid("A complete bounded workshop feedback observation is required");
  }
  const summary = value.testSummary;
  if (!hasExactly(summary, ["passed", "testsRun", "testsPassed", "findings", "findingsTotal", "findingsIncluded",
        "findingsTextTruncated", "findingsTruncated"]) ||
      typeof summary.passed !== "boolean" ||
      !boundedInteger(summary.testsRun, MAX_TESTS) || !boundedInteger(summary.testsPassed, summary.testsRun as number) ||
      (summary.passed && (summary.testsRun === 0 || summary.testsPassed !== summary.testsRun)) ||
      !boundedInteger(summary.findingsTotal, MAX_TESTS) || !boundedInteger(summary.findingsIncluded, MAX_FINDINGS) ||
      !Array.isArray(summary.findings) || summary.findings.length !== summary.findingsIncluded ||
      summary.findingsIncluded !== Math.min(summary.findingsTotal as number, MAX_FINDINGS) ||
      typeof summary.findingsTextTruncated !== "boolean" || typeof summary.findingsTruncated !== "boolean" ||
      !summary.findings.every(finding => typeof finding === "string" && finding.length <= MAX_FINDING_CHARACTERS &&
        Buffer.from(finding, "utf8").toString("utf8") === finding) ||
      (summary.findingsIncluded === 0 && summary.findingsTextTruncated) ||
      summary.findingsTruncated !== ((summary.findingsTotal as number) > (summary.findingsIncluded as number) || summary.findingsTextTruncated)) {
    throw invalid("Workshop feedback counts or truncation metadata are inconsistent");
  }
  const ready = summary.passed && (summary.testsRun as number) > 0 && summary.testsPassed === summary.testsRun;
  if (value.status !== (ready ? "ready" : "quarantined")) {
    throw invalid("Workshop artifact status and observed test summary disagree");
  }
  return {
    feedbackContract: REPAIR_FEEDBACK_CONTRACT,
    status: value.status as RepairFeedback["status"],
    toolId: value.toolId,
    version: value.version as number,
    digest: value.digest,
    testSummary: {
      passed: summary.passed,
      testsRun: summary.testsRun as number,
      testsPassed: summary.testsPassed as number,
      findings: [...summary.findings] as string[],
      findingsTotal: summary.findingsTotal as number,
      findingsIncluded: summary.findingsIncluded as number,
      findingsTextTruncated: summary.findingsTextTruncated,
      findingsTruncated: summary.findingsTruncated
    }
  };
}

function clipFinding(finding: string): string {
  let clipped = finding.slice(0, MAX_FINDING_CHARACTERS);
  // Do not turn a valid surrogate pair at the boundary into invalid Unicode.
  if (clipped.length < finding.length && /[\uD800-\uDBFF]$/.test(clipped) &&
      /^[\uDC00-\uDFFF]/.test(finding.slice(clipped.length))) clipped = clipped.slice(0, -1);
  return clipped;
}

function boundedInteger(value: unknown, maximum: number): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= maximum;
}

function hasExactly(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every(key => keys.includes(key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function invalid(message: string): LlamaCppInferenceError {
  return new LlamaCppInferenceError("invalid_request", message);
}
