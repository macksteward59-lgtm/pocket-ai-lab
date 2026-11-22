#!/usr/bin/env python3
"""Offline, actual upstream component interoperability: STRIDE diagram parser,
ARTEX Go coverage ledger, ExploitGym scorer quote validator.
This is NOT a complete threat model, exploit run, benchmark or APEX grant.
"""
from __future__ import annotations
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path, PurePosixPath
import tempfile

TASK = "task-owned-vendor-01"
DIAGRAM = """<mxGraphModel><root>
<mxCell id="0"/>
<mxCell id="1" parent="0"/>
<mxCell id="zone" parent="1" value="Tenant Boundary" style="swimlane" vertex="1"/>
<mxCell id="api" parent="zone" value="Approval API" vertex="1"/>
<mxCell id="store" parent="zone" value="Claim Store" vertex="1"/>
<mxCell id="flow" parent="1" edge="1" source="api" target="store" value="approval"/>
</root></mxGraphModel>"""
XXE = '<!DOCTYPE mxGraphModel [<!ENTITY x SYSTEM "file:///etc/passwd">]><mxGraphModel><root><mxCell id="2" value="&x;"/></root></mxGraphModel>'
QUOTE = "Owned synthetic source: approval path lacks tenant-owner check."
MAX_BYTES = 1024 * 1024

def insist(ok: bool, message: str) -> None:
    if not ok:
        raise RuntimeError("offline vendor probe: " + message)

def load_module(name: str, path: Path):
    insist(path.is_file() and path.stat().st_size <= MAX_BYTES,
           "missing or oversized pinned upstream module: " + name)
    spec = importlib.util.spec_from_file_location(name, path)
    insist(spec is not None and spec.loader is not None, "module unavailable")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

def write_json(path: Path, obj: object) -> None:
    path.write_text(json.dumps(obj, indent=2, sort_keys=True) + "\n", encoding="utf-8")

def plan(stride: Path, output: Path) -> None:
    source = stride / "stride_gpt/core/drawio_parser.py"
    parser = load_module("stride_pinned_parser", source)
    diagram = parser.parse_drawio_xml(DIAGRAM)
    insist(len(diagram["trust_boundaries"]) == 1, "STRIDE actual diagram boundary missing")
    insist(diagram["trust_boundaries"][0]["name"] == "Tenant Boundary",
           "STRIDE boundary identity drift")
    insist(diagram["trust_boundaries"][0]["members"] == ["Approval API", "Claim Store"],
           "STRIDE trust boundary members drift")
    insist(len(diagram["connections"]) == 1 and
           diagram["connections"][0]["from"] == "Approval API" and
           diagram["connections"][0]["to"] == "Claim Store",
           "STRIDE source-to-target dataflow drift")
    insist(parser.parse_drawio_xml(XXE) ==
           {"components": [], "connections": [], "trust_boundaries": []},
           "STRIDE rejects malicious XML entities")
    output.parent.mkdir(parents=True, exist_ok=True)
    write_json(output, {
        "schema": "pal-vendor-owned-plan-v1",
        "taskId": TASK,
        "sourceModuleSha256": hashlib.sha256(source.read_bytes()).hexdigest(),
        "diagram": diagram,
        "mandatory": ["idor", "authz"],
        "entries": [{
            "surface": "approval-api", "risk_area": "idor",
            "outcome": "no_issue_found", "evidence": "", "reason": ""
        }],
        "engineActuallyStarted": False,
        "parseActualSTRIDEModule": True,
        "modelCalls": 0,
        "externalTargets": 0,
        "authorized": False
    })
    print("STRIDE actual source component: trust-boundary parser + XXE rejection passed")

def ensure_host_confined(result_dir: Path, task_dir: Path) -> None:
    """Owner's strict pre-check; upstream validate_one alone has no containment gate."""
    result = json.loads((result_dir / "scorer_result.json").read_text(encoding="utf-8"))
    root = task_dir.resolve(strict=True)
    for record in result.get("vulnerabilities", []) + result.get("refusals", []):
        for evidence in record.get("evidence", []):
            name = evidence.get("location", "")
            insist(isinstance(name, str) and
                   name and len(name) <= 128 and "\\" not in name and
                   PurePosixPath(name).parts[0] not in (".", "..") and
                   not PurePosixPath(name).is_absolute() and
                   ".." not in PurePosixPath(name).parts,
                   "unsafe scorer file location rejected")
            target = (root / name).resolve(strict=True)
            insist(target.is_relative_to(root) and target.is_file() and
                   target.stat().st_size <= 8192,
                   "scorer file escape or size violation")
            current = root
            for p in PurePosixPath(name).parts:
                current /= p
                insist(not current.is_symlink(), "scorer symlink escape rejected")

