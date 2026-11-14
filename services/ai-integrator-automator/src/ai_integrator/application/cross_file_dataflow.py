"""Bounded cross-file Python import and source-to-sink analysis.

Only parses submitted text with ast.parse. It never imports, compiles, evaluates,
or executes project source. Version 0.1 follows direct imported function calls;
all unresolved or unsupported imports are explicit partial-analysis records.
"""
from __future__ import annotations

import ast
from dataclasses import dataclass
from pathlib import PurePosixPath
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

from ai_integrator.application.ast_dataflow import _name, _render, _sink, _source_node

_MAX_FILES = 50
_MAX_FILE_BYTES = 1_000_000
_MAX_TOTAL_BYTES = 5_000_000
_MAX_NODES_PER_FILE = 20_000
_MAX_TOTAL_NODES = 100_000
_MAX_IMPORTS = 500
_MAX_SIGNALS = 100


class ProjectSourceFile(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    path: str = Field(min_length=1, max_length=240)
    source: str = Field(max_length=_MAX_FILE_BYTES)


class CrossFileObservation(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    kind: str
    source_file: str
    source_line: int
    source_expression: str
    source_excerpt: str
    sink_file: str
    sink_line: int
    sink_expression: str
    sink_excerpt: str
    imported_symbol: str


class ProjectImportEdge(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    from_file: str
    to_file: str
    module: str
    symbol: str | None = None


class UnresolvedProjectImport(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    from_file: str
    module: str
    reason: Literal["external", "dynamic", "not-found", "ambiguous", "unsupported"]


class CrossFileAnalysisReport(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    parser_status: Literal["parsed", "partial", "syntax-error", "unsupported", "truncated"]
    observations: list[CrossFileObservation] = Field(default_factory=list)
    resolved_imports: list[ProjectImportEdge] = Field(default_factory=list)
    unresolved_imports: list[UnresolvedProjectImport] = Field(default_factory=list)
    files_analyzed: int = 0
    nodes_visited: int = 0
    authorized: Literal[False] = False
    executes: Literal[False] = False
    limitations: list[str] = Field(default_factory=list)


@dataclass(frozen=True)
class _File:
    path: str
    source: str
    tree: ast.Module


@dataclass(frozen=True)
class _SinkSite:
    kind: str
    path: str
    line: int
    expression: str


def _valid_path(path: str) -> bool:
    PurePosixPath(path)
    return (len(path) <= 240 and not path.startswith("/") and "\\" not in path
            and ":" not in path and all(part not in {"", ".", ".."} for part in path.split("/"))
            and not any(ord(ch) < 32 or ord(ch) == 127 for ch in path))


def _module_index(files: dict[str, _File]) -> dict[str, list[str]]:
    modules: dict[str, list[str]] = {}
    for path in files:
        parts = path[:-3].split("/") if path.endswith(".py") else []
        if not parts:
            continue
        if parts[-1] == "__init__":
            parts = parts[:-1]
        aliases = {".".join(parts)}
        # Permit a conventional submitted source root such as src/, app/, or
        # package/ to be omitted from import names, while retaining full names.
        if len(parts) > 1:
            aliases.add(".".join(parts[1:]))
        for module in aliases:
            modules.setdefault(module, []).append(path)
    return modules


def _resolve_imports(files: dict[str, _File]) -> tuple[list[ProjectImportEdge], list[UnresolvedProjectImport], dict[tuple[str, str], tuple[str, str]]]:
    index = _module_index(files)
    edges: list[ProjectImportEdge] = []
    unresolved: list[UnresolvedProjectImport] = []
    bindings: dict[tuple[str, str], tuple[str, str]] = {}
    for path, item in files.items():
        for node in ast.walk(item.tree):
            if isinstance(node, ast.Import):
                for alias in node.names:
                    matches = index.get(alias.name, [])
                    if len(matches) == 1:
                        target = matches[0]
                        local_name = alias.asname or alias.name.split(".")[0]
                        bindings[(path, local_name)] = (target, alias.name)
                        edges.append(ProjectImportEdge(from_file=path, to_file=target, module=alias.name))
                    else:
                        unresolved.append(UnresolvedProjectImport(from_file=path, module=alias.name,
                            reason="ambiguous" if len(matches) > 1 else "external"))
            elif isinstance(node, ast.ImportFrom):
                if node.level:
                    unresolved.append(UnresolvedProjectImport(from_file=path, module=("." * node.level) + (node.module or ""), reason="unsupported"))
                    continue
                module = node.module or ""
                matches = index.get(module, [])
                if len(matches) != 1:
                    unresolved.append(UnresolvedProjectImport(from_file=path, module=module,
                        reason="ambiguous" if len(matches) > 1 else "external"))
                    continue
                target = matches[0]
                for alias in node.names:
                    if alias.name == "*":
                        unresolved.append(UnresolvedProjectImport(from_file=path, module=module + ".*", reason="unsupported"))
                        continue
                    local_name = alias.asname or alias.name
                    bindings[(path, local_name)] = (target, alias.name)
                    edges.append(ProjectImportEdge(from_file=path, to_file=target, module=module, symbol=alias.name))
    edge_map = {(e.from_file, e.to_file, e.module, e.symbol): e for e in edges}
    unresolved_map = {(u.from_file, u.module, u.reason): u for u in unresolved}
    return list(edge_map.values()), list(unresolved_map.values()), bindings


def _function_summaries(files: dict[str, _File]) -> dict[tuple[str, str], dict[int, list[_SinkSite]]]:
    summaries: dict[tuple[str, str], dict[int, list[_SinkSite]]] = {}
    for path, item in files.items():
        functions = [n for n in ast.walk(item.tree) if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))]
        for fn in functions:
            params = [*fn.args.posonlyargs, *fn.args.args]
            env = {arg.arg: {i} for i, arg in enumerate(params)}
            summary: dict[int, list[_SinkSite]] = {}
            def walk(body: list[ast.stmt]) -> None:
                for statement in body:
                    expr = statement.value if isinstance(statement, (ast.Assign, ast.AnnAssign, ast.Expr, ast.Return)) else None
                    if expr is not None:
                        for call in (n for n in ast.walk(expr) if isinstance(n, ast.Call)):
                            found = _sink(call)
                            if found:
                                args = [*call.args, *(kw.value for kw in call.keywords)]
                                for arg in args:
                                    origins = set().union(*(env.get(n.id, set()) for n in ast.walk(arg) if isinstance(n, ast.Name)))
                                    for index in origins:
                                        site = _SinkSite(found[0], path, getattr(call, "lineno", 1), _render(call))
                                        summary.setdefault(index, [])
                                        if site not in summary[index]:
                                            summary[index].append(site)
                        if isinstance(statement, ast.Assign):
                            origins = set().union(*(env.get(n.id, set()) for n in ast.walk(expr) if isinstance(n, ast.Name)))
                            for target in statement.targets:
                                if isinstance(target, ast.Name):
                                    if origins: env[target.id] = set(origins)
                                    else: env.pop(target.id, None)
                        elif isinstance(statement, ast.AnnAssign) and isinstance(statement.target, ast.Name):
                            origins = set().union(*(env.get(n.id, set()) for n in ast.walk(expr) if isinstance(n, ast.Name)))
                            if origins: env[statement.target.id] = set(origins)
                            else: env.pop(statement.target.id, None)
                    elif isinstance(statement, (ast.If, ast.For, ast.AsyncFor, ast.While, ast.Try, ast.With, ast.AsyncWith, ast.Match)):
                        for field in ("body", "orelse", "finalbody"):
                            nested = getattr(statement, field, None)
                            if isinstance(nested, list): walk(nested)
                        for handler in getattr(statement, "handlers", []): walk(handler.body)
                        for case in getattr(statement, "cases", []): walk(case.body)
            walk(fn.body)
            summaries[(path, fn.name)] = summary
    return summaries


def analyze_python_project(files_input: list[ProjectSourceFile]) -> CrossFileAnalysisReport:
    if not isinstance(files_input, list) or not 1 <= len(files_input) <= _MAX_FILES:
        raise ValueError("Project analysis requires between 1 and 50 files")
    files: dict[str, _File] = {}
    total_bytes = 0
    total_nodes = 0
    for source_file in files_input:
        path = source_file.path
        if not _valid_path(path):
            raise ValueError("Project file path must be a bounded relative path without traversal")
        if path in files:
            raise ValueError("Duplicate project file path")
        encoded = source_file.source.encode("utf-8")
        if len(encoded) > _MAX_FILE_BYTES:
            raise ValueError("Project file exceeds the 1 MB limit")
        total_bytes += len(encoded)
        if total_bytes > _MAX_TOTAL_BYTES:
            raise ValueError("Project exceeds the 5 MB aggregate source limit")
        try:
            tree = ast.parse(source_file.source, mode="exec", type_comments=True)
        except (SyntaxError, ValueError, RecursionError, MemoryError):
            return CrossFileAnalysisReport(parser_status="syntax-error", files_analyzed=len(files),
                authorized=False, executes=False,
                limitations=["At least one submitted file could not be parsed; no cross-file conclusion is produced."])
        count = 0
        for _ in ast.walk(tree):
            count += 1
            if count > _MAX_NODES_PER_FILE:
                break
        if count > _MAX_NODES_PER_FILE:
            return CrossFileAnalysisReport(parser_status="unsupported", files_analyzed=len(files),
                nodes_visited=total_nodes, authorized=False, executes=False,
                limitations=["Per-file AST node budget exceeded."])
        total_nodes += count
        if total_nodes > _MAX_TOTAL_NODES:
            return CrossFileAnalysisReport(parser_status="unsupported", files_analyzed=len(files),
                nodes_visited=total_nodes, authorized=False, executes=False,
                limitations=["Aggregate AST node budget exceeded."])
        files[path] = _File(path, source_file.source, tree)
    edges, unresolved, bindings = _resolve_imports(files)
    if len(edges) + len(unresolved) > _MAX_IMPORTS:
        return CrossFileAnalysisReport(parser_status="truncated", files_analyzed=len(files),
            nodes_visited=total_nodes, authorized=False, executes=False,
            limitations=["Import graph exceeds the 500-edge budget."])
    try:
        summaries = _function_summaries(files)
    except (RecursionError, MemoryError):
        return CrossFileAnalysisReport(parser_status="unsupported", files_analyzed=len(files),
            nodes_visited=total_nodes, authorized=False, executes=False,
            limitations=["Function-summary traversal exceeded a safe recursion or memory bound."])
    observations: list[CrossFileObservation] = []
    seen: set[tuple[str, int, str, int, str]] = set()
    analysis_partial = bool(unresolved)
    limitations = [
        "Only direct calls to statically resolved imported Python functions are followed across files.",
        "The analyzer does not execute imports or source code; it parses submitted text only.",
        "Relative imports, star imports, dynamic imports, ambiguous modules, and external packages are unresolved.",
        "Cross-file function summaries cover simple positional parameter-to-sink flow; keyword calls and starred arguments are not mapped.",
        "Object/container/attribute aliases, decorators, dispatch, sanitizers, and framework semantics are unsupported.",
        "Branches and loops are traversed conservatively but are not path-verified; import reachability is not runtime call reachability.",
        "Signals are unverified review leads, not vulnerability findings; missing signals are not evidence of safety.",
    ]
    def origins(node: ast.AST, env: dict[str, list[tuple[int, str]]]) -> list[tuple[int, str]]:
        found: list[tuple[int, str]] = []
        def visit(part: ast.AST) -> None:
            if _source_node(part):
                item = (getattr(part, "lineno", 1), _render(part))
                if item not in found: found.append(item)
                return
            if isinstance(part, ast.Name) and part.id in env:
                for item in env[part.id]:
                    if item not in found: found.append(item)
                return
            for child in ast.iter_child_nodes(part): visit(child)
        visit(node)
        return found
    def excerpt(source: str, line: int) -> str:
        lines = source.splitlines()
        return lines[line - 1].strip()[:240] if 1 <= line <= len(lines) else ""
    def process_scope(path: str, body: list[ast.stmt]) -> None:
        nonlocal analysis_partial
        env: dict[str, list[tuple[int, str]]] = {}
        for statement in body:
            expr = statement.value if isinstance(statement, (ast.Assign, ast.AnnAssign, ast.Expr, ast.Return)) else None
            if expr is not None:
                for call in (n for n in ast.walk(expr) if isinstance(n, ast.Call)):
                    local = _name(call.func)
                    target = bindings.get((path, local))
                    if target is None and "." in local:
                        root, attr = local.split(".", 1)
                        imported = bindings.get((path, root))
                        if imported and imported[1]:
                            module_tail = imported[1].split(".")[-1]
                            if attr.startswith(module_tail + "."):
                                target = (imported[0], attr[len(module_tail) + 1:])
                            elif "." not in attr:
                                target = (imported[0], attr)
                    if target is None:
                        continue
                    if call.keywords or any(isinstance(arg, ast.Starred) for arg in call.args):
                        analysis_partial = True
                        continue
                    summary = summaries.get(target)
                    if not summary:
                        continue
                    for index, arg in enumerate(call.args):
                        for source_line, source_expr in origins(arg, env):
                            for site in summary.get(index, []):
                                key = (path, source_line, site.path, site.line, source_expr)
                                if key in seen: continue
                                seen.add(key)
                                if len(observations) >= _MAX_SIGNALS:
                                    return
                                observations.append(CrossFileObservation(
                                    kind=site.kind, source_file=path, source_line=source_line,
                                    source_expression=source_expr, source_excerpt=excerpt(files[path].source, source_line),
                                    sink_file=site.path, sink_line=site.line, sink_expression=site.expression,
                                    sink_excerpt=excerpt(files[site.path].source, site.line),
                                    imported_symbol=target[1] or local
                                ))
                if isinstance(statement, ast.Assign):
                    found = origins(expr, env)
                    for target_node in statement.targets:
                        if isinstance(target_node, ast.Name):
                            if found: env[target_node.id] = found
                            else: env.pop(target_node.id, None)
                elif isinstance(statement, ast.AnnAssign) and isinstance(statement.target, ast.Name):
                    found = origins(expr, env)
                    if found: env[statement.target.id] = found
                    else: env.pop(statement.target.id, None)
            elif isinstance(statement, (ast.FunctionDef, ast.AsyncFunctionDef)):
                process_scope(path, statement.body)
            elif isinstance(statement, (ast.If, ast.For, ast.AsyncFor, ast.While, ast.Try, ast.With, ast.AsyncWith, ast.Match)):
                analysis_partial = True
                for field in ("body", "orelse", "finalbody"):
                    nested = getattr(statement, field, None)
                    if isinstance(nested, list): process_scope(path, nested)
                for handler in getattr(statement, "handlers", []): process_scope(path, handler.body)
                for case in getattr(statement, "cases", []): process_scope(path, case.body)
    try:
        for path, item in files.items():
            process_scope(path, item.tree.body)
    except (RecursionError, MemoryError):
        return CrossFileAnalysisReport(parser_status="unsupported", files_analyzed=len(files),
            nodes_visited=total_nodes, authorized=False, executes=False,
            limitations=["Cross-file flow traversal exceeded a safe recursion or memory bound."])
    analysis_partial = analysis_partial or len(observations) >= _MAX_SIGNALS
    return CrossFileAnalysisReport(
        parser_status="partial" if analysis_partial else "parsed",
        observations=observations, resolved_imports=edges, unresolved_imports=unresolved,
        files_analyzed=len(files), nodes_visited=total_nodes, authorized=False, executes=False,
        limitations=limitations,
    )
