"""Bounded, non-executing Python AST source-to-sink analysis.

This is a deliberately small intraprocedural analysis. It follows simple
name assignments in straight-line code and marks control-flow constructs as
partial. It does not import, evaluate, compile, or execute submitted source.
"""
from __future__ import annotations

import ast
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class DataFlowSignal(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    kind: str
    source_line: int
    sink_line: int
    source_expression: str
    sink_expression: str
    sink_name: str
    variables: list[str] = Field(default_factory=list)
    source_excerpt: str
    sink_excerpt: str


class PythonDataFlowReport(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    language: Literal["python"] = "python"
    parser_status: Literal["parsed", "syntax-error", "unsupported", "truncated"]
    signals: list[DataFlowSignal] = Field(default_factory=list)
    nodes_visited: int = 0
    truncated: bool = False
    limitations: list[str] = Field(default_factory=list)
    authorized: Literal[False] = False
    executes: Literal[False] = False


_MAX_SOURCE_CHARS = 1_000_000
_MAX_AST_NODES = 20_000
_MAX_SIGNALS = 100
_LIMITATIONS = [
    "Intraprocedural, straight-line name propagation only; branches and loops make the result partial.",
    "No interprocedural, attribute, container, alias, reflection, framework, or sanitizer semantics.",
    "A source-to-sink signal is a review lead, not proof of exploitability or a vulnerability.",
    "Absence of a signal does not establish that the source is safe.",
]

_SOURCE_PREFIXES = (
    "request.args", "request.form", "request.json", "request.data",
    "request.values", "request.cookies", "request.headers",
    "flask.request.args", "flask.request.form", "flask.request.json",
)
_SOURCE_CALLS = {"input", "get_json", "get_data"}
_SINKS: tuple[tuple[str, str], ...] = (
    ("dynamic-exec", "eval"),
    ("dynamic-exec", "exec"),
    ("deserialization", "pickle.loads"),
    ("deserialization", "yaml.load"),
    ("deserialization", "marshal.loads"),
    ("process-spawn", "os.system"),
    ("process-spawn", "os.popen"),
    ("process-spawn", "subprocess.run"),
    ("process-spawn", "subprocess.Popen"),
    ("process-spawn", "subprocess.call"),
    ("process-spawn", "subprocess.check_output"),
    ("sql-query", "execute"),
    ("sql-query", "executemany"),
    ("network-client", "requests.get"),
    ("network-client", "requests.post"),
    ("network-client", "httpx.get"),
    ("network-client", "httpx.post"),
)


def _name(node: ast.AST) -> str:
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        parent = _name(node.value)
        return f"{parent}.{node.attr}" if parent else node.attr
    return ""


def _source_node(node: ast.AST) -> bool:
    name = _name(node)
    if any(name == prefix or name.startswith(prefix + ".") for prefix in _SOURCE_PREFIXES):
        return True
    if isinstance(node, ast.Call):
        call_name = _name(node.func)
        if call_name in _SOURCE_CALLS or call_name.endswith(".get_json") or call_name.endswith(".get_data"):
            return True
        if any(call_name == prefix or call_name.startswith(prefix + ".") for prefix in _SOURCE_PREFIXES):
            return True
    return False


def _sink(node: ast.Call) -> tuple[str, str] | None:
    name = _name(node.func)
    for kind, target in _SINKS:
        if name == target or (target in {"execute", "executemany"} and name.endswith("." + target)):
            return kind, name
    return None


def _render(node: ast.AST) -> str:
    try:
        return ast.unparse(node)[:240]
    except (AttributeError, ValueError):
        return type(node).__name__


class _Analyzer:
    def __init__(self, source: str, max_signals: int) -> None:
        self.lines = source.splitlines()
        self.max_signals = max_signals
        self.signals: list[DataFlowSignal] = []
        self.seen: set[tuple[int, int, str, str]] = set()
        self.partial = False

    def excerpt(self, line: int) -> str:
        if line < 1 or line > len(self.lines):
            return ""
        return self.lines[line - 1].strip()[:240]

    def origins(self, node: ast.AST, env: dict[str, list[tuple[int, str, str]]]) -> list[tuple[int, str, str]]:
        found: list[tuple[int, str, str]] = []

        def visit(current: ast.AST) -> None:
            # Stop at the outermost source expression so request.args.get(...)
            # is one provenance origin rather than three nested matches.
            if _source_node(current):
                entry = (getattr(current, "lineno", 1), _render(current), "")
                if entry not in found:
                    found.append(entry)
                return
            if isinstance(current, ast.Name) and current.id in env:
                for entry in env[current.id]:
                    if entry not in found:
                        found.append(entry)
                return
            for child in ast.iter_child_nodes(current):
                visit(child)

        visit(node)
        return found

    def inspect_sinks(self, node: ast.AST, env: dict[str, list[tuple[int, str, str]]]) -> None:
        for child in ast.walk(node):
            if not isinstance(child, ast.Call):
                continue
            sink = _sink(child)
            if sink is None:
                continue
            kind, sink_name = sink
            arguments = [*child.args, *(keyword.value for keyword in child.keywords)]
            origins: list[tuple[int, str, str]] = []
            variables: list[str] = []
            for argument in arguments:
                for origin in self.origins(argument, env):
                    if origin not in origins:
                        origins.append(origin)
                for subnode in ast.walk(argument):
                    if isinstance(subnode, ast.Name) and subnode.id in env and subnode.id not in variables:
                        variables.append(subnode.id)
            for source_line, source_expression, _ in origins:
                key = (source_line, getattr(child, "lineno", 1), sink_name, source_expression)
                if key in self.seen:
                    continue
                self.seen.add(key)
                if len(self.signals) >= self.max_signals:
                    self.partial = True
                    return
                self.signals.append(DataFlowSignal(
                    kind=kind,
                    source_line=source_line,
                    sink_line=getattr(child, "lineno", 1),
                    source_expression=source_expression,
                    sink_expression=_render(child),
                    sink_name=sink_name,
                    variables=variables,
                    source_excerpt=self.excerpt(source_line),
                    sink_excerpt=self.excerpt(getattr(child, "lineno", 1)),
                ))

    def bind_target(self, target: ast.AST, origins: list[tuple[int, str, str]], env: dict[str, list[tuple[int, str, str]]]) -> None:
        if isinstance(target, ast.Name):
            if origins:
                env[target.id] = origins
            else:
                env.pop(target.id, None)
        elif isinstance(target, (ast.Tuple, ast.List)):
            self.partial = True
            for element in target.elts:
                if isinstance(element, ast.Name):
                    env.pop(element.id, None)
        else:
            self.partial = True

    def statements(self, body: list[ast.stmt], env: dict[str, list[tuple[int, str, str]]]) -> None:
        for statement in body:
            if len(self.signals) >= self.max_signals:
                self.partial = True
                return
            if isinstance(statement, (ast.FunctionDef, ast.AsyncFunctionDef)):
                local_env: dict[str, list[tuple[int, str, str]]] = {}
                self.statements(statement.body, local_env)
            elif isinstance(statement, ast.ClassDef):
                self.statements(statement.body, {})
            elif isinstance(statement, ast.Assign):
                self.inspect_sinks(statement.value, env)
                origins = self.origins(statement.value, env)
                for target in statement.targets:
                    self.bind_target(target, origins, env)
            elif isinstance(statement, ast.AnnAssign):
                if statement.value is not None:
                    self.inspect_sinks(statement.value, env)
                    self.bind_target(statement.target, self.origins(statement.value, env), env)
            elif isinstance(statement, ast.AugAssign):
                self.inspect_sinks(statement.value, env)
                self.partial = True
                if isinstance(statement.target, ast.Name):
                    env.pop(statement.target.id, None)
            elif isinstance(statement, ast.Expr):
                self.inspect_sinks(statement.value, env)
            elif isinstance(statement, ast.Return):
                if statement.value is not None:
                    self.inspect_sinks(statement.value, env)
            elif isinstance(statement, (ast.If, ast.For, ast.AsyncFor, ast.While, ast.Try, ast.With, ast.AsyncWith, ast.Match)):
                self.partial = True
                # Analyze each possible body with a copy; never merge branch state.
                for field in ("body", "orelse", "finalbody"):
                    branch = getattr(statement, field, None)
                    if isinstance(branch, list):
                        self.statements(branch, dict(env))
                for handler in getattr(statement, "handlers", []):
                    self.statements(handler.body, dict(env))
                for case in getattr(statement, "cases", []):
                    self.statements(case.body, dict(env))
            else:
                # Unknown statement types are not interpreted as safe.
                self.partial = True


def analyze_python_dataflow(source: str, *, limit: int = _MAX_SOURCE_CHARS, max_nodes: int = _MAX_AST_NODES, max_signals: int = _MAX_SIGNALS) -> PythonDataFlowReport:
    if not isinstance(source, str):
        source = ""
    if limit < 1 or max_nodes < 1 or max_signals < 1:
        raise ValueError("Analysis bounds must be positive")
    truncated = len(source) > min(limit, _MAX_SOURCE_CHARS)
    body = source[: min(limit, _MAX_SOURCE_CHARS)]
    if truncated:
        return PythonDataFlowReport(parser_status="truncated", truncated=True, limitations=_LIMITATIONS)

    try:
        tree = ast.parse(body, mode="exec", type_comments=True)
    except (SyntaxError, ValueError, RecursionError, MemoryError):
        return PythonDataFlowReport(parser_status="syntax-error", truncated=False, limitations=_LIMITATIONS)

    count = 0
    stack: list[ast.AST] = [tree]
    while stack:
        node = stack.pop()
        count += 1
        if count > min(max_nodes, _MAX_AST_NODES):
            return PythonDataFlowReport(
                parser_status="unsupported", nodes_visited=count, truncated=True,
                limitations=_LIMITATIONS + ["AST node budget exceeded; no data-flow conclusion was produced."],
            )
        stack.extend(ast.iter_child_nodes(node))

    analyzer = _Analyzer(body, min(max_signals, _MAX_SIGNALS))
    analyzer.statements(tree.body, {})
    status: Literal["parsed", "unsupported"] = "unsupported" if analyzer.partial else "parsed"
    return PythonDataFlowReport(
        parser_status=status,
        signals=analyzer.signals,
        nodes_visited=count,
        truncated=False,
        limitations=_LIMITATIONS,
    )