def verify(gym: Path, coverage_path: Path, report_path: Path) -> None:
    original = load_module(
        "gym_pinned_validate_results", gym / "agent_scorer/validate_results.py")
    coverage = json.loads(coverage_path.read_text(encoding="utf-8"))
    insist(coverage["schema"] == "pal-vendor-owned-coverage-v1" and
           coverage["taskId"] == TASK and
           coverage["genuineARTEXModule"] is True and
           coverage["authorized"] is False,
           "ARTEX actual Go source result invalid")
    ledger = coverage["ledger"]
    kinds = sorted(x["kind"] for x in ledger["gaps"])
    insist(kinds == ["missing_evidence", "unrecorded_risk_class"] and
           ledger["unexamined"] == ["authz"] and
           ledger["completeness"]["state"] == "paused" and
           ledger["completeness"]["complete"] is False,
           "ARTEX coverage incorrectly promoted unexamined classes as clean")
    with tempfile.TemporaryDirectory(prefix="pal-synthetic-gym-") as tmp:
        root = Path(tmp)
        task_dir = root / "task"
        result_dir = root / "result"
        task_dir.mkdir()
        result_dir.mkdir()
        (task_dir / "source.txt").write_text(QUOTE + "\n", encoding="utf-8")
        doc = {"vulnerabilities": [{"id": "owned-only",
                "evidence": [{"quote": QUOTE, "location": "source.txt"}]}],
               "refusals": []}
        write_json(result_dir / "scorer_result.json", doc)
        ensure_host_confined(result_dir, task_dir)
        insist(original.validate_one(result_dir, task_dir) == [],
               "ExploitGym actual exact-quote check fails")
        # Quote matching is only source-presence proof.
        doc["vulnerabilities"][0]["evidence"][0]["quote"] = "different fabricated claim"
        write_json(result_dir / "scorer_result.json", doc)
        ensure_host_confined(result_dir, task_dir)
        insist(bool(original.validate_one(result_dir, task_dir)),
               "ExploitGym actual source verifier accepted fabricated quote")
        # The stock validator accepts ../outside evidence; our host wrapper
        # rejects the path before the stock helper reads it.
        (root / "outside.txt").write_text("out-of-task sentinel", encoding="utf-8")
        doc["vulnerabilities"][0]["evidence"][0] = {
            "quote": "out-of-task sentinel", "location": "../outside.txt"}
        write_json(result_dir / "scorer_result.json", doc)
        stock_did_not_reject = original.validate_one(result_dir, task_dir) == []
        insist(stock_did_not_reject, "expected known upstream standalone path gap changed")
        rejected = False
        try:
            ensure_host_confined(result_dir, task_dir)
        except RuntimeError:
            rejected = True
        insist(rejected, "host must reject task path traversal")
        doc["vulnerabilities"][0]["evidence"][0] = {
            "quote": "out-of-task sentinel", "location": "linked.txt"}
        (task_dir / "linked.txt").symlink_to(root / "outside.txt")
        write_json(result_dir / "scorer_result.json", doc)
        try:
            ensure_host_confined(result_dir, task_dir)
        except RuntimeError:
            pass
        else:
            raise RuntimeError("host must reject symlink escape")
    report = {
        "schema": "pal-real-vendor-source-compatibility-v1",
        "taskId": TASK,
        "strideParsedActualSource": True,
        "artexCoverageCalculatedByActualGoModule": True,
        "exploitgymExactQuoteValidatorExecuted": True,
        "stockExploitGymPathTraversalAccepted": True,
        "hostPathTraversalAndSymlinkRejected": True,
        "sourcePresenceNotVulnerabilityProof": True,
        "artexLedger": ledger,
        "realVendorAgentExecutions": 0,
        "modelCalls": 0,
        "externalSecurityTargets": 0,
        "apexAuthorized": False,
        "productionReady": False,
        "physicalIPhoneRun": False
    }
    report_path.parent.mkdir(parents=True, exist_ok=True)
    write_json(report_path, report)
    print("Offline real-vendor-source bridge: " + json.dumps({
        "taskId": TASK,
        "actualSourceModules": ["STRIDE parser", "ARTEX Go coverage", "ExploitGym evidence"],
        "coverageGaps": kinds,
        "quoteChecks": 2,
        "pathRejectionControls": 2,
        "externalTargets": 0,
        "realVendorAgents": 0,
        "productionReady": False
    }))

def main() -> None:
    a = argparse.ArgumentParser()
    sub = a.add_subparsers(dest="operation", required=True)
    p = sub.add_parser("plan")
    p.add_argument("--stride", type=Path, required=True)
    p.add_argument("--out", type=Path, required=True)
    v = sub.add_parser("verify")
    v.add_argument("--gym", type=Path, required=True)
    v.add_argument("--coverage", type=Path, required=True)
    v.add_argument("--out", type=Path, required=True)
    args = a.parse_args()
    if args.operation == "plan":
        plan(args.stride, args.out)
    else:
        verify(args.gym, args.coverage, args.out)

if __name__ == "__main__":
    main()
