"""Compare the quote proposal and the opt-in assessment on the same model replies."""
import argparse
import hashlib
import json
from pathlib import Path

from answer import HERE, MODEL, answer, assess_support, local_server, retrieve, verify_model


def passes(case, reply):
    if not case["requires"]:
        return (reply["answer"] == "UNKNOWN" and reply["source"] is None and
                reply["status"] in ("abstained", "insufficient_evidence"))
    return (reply["status"] == "quote_proposed" and reply["source"] == case["sourceID"] and
            all(phrase.casefold() in reply["answer"].casefold() for phrase in case["requires"]))


def run(gguf, binary, fixture_path):
    fixture = fixture_path.read_bytes()
    cases = json.loads(fixture)
    model_sha = verify_model(gguf, MODEL)
    rows = []
    with local_server(gguf, binary.resolve(strict=True), MODEL) as connection:
        for case in cases:
            record = retrieve(case["question"], case["sourceID"])
            if [item["id"] for item in record["sources"]] != [case["sourceID"]]:
                raise ValueError(f"Selected source did not reach inference for {case['id']}")
            proposal = answer(case["question"], connection, MODEL, record=record)
            checked = assess_support(proposal, connection)
            rows.append(dict(id=case["id"], proposal=proposal,
                             assessment=checked.get("supportAssessment"), status=checked["status"],
                             answer=checked["answer"], source=checked["source"],
                             baselinePassed=passes(case, proposal), assessedPassed=passes(case, checked)))
    counts = {}
    for group, wants_fact in (("answerable", True), ("unanswerable", False)):
        subset = [row for case, row in zip(cases, rows) if bool(case["requires"]) == wants_fact]
        counts[group] = dict(total=len(subset), baseline=sum(r["baselinePassed"] for r in subset),
                             assessed=sum(r["assessedPassed"] for r in subset))
    return dict(fixtureSHA256=hashlib.sha256(fixture).hexdigest(), model=MODEL, modelSHA256=model_sha,
                counts=counts, allAssessedPassed=all(r["assessedPassed"] for r in rows), rows=rows)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--gguf", type=Path, required=True)
    parser.add_argument("--llama-server", type=Path, required=True)
    parser.add_argument("--fixture", choices=["original", "transfer"], default="original")
    args = parser.parse_args()
    name = "support-cases.json" if args.fixture == "original" else "support-transfer-cases.json"
    print(json.dumps(run(args.gguf, args.llama_server, HERE / name), ensure_ascii=False, indent=2))
