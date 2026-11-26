"""Allowlist scope policy.

An empty allowlist matches nothing. Scanner data cannot mark a target in scope.
"""

import re
from typing import Literal
from urllib.parse import urlparse
from uuid import UUID, uuid4

from pydantic import BaseModel, ConfigDict, Field

from ai_integrator.domain.models import AssetContext

_HOST = re.compile(r"^[a-z0-9.-]{1,253}$")


class SecurityBoundaryViolationEvent(BaseModel):
    model_config = ConfigDict(extra="forbid")

    event: Literal["SecurityBoundaryViolation"] = "SecurityBoundaryViolation"
    event_id: UUID = Field(default_factory=uuid4)
    reason: str = Field(min_length=1, max_length=300)
    finding_id: UUID | None = None
    asset: AssetContext
    authorized: Literal[False] = False


class _Rule:
    def __init__(self, host: str, port: int | None, wildcard: bool) -> None:
        self.host = host
        self.port = port
        self.wildcard = wildcard


def _parse_entry(entry: str) -> _Rule | None:
    text = entry.strip().lower()
    if not text:
        return None
    port: int | None = None
    if "://" in text:
        parsed = urlparse(text)
        host = (parsed.hostname or "").lower().strip(".")
        port = parsed.port
    else:
        host_part, sep, port_text = text.partition(":")
        if "/" in host_part:
            host_part = host_part.split("/", 1)[0]
        host = host_part.strip(".")
        if sep:
            if not port_text.isdigit():
                return None
            port = int(port_text)
            if not 1 <= port <= 65535:
                return None
    wildcard = host.startswith("*.")
    if wildcard:
        host = host[2:]
    if not _HOST.fullmatch(host):
        return None
    return _Rule(host, port, wildcard)


class TargetAllowlistPolicy:
    def __init__(self, allowlist: list[str] | None = None) -> None:
        self.rules = [rule for entry in (allowlist or []) if (rule := _parse_entry(entry))]

    def apply(self, asset: AssetContext) -> tuple[AssetContext, SecurityBoundaryViolationEvent | None]:
        in_scope = self._matches(asset)
        updated = asset.model_copy(update={"is_in_scope": in_scope})
        if in_scope:
            return updated, None
        return updated, SecurityBoundaryViolationEvent(
            reason="Target is outside the operator allowlist",
            asset=updated,
        )

    def _matches(self, asset: AssetContext) -> bool:
        host = asset.base_domain.lower().strip(".")
        ip = (asset.ip_address or "").lower().strip()
        for rule in self.rules:
            if rule.port is not None and asset.port != rule.port:
                continue
            if host == rule.host or (ip and ip == rule.host):
                if rule.wildcard:
                    continue
                return True
            if rule.wildcard and host.endswith("." + rule.host):
                return True
        return False
