"""Text scan for risky calls. The source is never executed."""

import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("dynamic-exec", re.compile(r"\b(eval|exec|Function)\s*\(")),
    ("process-spawn", re.compile(r"\b(subprocess|os\.system|child_process|spawn|popen)\b")),
    ("deserialization", re.compile(r"\b(pickle\.loads|yaml\.load|marshal\.loads)\s*\(")),
    ("network-client", re.compile(r"\b(requests\.(get|post|put|delete)|fetch|http\.request)\s*\(")),
)


class StaticObservation(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: str
    line: int
    excerpt: str
    remediation: str


class StaticAnalysisReport(BaseModel):
    model_config = ConfigDict(extra="forbid")

    observations: list[StaticObservation] = Field(default_factory=list)
    truncated: bool = False
    authorized: Literal[False] = False
    executes: Literal[False] = False


def analyze_source(source: str, *, limit: int = 1_000_000) -> StaticAnalysisReport:
    text = source if isinstance(source, str) else ""
    truncated = len(text) > limit
    body = text[:limit]
    observations: list[StaticObservation] = []
    for line_number, line in enumerate(body.splitlines(), start=1):
        for kind, pattern in _PATTERNS:
            if pattern.search(line):
                observations.append(StaticObservation(
                    kind=kind,
                    line=line_number,
                    excerpt=line.strip()[:180],
                    remediation="Remove or gate this call. This review did not run it.",
                ))
        if len(observations) >= 100:
            break
    return StaticAnalysisReport(observations=observations, truncated=truncated)
