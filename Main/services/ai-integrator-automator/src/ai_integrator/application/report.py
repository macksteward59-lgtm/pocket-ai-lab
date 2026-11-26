"""Remediation markdown for a review package. This text is not authorization."""

import hashlib
import json

from ai_integrator.application.services import ReviewEnvelope


def render_review_markdown(envelope: ReviewEnvelope) -> str:
    package = envelope.review_package
    body = {
        "packageId": str(package.package_id),
        "sourceFormat": package.source_format,
        "findings": [
            {
                "findingId": str(finding.finding_id),
                "title": finding.title,
                "severity": finding.severity,
                "inScope": finding.asset.is_in_scope is True,
            }
            for finding in package.findings
        ],
    }
    fingerprint = hashlib.sha256(json.dumps(body, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()
    lines = [
        "# Governance Evidence Report",
        "",
        "## Fingerprint",
        fingerprint,
        "",
        "## Authorization",
        "authorized: false",
        "requiresHumanApproval: true",
        "",
        "## Findings",
    ]
    if not package.findings:
        lines.append("No in-scope findings were retained.")
    for finding in package.findings:
        lines.append("### " + finding.title)
        lines.append("Severity: " + finding.severity)
        lines.append("Type: " + finding.vulnerability_type)
        lines.append("### Remediation checklist")
        steps = finding.reproduction_checklists or ["Review this finding manually outside this pipeline."]
        lines.extend("- " + step for step in steps)
        lines.append("")
    lines.append("## Boundary")
    lines.append("This document is advisory text. It is not an execution authorization.")
    if envelope.boundary_violations:
        lines.append("")
        lines.append("## Boundary violations")
        for violation in envelope.boundary_violations:
            lines.append("- " + violation.reason + " (" + violation.asset.base_domain + ")")
    return "\n".join(lines)
