"""Scanner-export parsers.

Burp XML is read with defusedxml. Malformed input returns an empty list.
Every asset leaves this module with ``is_in_scope`` false.
"""

from typing import Protocol
from urllib.parse import urlparse
from xml.etree.ElementTree import Element

from defusedxml.ElementTree import fromstring

from ai_integrator.domain.models import AssetContext, NormalizedFinding


class TelemetryParserPort(Protocol):
    def parse(self, raw: str) -> list[NormalizedFinding]:
        """Return normalized findings, or an empty list when the export cannot be read."""


def _checklist(remediation: str | None) -> list[str]:
    steps = [
        "Confirm this asset is on your operator allowlist before any manual follow-up.",
        "Review the exported finding offline. This pipeline does not contact the target.",
        "Apply the remediation in your own change process, outside this pipeline.",
        "Export a fresh scanner report and submit that file for another non-executing review.",
    ]
    text = (remediation or "").strip()
    if text:
        steps.insert(2, "Scanner remediation note (stored as text, not executed): " + text[:400])
    return steps


def _asset(target: str, ip: str | None = None, port: int | None = None) -> AssetContext:
    raw = (target or "").strip() or "unknown"
    candidate = raw if "://" in raw else "https://" + raw
    parsed = urlparse(candidate)
    host = (parsed.hostname or raw).lower().strip(".")[:253] or "unknown"
    resolved_port = port if port is not None else parsed.port
    if resolved_port is not None and not 1 <= resolved_port <= 65535:
        resolved_port = None
    return AssetContext(
        target_uri=raw[:500],
        base_domain=host,
        ip_address=(ip or None),
        port=resolved_port,
        is_in_scope=False,
    )


def _clip(value: str | None, limit: int) -> str | None:
    if value is None:
        return None
    text = value.strip()
    if not text:
        return None
    return text[:limit]


def _local_name(tag: str) -> str:
    return tag.lower().rsplit("}", 1)[-1]


def _child_text(element: Element, tag: str) -> str:
    child = element.find(tag)
    if child is None or child.text is None:
        return ""
    return child.text.strip()


def _safe_parse(parser):
    def wrapper(self, raw: str) -> list[NormalizedFinding]:
        try:
            if not isinstance(raw, str) or not raw.strip() or "\x00" in raw:
                return []
            findings = parser(self, raw)
            if not isinstance(findings, list):
                return []
            return findings[:200]
        except Exception:
            return []

    return wrapper


class BurpXmlAdapter:
    """Read a Burp Suite issue export. Entity expansion and XXE are refused."""

    @_safe_parse
    def parse(self, raw: str) -> list[NormalizedFinding]:
        root = fromstring(raw)
        issues = [item for item in root.iter() if _local_name(item.tag) == "issue"]
        findings: list[NormalizedFinding] = []
        for issue in issues:
            title = _child_text(issue, "name") or _child_text(issue, "issueName") or "Untitled scanner issue"
            host = issue.find("host")
            target = (host.text or "").strip() if host is not None and host.text else ""
            ip = host.attrib.get("ip") if host is not None else None
            path = _child_text(issue, "path")
            if path and target and not target.endswith(path):
                target = target.rstrip("/") + "/" + path.lstrip("/")
            kind = _child_text(issue, "vulnerabilityClassifications") or _child_text(issue, "type") or "unspecified"
            remediation = _child_text(issue, "remediationBackground") or _child_text(issue, "issueBackground")
            detail = _child_text(issue, "issueDetail") or _child_text(issue, "issueBackground")
            findings.append(NormalizedFinding(
                title=title[:300] or "Untitled scanner issue",
                vulnerability_type=(kind.splitlines()[0] or "unspecified")[:120],
                severity=(_child_text(issue, "severity") or "unspecified")[:40],
                confidence_level=(_child_text(issue, "confidence") or "unspecified")[:40],
                raw_traffic_context=_clip(detail, 2000),
                affected_parameters=[],
                reproduction_checklists=_checklist(remediation),
                asset=_asset(target or "unknown", ip=ip),
            ))
        return findings


