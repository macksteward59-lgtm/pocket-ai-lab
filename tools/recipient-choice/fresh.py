"""Run one model on the locked, counterbalanced synthetic card records."""
import json
import sys
import urllib.request
from pathlib import Path

from measure import CONDITIONS, digest, generate, post, statistics, write_json

FIXTURE = Path(__file__).with_name("fresh-cases.json")
CASE_SHA = "5cc33ba9f9f069e5995145afa516edc38621f3a489c5dbef0161c2d59a2b03fa"


def schedule(cases):
    for i, (card, word_a, word_b, original) in enumerate(cases):
        opposite = "B" if original == "A" else "A"
        words = {"A": word_a, "B": word_b}
        offset = i % len(CONDITIONS)
        for condition in CONDITIONS[offset:] + CONDITIONS[:offset]:
            expected = opposite if condition == "counterfactual" else original
            message = (f"The label on card {card} is {words[expected]}."
                       if condition != "absent" else f"The label on card {card} was omitted.")
            question = (f"{message}\nWhat is the label on card {card}?\n"
                        f"A: {word_a}\nB: {word_b}\nReply with just the letter A or B.")
            yield card, condition, expected, question


def run(out, model, model_sha):
    cases = FIXTURE.read_bytes()
    if digest(cases) != CASE_SHA:
        raise ValueError("fresh evaluation cases have changed")
    with urllib.request.urlopen("http://127.0.0.1:18083/props", timeout=10) as response:
        template = json.load(response)["chat_template"]
    if not isinstance(template, str) or not template:
        raise ValueError("model has no declared chat template")
    write_json(out / "preflight.json", {
        "model": model, "modelSHA256": model_sha, "dataSHA256": CASE_SHA,
        "chatTemplateSHA256": digest(template.encode()), "runtime": "b12233-linux-x86_64-cpu",
        "context": 512, "maxOutputTokens": 4, "temperature": 0, "grammar": 'root ::= "A" | "B"',
    })
    rows = []
    with (out / "trials.jsonl").open("x") as log:
        for card, condition, expected, question in schedule(json.loads(cases)):
            row = dict(caseId=card, condition=condition, expectedAnswer=expected, raw=None, stop=None,
                       answer=None, error=None, arm="constrained")
            try:
                rendered = post("apply-template", {"messages": [{"role": "user", "content": question}]})["prompt"]
                tokens = post("tokenize", {"content": rendered, "add_special": True, "parse_special": True})["tokens"]
                row.update(prompt=rendered, inputTokens=tokens)
                if question not in rendered or not 0 < len(tokens) <= 508:
                    raise ValueError("invalid rendered prompt or token length")
                generate("constrained", tokens, row)
            except (OSError, ValueError, KeyError, TypeError) as exc:
                row["error"] = str(exc)
            rows.append(row)
            log.write(json.dumps(row) + "\n")
            log.flush()
    s = statistics(rows)["constrained"]
    integrity = len(rows) == len({(r["caseId"], r["condition"]) for r in rows}) == 36 and s["errors"] == 0
    passed = (integrity and s["valid"] == 36 and s["correct"] >= 10
              and s["counterfactual"] >= 10 and s["pairedSwitch"] >= 9)
    write_json(out / "summary.json", {"model": model, "counts": s, "integrity": integrity, "passed": passed})
    table = ("| Model | Valid /36 | Original /12 | Absent /12 | Reversed /12 | Both /12 | A | B | Errors |\n"
             "|---|---:|---:|---:|---:|---:|---:|---:|---:|\n"
             f"| {model} | {s['valid']} | {s['correct']} | {s['absent']} | {s['counterfactual']} | "
             f"{s['pairedSwitch']} | {s['A']} | {s['B']} | {s['errors']} |\n\n"
             f"Measurement integrity: {integrity}. Fresh word-pair criterion: {passed}.\n")
    print(table, flush=True)
    (out / "summary.md").write_text(table)
    if not integrity:
        raise SystemExit("measurement integrity failed")


if __name__ == "__main__":
    run(Path(sys.argv[1]), sys.argv[2], sys.argv[3])
