"""Conservative, non-executing route/authentication surface inventory for Python AST."""
from __future__ import annotations

import ast
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field

_ROUTE_METHODS = {"get":"GET","post":"POST","put":"PUT","patch":"PATCH","delete":"DELETE","options":"OPTIONS","head":"HEAD"}
_AUTH_NAMES = {
    "login_required", "requires_auth", "authenticated", "jwt_required",
    "permission_required", "requires_role", "require_auth", "auth_required",
    "verify_token", "current_user_required", "admin_required",
}
_LIMITATIONS = [
    "Only route declarations and guard signals visible in this file are inspected.",
    "Router-level dependencies, parent decorators, global middleware, reverse proxies, gateways, and external policy are not resolved.",
    "A missing local guard signal is not evidence of an authorization vulnerability.",
    "This is a source inventory only; it does not establish reachability, effective policy, or exploitability.",
]

class AuthorizationRoute(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    path: str | None
    methods: list[str] = Field(default_factory=list)
    function: str
    line: int
    guard_status: Literal["local-guard-observed", "no-local-guard-observed", "indeterminate"]
    guard_signals: list[str] = Field(default_factory=list)
    excerpt: str

class AuthorizationSurfaceReport(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    parser_status: Literal["parsed", "syntax-error", "unsupported", "truncated"]
    routes: list[AuthorizationRoute] = Field(default_factory=list)
    limitations: list[str] = Field(default_factory=lambda: list(_LIMITATIONS))
    authorized: Literal[False] = False
    executes: Literal[False] = False

def _name(node: ast.AST) -> str:
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        prefix = _name(node.value)
        return f"{prefix}.{node.attr}" if prefix else node.attr
    return ""

def _literal_string(node: ast.AST | None) -> str | None:
    return node.value if isinstance(node, ast.Constant) and isinstance(node.value, str) else None

def _decorator_name(node: ast.AST) -> str:
    return _name(node.func if isinstance(node, ast.Call) else node)

def _is_guard_name(name: str) -> bool:
    tail = name.rsplit(".", 1)[-1].lower()
    return tail in _AUTH_NAMES or tail in {"depends", "security"} and False

def _dependency_guards(node: ast.AST) -> list[str]:
    found: list[str] = []
    for item in ast.walk(node):
        if not isinstance(item, ast.Call):
            continue
        call = _name(item.func).rsplit(".", 1)[-1]
        if call not in {"Depends", "Security"} or not item.args:
            continue
        dependency = _name(item.args[0]) or _literal_string(item.args[0]) or ""
        tail = dependency.rsplit(".", 1)[-1].lower()
        if tail in _AUTH_NAMES or any(token in tail for token in ("auth", "permission", "role", "current_user", "principal")):
            found.append(dependency[:128])
    return list(dict.fromkeys(found))

def analyze_authorization_surface(source: str, *, limit: int = 1_000_000, max_routes: int = 200) -> AuthorizationSurfaceReport:
    if not isinstance(source, str):
        source = ""
    if limit < 1 or max_routes < 1:
        raise ValueError("Analysis bounds must be positive")
    if len(source) > min(limit, 1_000_000):
        return AuthorizationSurfaceReport(parser_status="truncated", limitations=_LIMITATIONS + ["Source size limit reached; no complete route inventory was produced."])
    try:
        tree = ast.parse(source, mode="exec", type_comments=True)
    except (SyntaxError, ValueError, RecursionError, MemoryError):
        return AuthorizationSurfaceReport(parser_status="syntax-error")
    lines = source.splitlines()
    routes: list[AuthorizationRoute] = []
    partial = False
    for node in ast.walk(tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        route_decorators: list[tuple[ast.AST, str]] = []
        guards: list[str] = []
        for decorator in node.decorator_list:
            name = _decorator_name(decorator)
            tail = name.rsplit(".", 1)[-1].lower()
            if tail in _ROUTE_METHODS or tail in {"route", "api_route"}:
                route_decorators.append((decorator, tail))
            if _is_guard_name(name):
                guards.append(name[:128])
            if isinstance(decorator, ast.Call):
                guards.extend(_dependency_guards(decorator))
        # FastAPI parameter dependencies are local route-level signals.
        for arg in [*node.args.posonlyargs, *node.args.args, *node.args.kwonlyargs]:
            if arg.annotation is not None:
                guards.extend(_dependency_guards(arg.annotation))
        for default in [*node.args.defaults, *node.args.kw_defaults]:
            if default is not None:
                guards.extend(_dependency_guards(default))
        guards = list(dict.fromkeys(guards))
        for decorator, tail in route_decorators:
            path: str | None = None
            methods: list[str] = []
            if isinstance(decorator, ast.Call):
                if decorator.args:
                    path = _literal_string(decorator.args[0])
                for keyword in decorator.keywords:
                    if keyword.arg == "methods" and isinstance(keyword.value, (ast.List, ast.Tuple, ast.Set)):
                        methods = [v.value.upper() for v in keyword.value.elts if isinstance(v, ast.Constant) and isinstance(v.value, str)]
            elif isinstance(decorator, ast.Attribute):
                path = None
            if not methods:
                methods = [_ROUTE_METHODS[tail]] if tail in _ROUTE_METHODS else ["GET"]
            dynamic = path is None
            if dynamic:
                partial = True
            line = getattr(decorator, "lineno", node.lineno)
            excerpt = lines[line - 1].strip()[:240] if 1 <= line <= len(lines) else ""
            routes.append(AuthorizationRoute(
                path=path,
                methods=methods[:8],
                function=node.name[:128],
                line=line,
                guard_status="indeterminate" if dynamic else ("local-guard-observed" if guards else "no-local-guard-observed"),
                guard_signals=guards[:20],
                excerpt=excerpt,
            ))
            if len(routes) >= min(max_routes, 200):
                partial = True
                break
        if len(routes) >= min(max_routes, 200):
            break
    return AuthorizationSurfaceReport(
        parser_status="unsupported" if partial else "parsed",
        routes=routes,
        limitations=_LIMITATIONS + (["Dynamic route declarations or route budget limits made this inventory partial."] if partial else []),
    )
