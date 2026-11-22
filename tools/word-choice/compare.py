"""Compare two decoders using only the frozen cedar/maple questions on loopback."""
import argparse
from collections import Counter
from hashlib import sha256
import json
from pathlib import Path
import sys
from urllib.error import URLError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[2]
IOS = ROOT / "runtime/ios"
sys.path.insert(0, str(IOS / "scripts"))
from recipient_format_calibration import MANIFEST_SHA256, load_manifest, parse_answer

MANIFEST = IOS / "Tests/LlamaEngineTests/Fixtures/recipient-format-calibration-v1.json"
URL = "http://127.0.0.1:18081"
MODES = ("plain", "letters")
MODELS = ("smollm2-135m-instruct-q4_k_m", "qwen2.5-0.5b-instruct-q4_k_m")


def trials():
    manifest, _ = load_manifest(MANIFEST)
    for row in manifest["trials"]:
        if row["format"] == "raw":
            # Balance which decoder sees each question first.
            order = MODES if row["sourceTrialOrdinal"] % 2 else reversed(MODES)
            for mode in order:
                yield row, mode


def complete(prompt, mode):
    body = {"prompt": prompt, "temperature": 0, "n_predict": 4, "cache_prompt": False,
            "stream": False, "seed": 1}
    if mode == "letters":
        body["grammar"] = 'root ::= "A" | "B"'
    elif mode == "letters_or_unknown":
        body["grammar"] = 'root ::= "A" | "B" | "U"'
    elif mode != "plain":
        raise ValueError("Unknown word-choice decoder")
    request = Request(URL + "/completion", json.dumps(body).encode(),
                      {"Content-Type": "application/json"})
    with urlopen(request, timeout=15) as response:
        reply = json.load(response)
    text, tokens = reply["content"], reply["tokens_predicted"]
    if not isinstance(text, str) or len(text.encode()) > 128 or type(tokens) is not int or not 0 <= tokens <= 4:
        raise ValueError("Unexpected completion text or token count")
    return {"raw": text, "tokens": tokens, "stopType": reply.get("stop_type")}


def measure(model, dest):
    catalog = json.loads((ROOT / "scripts/local-gguf/pins.json").read_bytes())
    pin = next(p for p in catalog["models"] if p["id"] == model)
    with urlopen(URL + "/v1/models", timeout=5) as response:
        models = [item["id"] for item in json.load(response)["data"]]
    if models != [model]:
        raise ValueError("The server did not report the selected model")
    dest.mkdir(parents=True, exist_ok=True)
    with (dest / (model + ".jsonl")).open("x", encoding="utf-8") as output:
        for row, mode in trials():
            record = {"model": model, "modelSHA256": pin["sha256"], "manifestSHA256": MANIFEST_SHA256,
                      "case": row["caseId"], "condition": row["condition"], "mode": mode,
                      "promptSHA256": row["promptSHA256"]}
            try:
                record.update(complete(row["prompt"], mode))
            except (URLError, TimeoutError, ValueError, KeyError, OSError) as error:
                record["error"] = str(error)
            print(json.dumps(record, ensure_ascii=False), file=output, flush=True)


def grade(model, dest):
    records = [json.loads(line) for line in (dest / (model + ".jsonl")).read_text().splitlines()]
    schedule = list(trials())
    if len(records) != len(schedule):
        raise ValueError(f"Expected {len(schedule)} records for {model}, got {len(records)}")
    catalog = json.loads((ROOT / "scripts/local-gguf/pins.json").read_bytes())
    model_digest = next(p["sha256"] for p in catalog["models"] if p["id"] == model)
    totals = {mode: Counter() for mode in MODES}
    correct_pairs = {mode: Counter() for mode in MODES}
    for record, (row, mode) in zip(records, schedule):
        identity = (record["model"], record["mode"], record["case"], record["condition"], record["promptSHA256"])
        if identity != (model, mode, row["caseId"], row["condition"], sha256(row["prompt"].encode()).hexdigest()):
            raise ValueError("Response identity disagrees with the frozen schedule")
        if record["modelSHA256"] != model_digest or record["manifestSHA256"] != MANIFEST_SHA256:
            raise ValueError("Response provenance disagrees with the frozen inputs")
        counts = totals[mode]
        counts["attempts"] += 1
        if "error" in record:
            counts["errors"] += 1
            continue
        parsed = parse_answer(record["raw"])
        counts["tokens"] += record["tokens"]
        counts["empty"] += not record["raw"].strip(" \t\r\n")
        counts["valid"] += parsed is not None
        counts["letterA"] += parsed == "A"
        counts["letterB"] += parsed == "B"
        if parsed == row["expectedAnswer"]:
            counts[row["condition"]] += 1
            if row["condition"] in ("correct", "counterfactual"):
                correct_pairs[mode][row["caseId"]] += 1

    summaries = {}
    for mode, counts in totals.items():
        result = {k: counts[k] for k in ("attempts", "errors", "tokens", "empty", "valid",
                                          "letterA", "letterB", "correct", "counterfactual", "absent")}
        result["pairsFollowed"] = sum(n == 2 for n in correct_pairs[mode].values())
        result["formatPassed"] = result["valid"] == 36
        result["factPairsPassed"] = result["pairsFollowed"] == 12
        summaries[mode] = result
    return summaries


if __name__ == "__main__":
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument("action", choices=["measure", "grade"])
    cli.add_argument("dest", type=Path)
    cli.add_argument("--model", choices=MODELS)
    args = cli.parse_args()
    if args.action == "measure":
        if not args.model:
            cli.error("measure requires --model")
        measure(args.model, args.dest)
    else:
        results = {m: grade(m, args.dest) for m in MODELS}
        report = json.dumps(results, indent=2)
        print(report)
        (args.dest / "summary.json").write_text(report + "\n")
        complete_runs = all(not x["errors"] for modes in results.values() for x in modes.values())
        any_candidate_passed = any(m["letters"]["formatPassed"] and m["letters"]["factPairsPassed"]
                                   for m in results.values())
        if not complete_runs or not any_candidate_passed:
            sys.exit("The frozen criteria were not met. See the recorded responses.")