class NessusParserAdapter:
    """Read a Nessus CSV export. A missing header or a broken row yields no findings."""

    @_safe_parse
    def parse(self, raw: str) -> list[NormalizedFinding]:
        import csv
        from io import StringIO

        reader = csv.DictReader(StringIO(raw))
        if not reader.fieldnames:
            return []
        fields = {(name or "").strip().lower(): name for name in reader.fieldnames}
        if "host" not in fields or "name" not in fields:
            return []

        def cell(row: dict[str, str | None], *names: str) -> str:
            for name in names:
                key = fields.get(name)
                if key is None:
                    continue
                value = row.get(key)
                if value:
                    return value.strip()
            return ""

        findings: list[NormalizedFinding] = []
        for row in reader:
            host = cell(row, "host")
            title = cell(row, "name", "plugin name")
            if not host or not title:
                continue
            port_text = cell(row, "port")
            port = int(port_text) if port_text.isdigit() else None
            findings.append(NormalizedFinding(
                title=title[:300],
                vulnerability_type=(cell(row, "cve", "synopsis") or "unspecified")[:120],
                severity=(cell(row, "risk", "severity") or "unspecified")[:40],
                confidence_level="unspecified",
                raw_traffic_context=_clip(cell(row, "description", "plugin output"), 2000),
                affected_parameters=[],
                reproduction_checklists=_checklist(cell(row, "solution")),
                asset=_asset(host, port=port),
            ))
        return findings


class ZapParserAdapter:
    """Read a ZAP JSON or XML export. Unreadable input yields no findings."""

    @_safe_parse
    def parse(self, raw: str) -> list[NormalizedFinding]:
        stripped = raw.lstrip()
        if stripped.startswith("<"):
            return self._parse_xml(raw)
        if stripped.startswith("{") or stripped.startswith("["):
            return self._parse_json(raw)
        return []

    def _parse_json(self, raw: str) -> list[NormalizedFinding]:
        import json

        payload = json.loads(raw)
        sites = payload.get("site") if isinstance(payload, dict) else None
        if isinstance(payload, dict) and isinstance(payload.get("alerts"), list):
            sites = [{"alerts": payload["alerts"], "@name": payload.get("@name") or payload.get("name") or "unknown"}]
        if not isinstance(sites, list):
            return []
        findings: list[NormalizedFinding] = []
        for site in sites:
            if not isinstance(site, dict):
                continue
            site_name = str(site.get("@name") or site.get("name") or "unknown")
            alerts = site.get("alerts") or []
            if not isinstance(alerts, list):
                continue
            for alert in alerts:
                if not isinstance(alert, dict):
                    continue
                title = str(alert.get("name") or alert.get("alert") or "").strip()
                if not title:
                    continue
                param = str(alert.get("param") or "").strip()
                findings.append(NormalizedFinding(
                    title=title[:300],
                    vulnerability_type=str(alert.get("alert") or title)[:120],
                    severity=str(alert.get("riskdesc") or alert.get("risk") or "unspecified")[:40],
                    confidence_level=str(alert.get("confidence") or "unspecified")[:40],
                    raw_traffic_context=_clip(str(alert.get("desc") or alert.get("description") or ""), 2000),
                    affected_parameters=[param] if param else [],
                    reproduction_checklists=_checklist(str(alert.get("solution") or "")),
                    asset=_asset(str(alert.get("uri") or site_name)),
                ))
        return findings

    def _parse_xml(self, raw: str) -> list[NormalizedFinding]:
        root = fromstring(raw)
        findings: list[NormalizedFinding] = []
        for alert in root.iter():
            if _local_name(alert.tag) not in {"alertitem", "alert"}:
                continue
            title = _child_text(alert, "name") or _child_text(alert, "alert")
            if not title:
                continue
            param = _child_text(alert, "param")
            parent_name = ""
            findings.append(NormalizedFinding(
                title=title[:300],
                vulnerability_type=(title or "unspecified")[:120],
                severity=(_child_text(alert, "riskdesc") or _child_text(alert, "riskcode") or "unspecified")[:40],
                confidence_level=(_child_text(alert, "confidence") or "unspecified")[:40],
                raw_traffic_context=_clip(_child_text(alert, "desc"), 2000),
                affected_parameters=[param] if param else [],
                reproduction_checklists=_checklist(_child_text(alert, "solution")),
                asset=_asset(_child_text(alert, "uri") or parent_name or "unknown"),
            ))
        return findings


def parser_for(source_format: str) -> TelemetryParserPort | None:
    return {
        "burp": BurpXmlAdapter(),
        "nessus": NessusParserAdapter(),
        "zap": ZapParserAdapter(),
    }.get(source_format)
