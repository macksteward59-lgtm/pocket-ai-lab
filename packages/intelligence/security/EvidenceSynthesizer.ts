/**
 * Fingerprinted remediation report.
 * The authorization fields are constants. This is not an APEX receipt.
 */
import { createHash } from "node:crypto";
import { NormalizedFinding } from "./reviewTypes";

export const EVIDENCE_MARKDOWN_HEADERS = {
  title: "# Governance Evidence Report",
  fingerprint: "## Fingerprint",
  authorization: "## Authorization",
  findings: "## Findings",
  remediation: "### Remediation checklist",
  boundary: "## Boundary"
} as const;

export interface EvidenceDocument {
  markdown: string;
  fingerprint: string;
  authorized: false;
  requiresHumanApproval: true;
}

export function synthesizeEvidence(input: {
  packageId: string;
  sourceFormat: string;
  findings: NormalizedFinding[];
}): EvidenceDocument {
  const body = {
    packageId: input.packageId,
    sourceFormat: input.sourceFormat,
    findings: input.findings.map(finding => ({
      findingId: finding.finding_id,
      title: finding.title,
      vulnerabilityType: finding.vulnerability_type,
      severity: finding.severity,
      checklist: [...finding.reproduction_checklists],
      inScope: finding.asset.is_in_scope === true
    }))
  };
  const fingerprint = createHash("sha256").update(canonicalize(body)).digest("hex");
  const lines = [
    EVIDENCE_MARKDOWN_HEADERS.title,
    "",
    EVIDENCE_MARKDOWN_HEADERS.fingerprint,
    fingerprint,
    "",
    EVIDENCE_MARKDOWN_HEADERS.authorization,
    "authorized: false",
    "requiresHumanApproval: true",
    "",
    EVIDENCE_MARKDOWN_HEADERS.findings
  ];
  if (!input.findings.length) {
    lines.push("No in-scope findings were retained.");
  }
  for (const finding of input.findings) {
    lines.push("### " + finding.title);
    lines.push("Severity: " + finding.severity);
    lines.push("Type: " + finding.vulnerability_type);
    lines.push(EVIDENCE_MARKDOWN_HEADERS.remediation);
    const checklist = finding.reproduction_checklists.length
      ? finding.reproduction_checklists
      : ["Review this finding manually outside this pipeline."];
    for (const step of checklist) lines.push("- " + step);
    lines.push("");
  }
  lines.push(EVIDENCE_MARKDOWN_HEADERS.boundary);
  lines.push("This document is advisory text. It is not an execution authorization.");
  const document: EvidenceDocument = {
    markdown: lines.join("\n"),
    fingerprint,
    authorized: false,
    requiresHumanApproval: true
  };
  return Object.freeze(document);
}

function canonicalize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
