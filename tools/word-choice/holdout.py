"""Held-out evaluation of two words in a notebook, including missing and unrelated notes."""
import argparse
from collections import Counter
from hashlib import sha256
import json
from pathlib import Path
import re
from urllib.error import URLError
from urllib.request import urlopen

from compare import complete, parse_answer, URL

WORDS = (("iris", "lily"), ("brass", "tin"), ("pear", "plum"), ("moss", "fern"),
         ("oak", "pine"), ("brick", "stone"), ("linen", "silk"), ("wren", "lark"),
         ("violet", "rose"), ("salt", "sugar"), ("amber", "jade"), ("flute", "drum"))
POLICIES = ("two", "three", "source_checked")
CONDITIONS = ("given", "flipped", "missing", "unrelated")
MODEL = "qwen2.5-0.5b-instruct-q4_k_m"


def build_cases(seed):
    if not re.fullmatch(r"[0-9a-f]{32}", seed):
        raise ValueError("Expected a 128-bit hexadecimal seed")

    def key(label):
        return sha256(f"notebook-words-v1:{seed}:{label}".encode()).hexdigest()

    indexes = range(len(WORDS))
    a_first = set(sorted(indexes, key=lambda i: key(f"answer:{i}"))[:6])
    swap_options = set(sorted(indexes, key=lambda i: key(f"options:{i}"))[:6])
    cases = []
    for i, words in enumerate(WORDS):
        options = words[::-1] if i in swap_options else words
        target = "NOTE-" + key(f"id:{i}")[:12].upper()
        other = "NOTE-" + key(f"unrelated-id:{i}")[:12].upper()
        for condition in CONDITIONS:
            first = 0 if i in a_first else 1
            index = 1 - first if condition == "flipped" else first
            source = other if condition == "unrelated" else target
            notes = {} if condition == "missing" else {source: options[index]}
            cases.append({"id": f"{i:02}-{condition}", "pair": i, "condition": condition,
                          "target": target, "options": list(options), "notes": notes,
                          "expected": ("A", "B")[index] if source == target and notes else "U"})
    return sorted(cases, key=lambda case: key("order:" + case["id"]))


def question(case, notes, allow_unknown):
    target = case["target"]
    message = " ".join(f"The stored word for {doc} is {word}." for doc, word in notes.items())
    if not message:
        message = f"No stored word is supplied for {target}."
    a, b = case["options"]
    instruction = "Reply with exactly A or B."
    if allow_unknown:
        instruction = "U: unknown. Use U if the message does not supply the word for this note. Reply with exactly A, B or U."
    return (f"Read the message and answer the question.\nMessage: {message}\n"
            f"Question: Which word is stored for {target}?\nA: {a}\nB: {b}\n{instruction}\nAnswer:")


def decide(case, policy):
    # The lookup sees only the document ID requested and records actually supplied.
    notes = case["notes"]
    if policy == "source_checked":
        target = case["target"]
        if target not in notes:
            return {"origin": "lookup", "raw": "U", "tokens": 0, "promptSHA256": None}
        notes = {target: notes[target]}
    prompt = question(case, notes, policy == "three")
    record = {"origin": "model", "promptSHA256": sha256(prompt.encode()).hexdigest()}
    try:
        record.update(complete(prompt, "letters_or_unknown" if policy == "three" else "letters"))
    except (URLError, TimeoutError, ValueError, KeyError, OSError) as error:
        record["error"] = str(error)
    return record


def strict_choice(text):
    if text.encode().strip(b" \t\r\n") == b"U":
        return "U"
    return parse_answer(text)


def score(cases, rows):
    expected = {(case["id"], p): case for case in cases for p in POLICIES}
    counts = {p: Counter() for p in POLICIES}
    pairs = {p: Counter() for p in POLICIES}
    for row in rows:
        case = expected.pop((row["case"], row["policy"]))
        policy = row["policy"]
        lookup_miss = policy == "source_checked" and case["target"] not in case["notes"]
        origin = "lookup" if lookup_miss else "model"
        if row["origin"] != origin:
            raise ValueError("Decision origin disagrees with supplied source records")
        if lookup_miss:
            if (row["raw"], row["tokens"], row["promptSHA256"]) != ("U", 0, None):
                raise ValueError("Invalid empty-lookup record")
        else:
            prompt = question(case, case["notes"], policy == "three")
            if row["promptSHA256"] != sha256(prompt.encode()).hexdigest():
                raise ValueError("Prompt digest disagrees with the notebook")
        totals = counts[policy]
        totals["attempts"] += 1
        totals["modelCalls"] += row["origin"] == "model"
        if "error" in row:
            totals["errors"] += 1
            continue
        answer = strict_choice(row["raw"]) if policy == "three" or lookup_miss else parse_answer(row["raw"])
        totals["valid"] += answer is not None
        totals["tokens"] += row["tokens"]
        if answer == case["expected"]:
            condition = case["condition"]
            totals[condition] += 1
            if condition in ("given", "flipped"):
                pairs[policy][case["pair"]] += 1
    if expected:
        raise ValueError("Missing case or policy in recorded responses")
    summaries = {}
    for policy, c in counts.items():
        out = {key: c[key] for key in ("attempts", "modelCalls", "errors", "valid", "tokens", *CONDITIONS)}
        out["pairsFollowed"] = sum(v == 2 for v in pairs[policy].values())
        out["passedAll48"] = sum(out[k] for k in CONDITIONS) == 48 and out["errors"] == 0
        summaries[policy] = out
    return summaries


def run(seed, dest):
    cases = build_cases(seed)
    dest.mkdir(exist_ok=True, parents=True)
    (dest / "cases.json").write_text(json.dumps({"seed": seed, "cases": cases}, indent=2) + "\n")
    with urlopen(URL + "/v1/models", timeout=5) as response:
        if [r["id"] for r in json.load(response)["data"]] != [MODEL]:
            raise ValueError("Unexpected loaded model")
    rows = []
    with (dest / "answers.jsonl").open("x") as out:
        for i, case in enumerate(cases):
            observed = {k: case[k] for k in ("target", "notes", "options")}
            for policy in POLICIES[i % 3:] + POLICIES[:i % 3]:
                row = {"case": case["id"], "policy": policy, **decide(observed, policy)}
                rows.append(row)
                print(json.dumps(row), file=out, flush=True)
    summary = score(cases, rows)
    result = json.dumps(summary, indent=2)
    print(result)
    (dest / "summary.json").write_text(result + "\n")
    if any(p["errors"] for p in summary.values()) or not summary["source_checked"]["passedAll48"]:
        raise SystemExit("The source-checked notebook did not meet its frozen 48/48 criterion.")


if __name__ == "__main__":
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument("seed")
    cli.add_argument("destination", type=Path)
    args = cli.parse_args()
    run(args.seed, args.destination)
