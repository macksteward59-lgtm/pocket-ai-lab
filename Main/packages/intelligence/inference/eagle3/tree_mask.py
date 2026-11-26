"""Additive draft-tree mask.

A position may attend to itself and its explicit ancestors. Siblings, descendants,
and other branches are blocked. This is not a triangular positional mask: a later
list index can be an ancestor, and an earlier index can be blocked.
"""

from __future__ import annotations


class Eagle3TreeError(ValueError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


def additive_tree_mask(nodes: list[dict]) -> list[list[float]]:
    ordered = validate_tree(nodes)
    allowed = _ancestor_sets(ordered)
    ids = [node["id"] for node in ordered]
    mask: list[list[float]] = []
    for node_id in ids:
        mask.append([0.0 if other in allowed[node_id] else float("-inf") for other in ids])
    return mask


def validate_tree(nodes: object) -> list[dict]:
    if not isinstance(nodes, list):
        raise Eagle3TreeError("bad_node", "A draft tree must be a list of nodes")
    if any(_looks_like_tensor(node) for node in nodes):
        raise Eagle3TreeError("bad_index", "A draft tree must be node records, not a tensor")
    parsed: list[dict] = []
    seen: set[str] = set()
    for node in nodes:
        if not isinstance(node, dict):
            raise Eagle3TreeError("bad_node", "Each draft node must be a record with id and parent")
        node_id = node.get("id")
        parent = node.get("parent")
        if type(node_id) is not str or not node_id:
            raise Eagle3TreeError("bad_index", "Node ids must be non-empty strings, not list indexes")
        if node_id in seen:
            raise Eagle3TreeError("duplicate_id", "Draft node ids must be unique")
        seen.add(node_id)
        if parent is not None and (type(parent) is not str or not parent):
            raise Eagle3TreeError("bad_index", "A parent must be a node id string or null, not a list index")
        if parent == node_id:
            raise Eagle3TreeError("cycle", "A draft node cannot be its own parent")
        parsed.append({"id": node_id, "parent": parent})
    if not parsed:
        raise Eagle3TreeError("no_root", "A draft tree needs one root")
    roots = [node for node in parsed if node["parent"] is None]
    if len(roots) != 1:
        code = "no_root" if not roots else "multiple_roots"
        raise Eagle3TreeError(code, "A draft tree needs exactly one root")
    ids = {node["id"] for node in parsed}
    for node in parsed:
        if node["parent"] is not None and node["parent"] not in ids:
            raise Eagle3TreeError("missing_parent", "A parent id is not in the draft tree")
    _ancestor_sets(parsed)
    return parsed


def _ancestor_sets(nodes: list[dict]) -> dict[str, set[str]]:
    parent = {node["id"]: node["parent"] for node in nodes}
    cache: dict[str, set[str]] = {}

    def walk(node_id: str, stack: set[str]) -> set[str]:
        if node_id in cache:
            return cache[node_id]
        if node_id in stack:
            raise Eagle3TreeError("cycle", "Draft ancestry contains a cycle")
        stack.add(node_id)
        ancestor = parent[node_id]
        if ancestor is None:
            found = {node_id}
        else:
            found = set(walk(ancestor, stack))
            found.add(node_id)
        stack.remove(node_id)
        cache[node_id] = found
        return found

    for node in nodes:
        walk(node["id"], set())
    root = next(node["id"] for node in nodes if node["parent"] is None)
    for node in nodes:
        if root not in cache[node["id"]]:
            raise Eagle3TreeError("isolated", "A draft node does not reach the root")
    return cache


def _looks_like_tensor(value: object) -> bool:
    return hasattr(value, "shape") and hasattr(value, "dtype") and not isinstance(value, dict)
