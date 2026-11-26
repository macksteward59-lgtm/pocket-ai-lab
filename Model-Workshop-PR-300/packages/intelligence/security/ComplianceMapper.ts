/**
 * Map finding text onto documentation labels.
 * A warning is a human prompt. It is not a certification and not authorization.
 */
import { NormalizedFinding } from "./reviewTypes";

export interface ComplianceReport {
  warnings: string[];
  criticalWarnings: string[];
  controls: string[];
  authorized: false;
}

const CONTROL_RULES: Array<{ test: RegExp; control: string }> = [
  { test: /header|transport|tls|ssl/i, control: "secure-transport" },
  { test: /auth|session|cookie|credential/i, control: "access-control" },
  { test: /config|default|permission/i, control: "secure-configuration" }
];

export function mapCompliance(findings: NormalizedFinding[]): ComplianceReport {
  const warnings: string[] = [];
  const criticalWarnings: string[] = [];
  const controls = new Set<string>();
  for (const finding of findings) {
    const text = finding.title + " " + finding.vulnerability_type;
    let matched = false;
    for (const rule of CONTROL_RULES) {
      if (rule.test.test(text)) {
        controls.add(rule.control);
        matched = true;
      }
    }
    if (!matched) controls.add("general-review");
    const severity = finding.severity.toLowerCase();
    if (severity === "critical" || severity === "high" || severity.startsWith("high")) {
      const warning = `Critical compliance warning: ${finding.finding_id} severity ${finding.severity}. Human review is required. This warning is not authorization.`;
      criticalWarnings.push(warning);
      warnings.push(warning);
    }
  }
  return {
    warnings,
    criticalWarnings,
    controls: [...controls],
    authorized: false
  };
}
