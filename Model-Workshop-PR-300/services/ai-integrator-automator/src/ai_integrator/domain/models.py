"""Pydantic contracts for normalized scanner findings.

``is_in_scope`` defaults to false. Parsers must not promote a target into
scope; only ``TargetAllowlistPolicy`` may set the flag.
"""

from datetime import datetime
from typing import Literal
from uuid import UUID, uuid4

from pydantic import BaseModel, ConfigDict, Field


class AssetContext(BaseModel):
    model_config = ConfigDict(extra="forbid")

    target_uri: str = Field(min_length=1, max_length=500)
    base_domain: str = Field(min_length=1, max_length=253)
    ip_address: str | None = None
    port: int | None = Field(default=None, ge=1, le=65535)
    is_in_scope: bool = False


class NormalizedFinding(BaseModel):
    model_config = ConfigDict(extra="forbid")

    finding_id: UUID = Field(default_factory=uuid4)
    title: str = Field(min_length=1, max_length=300)
    vulnerability_type: str = Field(min_length=1, max_length=120)
    severity: str = Field(min_length=1, max_length=40)
    confidence_level: str = Field(min_length=1, max_length=40)
    raw_traffic_context: str | None = Field(default=None, max_length=2000)
    affected_parameters: list[str] = Field(default_factory=list)
    reproduction_checklists: list[str] = Field(default_factory=list)
    asset: AssetContext
    authorized: Literal[False] = False


class TelemetryReviewPackage(BaseModel):
    model_config = ConfigDict(extra="forbid")

    package_id: UUID = Field(default_factory=uuid4)
    timestamp: datetime
    source_format: Literal["burp", "nessus", "zap"]
    findings: list[NormalizedFinding]
    audit_trail_logs: list[str] = Field(default_factory=list)
    state: Literal["TELEMETRY_INGESTED", "SCOPE_EVALUATED", "REVIEW_READY", "REJECTED"]
    authorized: Literal[False] = False
    requires_human_approval: Literal[True] = True
