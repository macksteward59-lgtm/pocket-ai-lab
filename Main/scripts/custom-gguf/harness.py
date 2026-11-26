"""Evaluation helpers for the experimental fine-tune.

Generated text is copied into the record and is never treated as permission.
"""

from __future__ import annotations


def judge_generation(text: str) -> dict:
    return {
        "text": text,
        "authorized": False,
        "apex_receipt": False,
        "grants_permission": False,
    }


def exact_match(prediction: str, expected: str) -> bool:
    return prediction.strip() == expected.strip()
