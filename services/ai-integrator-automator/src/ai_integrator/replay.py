"""Offline replay of fabricated scanner exports. This module opens no sockets."""

import json
import sys
from pathlib import Path

from ai_integrator.application.policy import TargetAllowlistPolicy
from ai_integrator.application.report import render_review_markdown
from ai_integrator.application.services import PolicyReviewOrchestrator

ALLOWLIST = ["app.example.com"]
CASES = (
    ("burp", "burp-export.xml"),
    ("nessus", "nessus-export.csv"),
    ("zap", "zap-export.json"),
)


def replay_directory(fixtures_dir: Path) -> dict:
    orchestrator = PolicyReviewOrchestrator(TargetAllowlistPolicy(ALLOWLIST))
    cases = []
    for source_format, filename in CASES:
        raw = (fixtures_dir / filename).read_text(encoding="utf-8")
        envelope = orchestrator.review_raw_telemetry(source_format, raw)
        payload = envelope.model_dump(mode="json")
        payload["authorized"] = False
        payload["review_package"]["authorized"] = False
        payload["evidence_markdown"] = render_review_markdown(envelope)
        cases.append({
            "name": source_format,
            "in_scope": len(envelope.review_package.findings),
            "violations": len(envelope.boundary_violations),
            "state": envelope.review_package.state,
            "authorized": False,
            "envelope": payload,
        })
    return {"authorized": False, "allowlist": ALLOWLIST, "cases": cases}


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print("usage: python -m ai_integrator.replay <fixtures-dir>", file=sys.stderr)
        return 2
    report = replay_directory(Path(argv[1]))
    json.dump(report, sys.stdout)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
