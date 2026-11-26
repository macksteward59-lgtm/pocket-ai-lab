"""Extract import and definition names with regular expressions.

The source text is not parsed by the interpreter and is not executed.
"""

import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

_IMPORT = re.compile(r"^\s*(?:import|from)\s+([A-Za-z_][A-Za-z0-9_\.]*)", re.MULTILINE)
_DEF = re.compile(r"^\s*def\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(", re.MULTILINE)
_CLASS = re.compile(r"^\s*class\s+([A-Za-z_][A-Za-z0-9_]*)\b", re.MULTILINE)
_TS_FN = re.compile(r"^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(", re.MULTILINE)


class SourceContext(BaseModel):
    model_config = ConfigDict(extra="forbid")

    imports: list[str] = Field(default_factory=list)
    functions: list[str] = Field(default_factory=list)
    classes: list[str] = Field(default_factory=list)
    truncated: bool = False
    authorized: Literal[False] = False
    executes: Literal[False] = False


class StaticContextExtractor:
    def extract(self, source: str, *, limit: int = 1_000_000) -> SourceContext:
        text = source if isinstance(source, str) else ""
        truncated = len(text) > limit
        body = text[:limit]
        return SourceContext(
            imports=_unique(_IMPORT.findall(body)),
            functions=_unique([*_DEF.findall(body), *_TS_FN.findall(body)]),
            classes=_unique(_CLASS.findall(body)),
            truncated=truncated,
        )


def _unique(values: list[str]) -> list[str]:
    seen: list[str] = []
    for value in values:
        if value not in seen:
            seen.append(value)
        if len(seen) == 200:
            break
    return seen
