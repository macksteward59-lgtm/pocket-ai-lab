"""Read dependency manifests as text. Nothing is downloaded or installed."""

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class DependencyNote(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str
    specifier: str
    pinned: bool
    notes: list[str] = Field(default_factory=list)
    authorized: Literal[False] = False


class DependencyTriage(BaseModel):
    model_config = ConfigDict(extra="forbid")

    notes: list[DependencyNote]
    authorized: Literal[False] = False
    executes: Literal[False] = False


def triage_requirements(text: str) -> DependencyTriage:
    notes: list[DependencyNote] = []
    for raw_line in text.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith(("-i ", "--index-url ", "--extra-index-url ")):
            notes.append(DependencyNote(
                name=line.split()[0],
                specifier=line,
                pinned=False,
                notes=["Cleartext or remote index URLs are recorded and not fetched."],
            ))
            continue
        if line.startswith("-e ") or line.startswith("--editable "):
            notes.append(DependencyNote(name=line, specifier=line, pinned=False, notes=["Editable install noted; not installed."]))
            continue
        name, sep, specifier = _split_requirement(line)
        pinned = sep == "==" and bool(specifier) and "*" not in specifier
        flags = []
        if line.startswith("git+http://") or "http://" in line:
            flags.append("Cleartext URL noted; not fetched.")
        if not pinned:
            flags.append("Dependency is not pinned to an exact version.")
        notes.append(DependencyNote(name=name[:120], specifier=specifier[:120], pinned=pinned, notes=flags))
    return DependencyTriage(notes=notes[:200])


def triage_package_json(payload: dict) -> DependencyTriage:
    notes: list[DependencyNote] = []
    for section in ("dependencies", "devDependencies", "optionalDependencies"):
        block = payload.get(section)
        if not isinstance(block, dict):
            continue
        for name, version in block.items():
            spec = str(version)
            pinned = spec[:1].isdigit() or spec.startswith("v")
            flags = []
            if spec in {"*", "latest", ""} or spec.startswith(("^", "~", ">", "<")):
                pinned = False
                flags.append("Dependency is not pinned to an exact version.")
            if spec.startswith(("http://", "git+http://")):
                flags.append("Cleartext URL noted; not fetched.")
                pinned = False
            notes.append(DependencyNote(name=str(name)[:120], specifier=spec[:120], pinned=pinned, notes=flags))
    return DependencyTriage(notes=notes[:200])


def _split_requirement(line: str) -> tuple[str, str, str]:
    for operator in ("===", "==", ">=", "<=", "~=", "!=", ">", "<"):
        if operator in line:
            name, specifier = line.split(operator, 1)
            return name.strip(), operator, specifier.strip()
    return line.strip(), "", ""
