"""Compare two decoders on the predeclared, fixed synthetic recall cases."""
import hashlib
import json
import sys
import urllib.error
import urllib.request
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
IOS = ROOT / "runtime/ios"
sys.path.insert(0, str(IOS / "scripts"))
from recipient_format_calibration import CONDITIONS, MANIFEST_SHA256, MODEL_SHA256, parse_answer

FIXTURE = IOS / "Tests/LlamaEngineTests/Fixtures/recipient-format-calibration-v1.json"
# SHA-256 of the 36 ordered chat token-ID arrays in native tokenizer run 44777249548,
# serialized as a compact JSON array of arrays.
TOKEN_SHA = "6af2bc1022b200e2fd8a94efa3293287da1b28bc544e0990a3e256803e2e0b83"
ARMS = ("control", "constrained")


def digest(data):
    return hashlib.sha256(data).hexdigest()


def post(path, payload):
    request = urllib.request.Request("http://127.0.0.1:18083/" + path,
                                     data=json.dumps(payload).encode(),
                                     headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(request, timeout=25) as response:
        return json.load(response)


def write_json(path, data):
    path.write_text(json.dumps(data, indent=2, sort_keys=True) + "\n")


def preflight(out):
    source = FIXTURE.read_bytes()
    if digest(source) != MANIFEST_SHA256:
        raise ValueError("frozen fixture checksum mismatch")
    trials = [r for r in json.loads(source)["trials"] if r["format"] == "chat"]
    tokens = [post("tokenize", {"content": r["prompt"], "parse_special": True,
                                "add_special": True})["tokens"] for r in trials]
    actual_sha = digest(json.dumps(tokens, separators=(",", ":")).encode())
    if actual_sha != TOKEN_SHA or len(trials) != 36:
        raise ValueError("token streams differ from archived native run")
    write_json(out / "preflight.json", {
        "manifestSHA256": MANIFEST_SHA256, "modelSHA256": MODEL_SHA256,
        "nativeTokenArraysSHA256": actual_sha, "runtime": "b12233-linux-x86_64-cpu",
        "contextLength": 512, "maxTokens": 4, "temperature": 0, "promptCaching": False,
        "promptTokenCounts": [len(t) for t in tokens],
    })
    return zip(trials, tokens)


def generate(arm, tokens, row):
    payload = {"prompt": tokens, "temperature": 0, "n_predict": 4,
               "cache_prompt": False, "stream": False}
    if arm == "constrained":
        payload["grammar"] = 'root ::= "A" | "B"'
    try:
        result = post("completion", payload)
        row.update(raw=result["content"], stop=result["stop_type"],
                   tokensEvaluated=result["tokens_evaluated"],
                   tokensPredicted=result["tokens_predicted"])
        if (not isinstance(row["raw"], str) or result["stop"] is not True
                or result["truncated"] is not False or row["tokensEvaluated"] != len(tokens)
                or row["stop"] not in ("limit", "eos") or not 0 <= row["tokensPredicted"] <= 4):
            raise ValueError("incomplete, truncated or inconsistent inference")
        row["answer"] = parse_answer(row["raw"])
    except (OSError, ValueError, KeyError, TypeError) as exc:
        row["error"] = str(exc)


def statistics(rows):
    scores = {}
    for arm in ARMS:
        group = [r for r in rows if r["arm"] == arm]
        right = {(r["caseId"], r["condition"]) for r in group
                 if r["answer"] == r["expectedAnswer"] and r["error"] is None}
        counts = Counter(r["answer"] for r in group if r["error"] is None)
        scores[arm] = {
            "valid": counts["A"] + counts["B"], "A": counts["A"], "B": counts["B"],
            "errors": sum(r["error"] is not None for r in group),
            **{c: sum(condition == c for _, condition in right) for c in CONDITIONS},
            "pairedSwitch": sum(condition == "correct" and (case, "counterfactual") in right
                                for case, condition in right),
        }
    return scores


def main(out):
    rows = []
    with (out / "trials.jsonl").open("x") as log:
        for trial, tokens in preflight(out):
            order = ARMS if trial["sourceTrialOrdinal"] % 2 else reversed(ARMS)
            for arm in order:
                row = {k: trial[k] for k in ("caseId", "condition", "expectedAnswer", "promptSHA256")}
                row.update(arm=arm, answer=None, raw=None, error=None, stop=None)
                generate(arm, tokens, row)
                rows.append(row)
                log.write(json.dumps(row) + "\n")
                log.flush()
    scores = statistics(rows)
    c = scores["constrained"]
    keys = {(r["caseId"], r["condition"], r["arm"]) for r in rows}
    integrity = len(keys) == len(rows) == 72 and all(s["errors"] == 0 for s in scores.values())
    format_pass = integrity and c["valid"] == 36
    quality = (format_pass and c["correct"] >= 10 and c["counterfactual"] >= 10
               and c["pairedSwitch"] >= 9 and c["pairedSwitch"] > scores["control"]["pairedSwitch"])
    write_json(out / "summary.json", {"scheduled": 72, "attempted": len(rows), "arms": scores,
                                      "integrity": integrity, "constrainedFormat": format_pass,
                                      "developmentQuality": quality})
    lines = ["| Decoder | Valid /36 | Original /12 | Absent /12 | Reversed /12 | Both messages /12 | A | B | Errors |",
             "|---|---:|---:|---:|---:|---:|---:|---:|---:|"]
    for arm, s in scores.items():
        lines.append(f"| {arm} | {s['valid']} | {s['correct']} | {s['absent']} | {s['counterfactual']} | {s['pairedSwitch']} | {s['A']} | {s['B']} | {s['errors']} |")
    lines += ["", f"Measurement integrity: {integrity}. Format criterion: {format_pass}. Development quality criterion: {quality}."]
    report = "\n".join(lines) + "\n"
    (out / "summary.md").write_text(report)
    print(report, flush=True)
    if not integrity:
        raise SystemExit("measurement integrity failed")


if __name__ == "__main__":
    main(Path(sys.argv[1]))
