"""Review a Pocket AI Lab source check against its separately copied SHA-256 and the hosted reference."""
import argparse
import hashlib
import json
from pathlib import Path
from uuid import UUID

from verify import MAX_BYTES, PASSAGE_SUITE, SHA256, unique_fields, verify

FORMAT = "pocket-ai-lab.source-run.v1"
REFERENCE = Path(__file__).with_name("hosted-passage-reference.json")
REFERENCE_SHA256 = "22303c00da9a96e0a25872bfb2ef9c85839d2e7706c629fc9df21cedeceb861b"
MAX_RUN_BYTES = 24 * 1024 * 1024


def review_run(raw, expected_digest):
    if len(raw) > MAX_RUN_BYTES or not SHA256.fullmatch(expected_digest):
        raise ValueError("Invalid file size or expected run SHA-256")
    packet = json.loads(raw, object_pairs_hook=unique_fields)
    run_id = packet["runID"]
    if packet["format"] != FORMAT or str(UUID(run_id)).upper() != run_id:
        raise ValueError("Unknown source-run format or identity")
    suite_bytes = PASSAGE_SUITE.read_bytes()
    suite = json.loads(suite_bytes)
    events = packet["events"]
    if not isinstance(events, list) or not 1 <= len(events) <= len(suite["cases"]):
        raise ValueError("Unexpected number of cases")
    hashes = [event["eventHash"] for event in events]
    if any(not isinstance(h, str) or not SHA256.fullmatch(h) for h in hashes):
        raise ValueError("Invalid event digest")
    digest = hashlib.sha256("\n".join([FORMAT, run_id, *hashes]).encode()).hexdigest()
    if digest != expected_digest or digest != packet["runSHA256"]:
        raise ValueError("Run differs from the separately copied SHA-256")

    reference_bytes = REFERENCE.read_bytes()
    if hashlib.sha256(reference_bytes).hexdigest() != REFERENCE_SHA256:
        raise ValueError("Hosted reference differs from the pinned report")
    reference = json.loads(reference_bytes)
    if reference["suiteSHA256"] != hashlib.sha256(suite_bytes).hexdigest():
        raise ValueError("Suite differs from the hosted reference")
    ref_cases = {row["caseID"]: row for row in reference["cases"]}

    rows = []
    sessions, models, environments, requests = set(), set(), set(), set()
    last_sequence = 0
    for case, event in zip(suite["cases"], events):
        # The Swift packet contains the original hashed payload as a JSON string.
        data = json.dumps(event, ensure_ascii=False, separators=(",", ":")).encode()
        checked = verify(data, event["eventHash"], passage_case=case["id"])
        attempt = json.loads(event["payloadJSON"])["attempt"]
        if (attempt.get("sourceRunID") != run_id or not attempt.get("runtimeSessionID")
                or not SHA256.fullmatch(attempt["modelArtifactSHA256"])
                or not attempt.get("requestID") or attempt["requestID"] in requests
                or checked["sequence"] <= last_sequence):
            raise ValueError("Mixed, repeated or unordered source-run events")
        last_sequence = checked["sequence"]
        requests.add(attempt["requestID"])
        sessions.add(attempt["runtimeSessionID"])
        models.add(attempt["modelArtifactSHA256"])
        resources = checked.get("resourceSamples")
        if resources:
            environments.add((resources["environment"], resources["osVersion"]))
        grade = checked["passageCheck"]
        is_native = (attempt.get("providerKind") == "llamaCppBackend"
                     and attempt.get("nativeExecutionObserved") is True and grade["complete"])
        ref = ref_cases[case["id"]]
        rows.append(dict(caseID=case["id"], expected=case["expected"], recordedOutput=grade["recordedOutput"],
                         generationCompleted=grade["complete"], answerMatches=grade["passed"],
                         nativeGenerationReported=is_native,
                         resourceSamples=resources, hostedOutput=ref["output"], hostedPassed=ref["passed"]))
    if len(sessions) != 1 or len(models) != 1 or len(environments) > 1:
        raise ValueError("Mixed sessions, model artifacts or runtime environments")
    observed = [row["resourceSamples"] for row in rows if row["resourceSamples"]]
    footprints = [s["maxObservedFootprintBytes"] for s in observed if s.get("maxObservedFootprintBytes") is not None]
    headroom = [s["minObservedHeadroomBytes"] for s in observed if s.get("minObservedHeadroomBytes") is not None]
    levels = ("nominal", "fair", "serious", "critical")
    thermal = [s["worstObservedThermalState"] for s in observed if s.get("worstObservedThermalState") is not None]
    # A full journal can contain cancelled or failed cases. The CLI exit check
    # indicates case-set coverage only; it is not a generation or quality gate.
    return dict(runID=run_id, runSHA256=digest, modelSHA256=next(iter(models)), session=next(iter(sessions)),
                recordedCases=len(rows), expectedCases=len(suite["cases"]), completeCaseSet=len(rows) == len(suite["cases"]),
                completedGenerations=sum(r["generationCompleted"] for r in rows),
                casesWithResourceSamples=len(observed), reportedNativeGenerations=sum(r["nativeGenerationReported"] for r in rows),
                exactNativeAnswers=sum(r["nativeGenerationReported"] and r["answerMatches"] for r in rows),
                maxObservedFootprintBytes=max(footprints, default=None), minObservedHeadroomBytes=min(headroom, default=None),
                worstObservedThermalState=max(thermal, key=levels.index, default=None),
                sameModelAsHostedReference=next(iter(models)) == reference["modelSHA256"],
                hostedExactAnswers=reference["passed"], hostedCases=reference["total"], hardwareVerified=False, cases=rows)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("file", type=Path)
    parser.add_argument("--expected-run-hash", required=True)
    args = parser.parse_args()
    try:
        with args.file.open("rb") as stream:
            report = review_run(stream.read(MAX_RUN_BYTES + 1), args.expected_run_hash)
        print(json.dumps(report, ensure_ascii=False, indent=2))
        if not report["completeCaseSet"]:
            parser.exit(1, "This verified source run has only part of the case set.\n")
    except (OSError, KeyError, ValueError, TypeError, RecursionError) as error:
        parser.exit(1, f"Review failed: {error}\n")
