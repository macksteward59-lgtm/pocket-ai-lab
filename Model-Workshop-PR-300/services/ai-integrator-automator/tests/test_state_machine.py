import pytest

from ai_integrator.domain.transitions import IllegalReviewTransition, ReviewState, advance


def test_in_scope_path_reaches_review_ready():
    state = ReviewState.TELEMETRY_INGESTED
    state = advance(state, ReviewState.SCOPE_EVALUATED)
    state = advance(state, ReviewState.REVIEW_READY, in_scope=True)
    assert state is ReviewState.REVIEW_READY


def test_out_of_scope_path_is_rejected():
    state = advance(ReviewState.TELEMETRY_INGESTED, ReviewState.SCOPE_EVALUATED)
    state = advance(state, ReviewState.REJECTED)
    assert state is ReviewState.REJECTED


def test_review_ready_requires_in_scope_and_cannot_skip():
    with pytest.raises(IllegalReviewTransition):
        advance(ReviewState.TELEMETRY_INGESTED, ReviewState.REVIEW_READY, in_scope=True)
    with pytest.raises(IllegalReviewTransition):
        advance(ReviewState.SCOPE_EVALUATED, ReviewState.REVIEW_READY, in_scope=False)
    with pytest.raises(IllegalReviewTransition):
        advance(ReviewState.SCOPE_EVALUATED, ReviewState.REVIEW_READY, in_scope=None)
    with pytest.raises(IllegalReviewTransition):
        advance(ReviewState.REJECTED, ReviewState.REVIEW_READY, in_scope=True)
    with pytest.raises(IllegalReviewTransition):
        advance(ReviewState.REVIEW_READY, ReviewState.REJECTED)
