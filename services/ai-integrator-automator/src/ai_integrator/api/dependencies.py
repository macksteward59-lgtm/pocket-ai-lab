"""Build a review orchestrator from process environment. Nothing is fetched."""

import os

from ai_integrator.application.policy import TargetAllowlistPolicy
from ai_integrator.application.services import PolicyReviewOrchestrator


def allowlist_from_env() -> list[str]:
    raw = os.environ.get("GOVERNANCE_ALLOWLIST", "")
    return [part.strip() for part in raw.split(",") if part.strip()]


def get_orchestrator() -> PolicyReviewOrchestrator:
    return PolicyReviewOrchestrator(TargetAllowlistPolicy(allowlist_from_env()))
