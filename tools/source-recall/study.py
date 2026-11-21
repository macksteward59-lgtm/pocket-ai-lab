"""Read a fixed pair of project documentation excerpts with the pinned local Qwen model."""
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "recipient-choice"))
from measure import digest, post, write_json

SOURCE_SHA = "9cf4acff35b106767f049de9814a9cc660796515d530d58622efabefd2b996c7"
CASE_SHA = "2da95502379f678d85d9a96cd6dd13587adb408e6d61d24eeb400a89aebd2083"
CODES = ("A1", "A2", "B1", "B2", "U")


def checked(path, expected):
    data = path.read_bytes()
    if digest(data) != expected:
        raise ValueError(f"source bytes changed: {path.name}")
    return json.loads(data)


def cases_with_sources(cases):
    for index, case in enumerate(cases):
        conditions = ("present", "withheld") if index % 2 == 0 else ("withheld", "present")
        for condition in conditions:
            selected = [case["other"]]
            selected.insert(case["slot"] - 1, case["support"] if condition == "present" else case["replacement"])
            expected = case["answer"] + str(case["slot"]) if condition == "present" else "U"
            yield case, condition, selected, expected


def read_pair(question, sources, row):
    a, b = question["options"]
    prompt = (
        "Use only the two excerpts below. If neither directly answers the question, reply U, even if "
        "you know an answer from elsewhere. Otherwise give the correct option and the number of the "
        "excerpt supporting it. Valid replies are A1, A2, B1, B2 or U.\n\n"
        f"Excerpt 1: {sources[row['sources'][0]]}\nExcerpt 2: {sources[row['sources'][1]]}\n\n"
        f"Question: {question['question']}\nA: {a}\nB: {b}"
    )
    row["prompt"] = post("apply-template", {"messages": [{"role": "user", "content": prompt}]})["prompt"]
    if prompt not in row["prompt"]:
        raise ValueError("missing rendered prompt")
    tokens = post("tokenize", {"content": row["prompt"], "add_special": True, "parse_special": True})["tokens"]
    if not 0 < len(tokens) <= 508:
        raise ValueError("prompt length outside declared range")
    result = post("completion", {"prompt": tokens, "n_predict": 4, "temperature": 0, "cache_prompt": False,
                                 "stream": False, "grammar": 'root ::= "A1" | "A2" | "B1" | "B2" | "U"'})
    row.update(raw=result["content"], stopReason=result["stop_type"], promptTokens=len(tokens))
    if (result["stop"] is not True or result["truncated"] is not False or row["stopReason"] not in ("eos", "limit")
            or result["tokens_evaluated"] != len(tokens) or not 0 <= result["tokens_predicted"] <= 4):
        raise ValueError("incomplete inference")
    code = row["raw"].strip(" \t\n\r")
    if code in CODES:
        row["code"] = code


def score(rows):
    present = [r for r in rows if r["condition"] == "present"]
    withheld = [r for r in rows if r["condition"] == "withheld"]
    cited = {r["case"] for r in present if r["code"] == r["expected"]}
    abstained = {r["case"] for r in withheld if r["code"] == "U"}
    return {
        "complete": sum(r["error"] is None and r["code"] in CODES for r in rows),
        "correctOption": sum(r["code"] is not None and r["code"][0] == r["expected"][0] for r in present),
        "correctWithCitation": len(cited), "correctAbstention": len(abstained),
        "unsupportedAnswers": sum(r["code"] in CODES[:4] for r in withheld),
        "bothConditions": len(cited & abstained),
    }


def main(register, out):
    entries = checked(register, SOURCE_SHA)["sources"]
    sources = {s["id"]: s["finding"] for s in entries}
    cases = checked(Path(__file__).with_name("questions.json"), CASE_SHA)
    rows = []
    with (out / "trials.jsonl").open("x") as log:
        for case, condition, selected, expected in cases_with_sources(cases):
            row = dict(case=case["id"], condition=condition, sources=selected, expected=expected,
                       raw=None, code=None, error=None)
            try:
                read_pair(case, sources, row)
            except (OSError, ValueError, KeyError, TypeError) as exc:
                row["error"] = str(exc)
            log.write(json.dumps(row) + "\n")
            log.flush()
            rows.append(row)
    counts = score(rows)
    complete = counts["complete"] == 12 and len({(r["case"], r["condition"]) for r in rows}) == 12
    passed = complete and all(counts[k] >= 5 for k in ("correctWithCitation", "correctAbstention", "bothConditions"))
    write_json(out / "summary.json", dict(counts=counts, passed=passed, sourceSHA256=SOURCE_SHA,
               caseSHA256=CASE_SHA, runtime="llama.cpp b12233 Linux CPU", model="Qwen2.5-1.5B-Instruct Q4_K_M",
               modelSHA256="6a1a2eb6d15622bf3c96857206351ba97e1af16c30d7a74ee38970e434e9407e"))
    report = (f"Valid responses {counts['complete']}/12. Correct option {counts['correctOption']}/6. "
              f"Correct with citation {counts['correctWithCitation']}/6. Correct abstention {counts['correctAbstention']}/6. "
              f"Unsupported answers {counts['unsupportedAnswers']}/6. Both conditions {counts['bothConditions']}/6. "
              f"Development threshold met: {passed}.\n")
    print(report)
    (out / "summary.md").write_text(report)
    if not complete:
        raise SystemExit("incomplete measurement")


if __name__ == "__main__":
    main(Path(sys.argv[1]), Path(sys.argv[2]))
