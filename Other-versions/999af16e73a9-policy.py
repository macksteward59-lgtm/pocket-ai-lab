"""Allowlist scope policy.

An empty allowlist matches nothing. Scanner data cannot mark a target in scope.
Entries are hostnames or IP addresses, optionally with a port. URL schemes are
intentionally rejected because this policy evaluates host/port, not transport.
"""

import ipaddress
import re
from typing import Literal
from urllib.parse import urlsplit
from uuid import UUID, uuid4

from pydantic import BaseModel, ConfigDict, Field

from ai_integrator.domain.models import AssetContext

_LABEL = re.compile(r"^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$")


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


def _canonical_host(value: str) -> tuple[str, bool]:
    host = value.rstrip(".").lower()
    if not host:
        raise ValueError("host is empty")
    try:
        return str(ipaddress.ip_address(host)), True
    except ValueError:
        pass

    try:
        ascii_host = host.encode("idna").decode("ascii")
    except UnicodeError as exc:
        raise ValueError("host is not valid IDNA") from exc
    if len(ascii_host) > 253:
        raise ValueError("host exceeds 253 characters")
    labels = ascii_host.split(".")
    if any(not _LABEL.fullmatch(label) for label in labels):
        raise ValueError("host contains an invalid DNS label")
    return ascii_host, False


def _parse_entry(entry: str) -> _Rule:
    if not isinstance(entry, str) or not entry.strip():
        raise ValueError("allowlist entries must be non-empty strings")
    text = entry.strip().lower()
    if "://" in text:
        raise ValueError("URL schemes are unsupported; allowlist host[:port] only")

    # urlsplit handles bracketed IPv6 and rejects malformed ports when .port
    # is accessed. Paths, query strings and fragments are not policy inputs.
    parsed = urlsplit("//" + text)
    if parsed.path or parsed.query or parsed.fragment:
        raise ValueError("allowlist entries must not contain paths or query data")
    if parsed.username is not None or parsed.password is not None:
        raise ValueError("credentials are not valid allowlist entries")
    try:
        host = parsed.hostname or ""
        port = parsed.port
    except ValueError as exc:
        raise ValueError("allowlist entry has an invalid port or host") from exc

    wildcard = host.startswith("*.")
    if wildcard:
        host = host[2:]
    canonical, is_ip = _canonical_host(host)
    if port is not None and not 1 <= port <= 65535:
        raise ValueError("port must be between 1 and 65535")
    if wildcard and is_ip:
        raise ValueError("wildcard IP entries are not supported")
    return _Rule(canonical, port, wildcard)


class TargetAllowlistPolicy:
    def __init__(self, allowlist: list[str] | None = None) -> None:
        self.rules: list[_Rule] = []
        for entry in (allowlist or []):
            try:
                self.rules.append(_parse_entry(entry))
            except ValueError as exc:
                raise ValueError(f"invalid allowlist entry {entry!r}: {exc}") from exc

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
        try:
            host, is_ip = _canonical_host(asset.base_domain)
            ip = str(ipaddress.ip_address(asset.ip_address)) if asset.ip_address else ""
        except ValueError:
            return False

        for rule in self.rules:
            if rule.port is not None and asset.port != rule.port:
                continue
            if host == rule.host or (ip and ip == rule.host):
                if rule.wildcard:
                    continue
                return True
            if rule.wildcard and not is_ip and host.endswith("." + rule.host):
                return True
        return False
