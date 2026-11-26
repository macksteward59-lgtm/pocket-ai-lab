"""Local allowlist file. Nothing in this module opens a socket."""

import os
from pathlib import Path


def allowlist_path() -> Path:
    override = os.environ.get("GOVERNANCE_ALLOWLIST_FILE", "").strip()
    if override:
        return Path(override)
    return Path.cwd() / ".governance" / "allowlist.txt"


def read_allowlist() -> list[str]:
    path = allowlist_path()
    if path.is_file():
        return _parse(path.read_text(encoding="utf-8"))
    raw = os.environ.get("GOVERNANCE_ALLOWLIST", "")
    return _parse(raw.replace(",", "\n"))


def write_allowlist(hosts: list[str]) -> list[str]:
    cleaned = _parse("\n".join(str(host) for host in hosts))
    path = allowlist_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    body = "\n".join(cleaned)
    path.write_text(body + ("\n" if body else ""), encoding="utf-8")
    try:
        path.chmod(0o600)
    except OSError:
        pass
    return cleaned


def _parse(text: str) -> list[str]:
    hosts: list[str] = []
    for raw in text.splitlines():
        item = raw.strip()
        if not item or item.startswith("#"):
            continue
        if any(char.isspace() for char in item) or len(item) > 253:
            continue
        if item not in hosts:
            hosts.append(item)
        if len(hosts) == 200:
            break
    return hosts
