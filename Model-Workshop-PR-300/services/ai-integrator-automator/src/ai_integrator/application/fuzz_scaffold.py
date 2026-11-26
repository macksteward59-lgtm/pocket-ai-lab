"""Parameter checklist for a human tester.

This module does not generate payloads, open sockets, or send traffic.
"""

import re

_NAME = re.compile(r"^[A-Za-z0-9_.-]{1,80}$")


class FuzzScaffoldRejected(Exception):
    """The caller asked this module to produce something it will not produce."""


def build_fuzz_scaffold(parameters: list[str] | None, *, emit_payloads: bool = False) -> dict:
    if emit_payloads:
        raise FuzzScaffoldRejected("This module does not generate payloads")
    clean: list[str] = []
    for parameter in parameters or []:
        name = str(parameter).strip()
        if _NAME.fullmatch(name) and name not in clean:
            clean.append(name)
        if len(clean) == 50:
            break
    return {
        "authorized": False,
        "executes": False,
        "payloads": [],
        "parameters": clean,
        "operator_checklist": [
            "Do not send traffic from this pipeline.",
            "Parameter names below are labels for a human tester.",
            *[f"Review parameter {name} in your own environment, outside this pipeline." for name in clean],
        ],
    }
