"""Decide whether an experimental run may be exported.

A run that does not beat the base model on held-out exact match is not exported.
That avoids renaming the base weights as a custom GGUF.
"""

from __future__ import annotations


def export_allowed(metrics: dict) -> tuple[bool, str]:
    if metrics.get("authorized") is True:
        return False, "a training report cannot grant authorization"
    trained = metrics.get("heldoutExact")
    baseline = metrics.get("baselineExact")
    count = metrics.get("heldoutCount")
    if not isinstance(trained, int) or not isinstance(baseline, int) or not isinstance(count, int) or count < 1:
        return False, "held-out metrics are incomplete"
    if trained <= baseline:
        return False, "held-out exact match did not improve over the base model"
    return True, "held-out exact match improved"
