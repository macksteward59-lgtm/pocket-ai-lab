"""Review state machine.

TELEMETRY_INGESTED → SCOPE_EVALUATED → REVIEW_READY | REJECTED

REVIEW_READY is legal only when the finding or package is explicitly in scope.
"""

from enum import Enum


class ReviewState(str, Enum):
    TELEMETRY_INGESTED = "TELEMETRY_INGESTED"
    SCOPE_EVALUATED = "SCOPE_EVALUATED"
    REVIEW_READY = "REVIEW_READY"
    REJECTED = "REJECTED"


class IllegalReviewTransition(Exception):
    """Raised when a review skips a state or becomes ready while out of scope."""


_ALLOWED: dict[ReviewState, set[ReviewState]] = {
    ReviewState.TELEMETRY_INGESTED: {ReviewState.SCOPE_EVALUATED},
    ReviewState.SCOPE_EVALUATED: {ReviewState.REVIEW_READY, ReviewState.REJECTED},
    ReviewState.REVIEW_READY: set(),
    ReviewState.REJECTED: set(),
}


def advance(current: ReviewState, nxt: ReviewState, *, in_scope: bool | None = None) -> ReviewState:
    if nxt not in _ALLOWED[current]:
        raise IllegalReviewTransition(f"Cannot move from {current.value} to {nxt.value}")
    if nxt is ReviewState.REVIEW_READY and in_scope is not True:
        raise IllegalReviewTransition("REVIEW_READY requires is_in_scope to be true")
    return nxt
