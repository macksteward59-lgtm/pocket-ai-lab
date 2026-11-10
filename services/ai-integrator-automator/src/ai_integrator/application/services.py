"""Turn a raw scanner export into a scoped review package.

Out-of-scope findings are dropped. REVIEW_READY is reached only when at least
one finding has ``is_in_scope`` true. This service does not contact targets.
"""

from datetime import datetime, timezone
from typing import Literal
from uuid import uuid4

from pydantic import BaseModel, ConfigDict

from ai_integrator.adapters.message_dispatcher import InProcessMessageDispatcher
from ai_integrator.application.policy import SecurityBoundaryViolationEvent, TargetAllowlistPolicy
from ai_integrator.domain.models import NormalizedFinding, TelemetryReviewPackage
from ai_integrator.domain.transitions import ReviewState, advance
from ai_integrator.ports.telemetry_port import TelemetryParserPort, parser_for


class ReviewEnvelope(BaseModel):
    model_config = ConfigDict(extra="forbid")

    review_package: TelemetryReviewPackage
    boundary_violations: list[SecurityBoundaryViolationEvent]
    authorized: Literal[False] = False


class PolicyReviewOrchestrator:
    def __init__(
        self,
        policy: TargetAllowlistPolicy,
        parsers: dict[str, TelemetryParserPort] | None = None,
        dispatcher: InProcessMessageDispatcher | None = None,
    ) -> None:
        self.policy = policy
        self.parsers = parsers or {}
        self.dispatcher = dispatcher or InProcessMessageDispatcher()

    def review_raw_telemetry(self, source_format: str, raw: str) -> ReviewEnvelope:
        if source_format not in {"burp", "nessus", "zap"}:
            raise ValueError("unsupported source format")
        logs = [ReviewState.TELEMETRY_INGESTED.value]
        state = ReviewState.TELEMETRY_INGESTED
        violations: list[SecurityBoundaryViolationEvent] = []
        ready: list[NormalizedFinding] = []
        parser = self.parsers.get(source_format) or parser_for(source_format)
        if parser is None:
            state = advance(state, ReviewState.SCOPE_EVALUATED)
            state = advance(state, ReviewState.REJECTED)
            logs.extend([ReviewState.SCOPE_EVALUATED.value, ReviewState.REJECTED.value, "unsupported source format"])
            violation = SecurityBoundaryViolationEvent(
                reason="Unsupported telemetry source format",
                asset=_unknown_asset(),
            )
            violations.append(violation)
            self.dispatcher.publish(violation)
            return self._envelope(source_format, ready, logs, state, violations)

        findings = parser.parse(raw if isinstance(raw, str) else "")
        state = advance(state, ReviewState.SCOPE_EVALUATED)
        logs.append(ReviewState.SCOPE_EVALUATED.value)
        for finding in findings:
            scoped, violation = self.policy.apply(finding.asset)
            reviewed = finding.model_copy(update={"asset": scoped})
            finding_state = advance(ReviewState.TELEMETRY_INGESTED, ReviewState.SCOPE_EVALUATED)
            if scoped.is_in_scope is True:
                finding_state = advance(finding_state, ReviewState.REVIEW_READY, in_scope=True)
                ready.append(reviewed)
                logs.append(f"REVIEW_READY {reviewed.finding_id}")
            else:
                finding_state = advance(finding_state, ReviewState.REJECTED)
                event = violation or SecurityBoundaryViolationEvent(
                    reason="Target is outside the operator allowlist",
                    asset=scoped,
                )
                event = event.model_copy(update={"finding_id": reviewed.finding_id})
                violations.append(event)
                self.dispatcher.publish(event)
                logs.append(f"REJECTED {reviewed.finding_id}")
            del finding_state
        if ready:
            state = advance(state, ReviewState.REVIEW_READY, in_scope=True)
        else:
            state = advance(state, ReviewState.REJECTED)
            logs.append("no in-scope findings")
        logs.append(state.value)
        return self._envelope(source_format, ready, logs, state, violations)

    def _envelope(
        self,
        source_format: str,
        findings: list[NormalizedFinding],
        logs: list[str],
        state: ReviewState,
        violations: list[SecurityBoundaryViolationEvent],
    ) -> ReviewEnvelope:
        package = TelemetryReviewPackage(
            package_id=uuid4(),
            timestamp=datetime.now(timezone.utc),
            source_format=source_format,  # type: ignore[arg-type]
            findings=findings,
            audit_trail_logs=logs,
            state=state.value,  # type: ignore[arg-type]
        )
        return ReviewEnvelope(review_package=package, boundary_violations=violations)


def _unknown_asset():
    from ai_integrator.domain.models import AssetContext

    return AssetContext(target_uri="unknown", base_domain="unknown", is_in_scope=False)
