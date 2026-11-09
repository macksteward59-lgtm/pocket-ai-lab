/**
 * Evidence report builder.
 *
 * A research finding is only as trustworthy as its evidence. This module
 * builds a report's evidence section exclusively from entries the delegation
 * gate itself recorded (DelegationAuditEntry, see ./delegation.ts) -- it never
 * accepts a free-text "evidence signature" from a caller, and it never
 * fabricates one. If the audit log has no allowed entry for a task, no report
 * can be built for that task: that is the whole point.
 *
 * This module does not decide whether findings are true; it only decides
 * whether a report is *allowed to claim* a given confidence level, based on
 * how much of that claim is backed by entries the gate actually recorded.
 */
import type { DelegationAuditEntry } from "./delegation";

export type VulnerabilityClass =
  | "logical-bypass"
  | "memory-corruption"
  | "race-condition"
  | "token-forgery"
  | "misconfiguration"
  | "information-disclosure"
  | "other";

export type ConfidenceLevel = "low" | "medium" | "high";

export type DisclosureStatus = "not-started" | "drafted" | "submitted" | "acknowledged" | "resolved";

/** One piece of evidence, copied verbatim from a real, allowed audit entry. Never hand-authored. */
export interface EvidenceRef {
  tool: string;
  scopeRef: string;
  at: string;
  voucherId?: string;
}

export interface EvidenceReportInput {
  taskId: string;
  classification: VulnerabilityClass;
  affectedComponent: string;
  attackSurface: string;
  /** Plain-language reproduction steps. No exploit code or payloads are accepted here (see validation). */
  reproductionSteps: string[];
  remediationRecommendations: string[];
  disclosureStatus: DisclosureStatus;
  /**
   * An independent confirmation from the Validator role that reproduction
   * succeeded outside of the original specialist's own run. Without this,
   * confidence cannot exceed "medium" regardless of evidence volume --
   * an agent's own say-so about its own finding is never sufficient.
   */
  validatorConfirmed: boolean;
}

export interface EvidenceReport {
  taskId: string;
  classification: VulnerabilityClass;
  affectedComponent: string;
  attackSurface: string;
  reproductionSteps: string[];
  remediationRecommendations: string[];
  disclosureStatus: DisclosureStatus;
  confidence: ConfidenceLevel;
  /** Every entry here comes verbatim from the gate's audit log for this task. */
  evidence: EvidenceRef[];
  generatedAt: string;
}

/** Phrases that suggest a "reproduction step" is actually exploit code/payload text rather than a description. */
const CODE_LIKE_PATTERNS = [/\bfunction\b[^.]*\(/i, /=>\s*{/, /<script/i, /\bexec\(/i, /\bpayload\s*=/i, /\{\s*\/\*/];

export interface BuildEvidenceReportOptions {
  /** Injectable clock for deterministic tests. */
  now?: () => Date;
  /** Minimum distinct allowed audit entries required to claim "high" confidence even when validated. Default 2. */
  minEntriesForHigh?: number;
}

export class EvidenceReportError extends Error {}

/**
 * Builds a report, or throws EvidenceReportError, from the gate's own audit
 * log plus a human-authored narrative. Throws rather than silently degrading,
 * so a caller cannot ship a fabricated or evidence-free report by accident.
 */
export function buildEvidenceReport(
  auditLog: DelegationAuditEntry[],
  input: EvidenceReportInput,
  options: BuildEvidenceReportOptions = {}
): EvidenceReport {
  const now = options.now ?? (() => new Date());
  const minEntriesForHigh = options.minEntriesForHigh ?? 2;

  if (!input.taskId?.trim()) throw new EvidenceReportError("taskId is required");
  if (!input.affectedComponent?.trim()) throw new EvidenceReportError("affectedComponent is required");
  if (!input.attackSurface?.trim()) throw new EvidenceReportError("attackSurface is required");
  if (!input.reproductionSteps?.length) throw new EvidenceReportError("At least one reproduction step is required");
  if (!input.remediationRecommendations?.length) throw new EvidenceReportError("At least one remediation recommendation is required");

  for (const step of input.reproductionSteps) {
    if (!step?.trim()) throw new EvidenceReportError("Reproduction steps must be non-empty text");
    if (CODE_LIKE_PATTERNS.some(pattern => pattern.test(step))) {
      throw new EvidenceReportError(
        "Reproduction steps must describe actions in plain language, not contain exploit code or payload text: " + step
      );
    }
  }

  const relevant = auditLog.filter(entry => entry.taskId === input.taskId);
  const allowed = relevant.filter(entry => entry.allowed);
  if (allowed.length === 0) {
    throw new EvidenceReportError(
      "No verified (gate-allowed) evidence exists for task " + input.taskId + "; a report cannot be built without it"
    );
  }

  const evidence: EvidenceRef[] = allowed.map(entry => ({
    tool: entry.tool,
    scopeRef: entry.scopeRef,
    at: entry.at,
    voucherId: entry.voucherId
  }));
  const distinctTools = new Set(evidence.map(e => e.tool + "@" + e.scopeRef)).size;

  let confidence: ConfidenceLevel = "low";
  if (input.validatorConfirmed && distinctTools >= 1) confidence = "medium";
  if (input.validatorConfirmed && distinctTools >= minEntriesForHigh) confidence = "high";

  return {
    taskId: input.taskId,
    classification: input.classification,
    affectedComponent: input.affectedComponent,
    attackSurface: input.attackSurface,
    reproductionSteps: [...input.reproductionSteps],
    remediationRecommendations: [...input.remediationRecommendations],
    disclosureStatus: input.disclosureStatus,
    confidence,
    evidence,
    generatedAt: now().toISOString()
  };
}

/** Renders a report as a disclosure-ready Markdown write-up. Pure formatting; adds no new claims. */
export function renderEvidenceReportMarkdown(report: EvidenceReport): string {
  const lines: string[] = [];
  lines.push(`# Security Finding: ${report.affectedComponent}`);
  lines.push("");
  lines.push(`- **Task:** ${report.taskId}`);
  lines.push(`- **Classification:** ${report.classification}`);
  lines.push(`- **Attack surface:** ${report.attackSurface}`);
  lines.push(`- **Confidence:** ${report.confidence}`);
  lines.push(`- **Disclosure status:** ${report.disclosureStatus}`);
  lines.push(`- **Generated:** ${report.generatedAt}`);
  lines.push("");
  lines.push("## Reproduction steps");
  report.reproductionSteps.forEach((step, i) => lines.push(`${i + 1}. ${step}`));
  lines.push("");
  lines.push("## Evidence");
  if (report.evidence.length === 0) {
    lines.push("_None._");
  } else {
    lines.push("| Tool | Scope | Recorded at | Voucher |");
    lines.push("|---|---|---|---|");
    report.evidence.forEach(e => lines.push(`| ${e.tool} | ${e.scopeRef} | ${e.at} | ${e.voucherId ?? "-"} |`));
  }
  lines.push("");
  lines.push("## Remediation recommendations");
  report.remediationRecommendations.forEach(rec => lines.push(`- ${rec}`));
  return lines.join("\n");
}
