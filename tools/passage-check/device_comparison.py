"""Compare six journal exports with the unchanged prompts and one recorded model-server run."""
import argparse
import hashlib
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "evaluation-review"))
from verify import MAX_BYTES, PASSAGE_SUITE, SHA256, unique_fields, verify


def load_json(raw):
    return json.loads(raw, object_pairs_hook=unique_fields)


def compare_device(exports, hashes, server_bytes, server_hash):
    if hashlib.sha256(server_bytes).hexdigest() != server_hash:
        raise ValueError("Server report does not match its separate digest")
    server = load_json(server_bytes)
    suite_bytes = PASSAGE_SUITE.read_bytes()
    suite = load_json(suite_bytes)
    cases = {case["id"]: case for case in suite["cases"]}
    if (server["suiteSHA256"] != hashlib.sha256(suite_bytes).hexdigest()
            or server["suiteID"] != suite["suiteID"] or server["suiteVersion"] != suite["version"]
            or server.get("generationFormat", "unrestricted") != "unrestricted"):
        raise ValueError("Use the unrestricted server run for the same frozen suite")
    if set(hashes) != cases.keys() or len(exports) != len(cases):
        raise ValueError("Provide one separate event digest and export per frozen case")
    if not SHA256.fullmatch(server["modelSHA256"]):
        raise ValueError("Invalid server model digest")
    server_rows = server["cases"]
    if ([row["caseID"] for row in server_rows] != list(cases)
            or any(not row.get("requestID") or not isinstance(row.get("output"), str) for row in server_rows)
            or len({row["requestID"] for row in server_rows}) != len(cases)):
        raise ValueError("Incomplete server run")
    native_rows = {}
    session_ids, request_ids = set(), set()
    for raw in exports:
        payload = load_json(load_json(raw)["payloadJSON"])
        attempt = payload["attempt"]
        key = attempt["caseID"]
        if key not in cases or key in native_rows:
            raise ValueError("Unknown or duplicate native case")
        grade = verify(raw, hashes[key], passage_case=key)["passageCheck"]
        if attempt["modelArtifactSHA256"] != server["modelSHA256"]:
            raise ValueError("Device and server report different model artifacts")
        if not attempt["runtimeSessionID"] or not attempt["requestID"] or attempt["requestID"] in request_ids:
            raise ValueError("Missing session or duplicate native request")
        request_ids.add(attempt["requestID"])
        session_ids.add(attempt["runtimeSessionID"])
        native = attempt["providerKind"] == "llamaCppBackend" and attempt["nativeExecutionObserved"] is True
        native_rows[key] = dict(eventSHA256=hashes[key], nativeExecutionReported=native,
                                nativeOutput=grade["recordedOutput"], nativeComplete=grade["complete"],
                                nativePassed=grade["passed"] and native)
    if len(session_ids) != 1:
        raise ValueError("Exports came from different model sessions")
    results = []
    for row in server_rows:
        key = row["caseID"]
        case = cases[key]
        if row["promptSHA256"] != hashlib.sha256(case["prompt"].encode()).hexdigest():
            raise ValueError("Server prompt differs from the frozen case")
        passed = row["output"] == case["expected"] and row.get("finishReason") == "stop"
        results.append(dict(caseID=key, expected=case["expected"], serverOutput=row["output"],
                            serverPassed=passed, **native_rows[key]))
    return dict(suite=suite["suiteID"], modelSHA256=server["modelSHA256"], serverSHA256=server_hash,
                nativeSession=next(iter(session_ids)), cases=results, total=len(results),
                nativePassed=sum(row["nativePassed"] for row in results),
                serverPassed=sum(row["serverPassed"] for row in results), hardwareVerified=False)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--exports", required=True, type=Path, help="Directory with just the six exported JSON files")
    parser.add_argument("--digests", required=True, type=Path, help="Separate JSON object mapping case ID to event digest")
    parser.add_argument("--server", required=True, type=Path)
    parser.add_argument("--server-sha256", required=True)
    args = parser.parse_args()
    try:
        exports = []
        for file in args.exports.glob("*.json"):
            if len(exports) >= 6 or file.stat().st_size > MAX_BYTES:
                raise ValueError("Unexpected number or size of exports")
            exports.append(file.read_bytes())
        result = compare_device(exports, load_json(args.digests.read_bytes()), args.server.read_bytes(), args.server_sha256)
        print(json.dumps(result, ensure_ascii=False, indent=2))
    except (OSError, KeyError, TypeError, ValueError) as error:
        parser.exit(1, f"Comparison failed: {error}\n")
