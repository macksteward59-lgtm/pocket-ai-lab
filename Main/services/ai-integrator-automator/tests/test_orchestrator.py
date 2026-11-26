from ai_integrator.application.policy import TargetAllowlistPolicy
from ai_integrator.application.services import PolicyReviewOrchestrator
from ai_integrator.domain.transitions import ReviewState

BURP = """<?xml version="1.0"?>
<issues>
  <issue>
    <name>Missing security header</name>
    <host ip="203.0.113.10">https://app.example.com/login</host>
    <severity>High</severity>
    <confidence>Certain</confidence>
    <remediationBackground>Send the header.</remediationBackground>
  </issue>
  <issue>
    <name>Cookie without Secure</name>
    <host>https://other.example.net/a</host>
    <severity>Medium</severity>
    <confidence>Firm</confidence>
  </issue>
</issues>
"""


def test_allowlisted_intake_is_review_ready():
    orchestrator = PolicyReviewOrchestrator(TargetAllowlistPolicy(["app.example.com"]))
    envelope = orchestrator.review_raw_telemetry("burp", BURP)
    assert envelope.authorized is False
    assert envelope.review_package.authorized is False
    assert envelope.review_package.requires_human_approval is True
    assert envelope.review_package.state == ReviewState.REVIEW_READY.value
    assert len(envelope.review_package.findings) == 1
    finding = envelope.review_package.findings[0]
    assert finding.asset.is_in_scope is True
    assert finding.asset.base_domain == "app.example.com"
    assert finding.authorized is False
    assert len(envelope.boundary_violations) == 1
    assert envelope.boundary_violations[0].event == "SecurityBoundaryViolation"
    assert envelope.boundary_violations[0].asset.is_in_scope is False
    assert envelope.boundary_violations[0].authorized is False
    assert orchestrator.dispatcher.events[0].event == "SecurityBoundaryViolation"


def test_out_of_scope_is_dropped():
    orchestrator = PolicyReviewOrchestrator(TargetAllowlistPolicy(["elsewhere.example"]))
    envelope = orchestrator.review_raw_telemetry("burp", BURP)
    assert envelope.review_package.state == ReviewState.REJECTED.value
    assert envelope.review_package.findings == []
    assert len(envelope.boundary_violations) == 2
    assert all(item.authorized is False for item in envelope.boundary_violations)
    assert "REVIEW_READY" not in envelope.review_package.state


def test_empty_allowlist_drops_every_finding():
    envelope = PolicyReviewOrchestrator(TargetAllowlistPolicy([])).review_raw_telemetry("burp", BURP)
    assert envelope.review_package.state == ReviewState.REJECTED.value
    assert envelope.review_package.findings == []
    assert envelope.boundary_violations


def test_malformed_export_rejects_without_raising():
    envelope = PolicyReviewOrchestrator(TargetAllowlistPolicy(["app.example.com"])).review_raw_telemetry(
        "nessus", "not a csv"
    )
    assert envelope.review_package.state == ReviewState.REJECTED.value
    assert envelope.review_package.findings == []
    assert envelope.boundary_violations == []


def test_unsupported_format_is_rejected_by_the_orchestrator():
    try:
        PolicyReviewOrchestrator(TargetAllowlistPolicy(["app.example.com"])).review_raw_telemetry("custom", "<issue/>")
    except ValueError as exc:
        assert "unsupported" in str(exc)
    else:
        raise AssertionError("unsupported format must fail closed")
