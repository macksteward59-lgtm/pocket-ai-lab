"""Review and static-analysis routes.

Requests carry operator exports. Responses are text findings and checklists.
"""

import json
from collections import deque
from typing import Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel, ConfigDict, Field

from ai_integrator.api.dependencies import get_orchestrator
from ai_integrator.application.allowlist_store import read_allowlist, write_allowlist
from ai_integrator.application.dependency_triage import triage_package_json, triage_requirements
from ai_integrator.application.report import render_review_markdown
from ai_integrator.application.services import PolicyReviewOrchestrator, ReviewEnvelope
from ai_integrator.application.source_parser import StaticContextExtractor
from ai_integrator.application.static_analyzer import analyze_source

router = APIRouter()
_RECENT: deque[dict] = deque(maxlen=20)
_EXTRACTOR = StaticContextExtractor()


class ReviewRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    source_format: Literal["burp", "nessus", "zap"]
    content: str = Field(max_length=2_000_000)


class AllowlistBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    hosts: list[str] = Field(default_factory=list, max_length=200)


class AnalyzeSourceRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    filename: str = Field(min_length=1, max_length=200)
    source: str = Field(max_length=1_000_000)


def recent_reviews() -> list[dict]:
    return list(_RECENT)


@router.post("/api/v1/governance/review")
def review(body: ReviewRequest, orchestrator: PolicyReviewOrchestrator = Depends(get_orchestrator)) -> dict:
    envelope = orchestrator.review_raw_telemetry(body.source_format, body.content)
    payload = _public_envelope(envelope)
    _RECENT.append(payload)
    return payload


@router.get("/api/v1/governance/reviews")
def reviews() -> dict:
    return {"reviews": recent_reviews(), "authorized": False}


@router.get("/api/v1/governance/allowlist")
def show_allowlist() -> dict:
    return {"hosts": read_allowlist(), "authorized": False}


@router.put("/api/v1/governance/allowlist")
def replace_allowlist(body: AllowlistBody) -> dict:
    return {"hosts": write_allowlist(body.hosts), "authorized": False}


@router.post("/api/v1/governance/analyze-source")
def analyze(body: AnalyzeSourceRequest) -> dict:
    report = analyze_source(body.source)
    context = _EXTRACTOR.extract(body.source)
    dependency = None
    name = body.filename.lower()
    if name.endswith("requirements.txt") or name.endswith(".txt") and "requirement" in name:
        dependency = triage_requirements(body.source).model_dump()
    elif name.endswith("package.json"):
        try:
            parsed = json.loads(body.source)
        except json.JSONDecodeError:
            parsed = None
        if isinstance(parsed, dict):
            dependency = triage_package_json(parsed).model_dump()
    return {
        "filename": body.filename,
        "observations": [item.model_dump() for item in report.observations],
        "truncated": report.truncated or context.truncated,
        "context": context.model_dump(),
        "dependencies": dependency,
        "authorized": False,
        "executes": False,
    }


def _public_envelope(envelope: ReviewEnvelope) -> dict:
    payload = envelope.model_dump(mode="json")
    payload["authorized"] = False
    payload["review_package"]["authorized"] = False
    payload["review_package"]["requires_human_approval"] = True
    for violation in payload["boundary_violations"]:
        violation["authorized"] = False
    payload["evidence_markdown"] = render_review_markdown(envelope)
    return payload
