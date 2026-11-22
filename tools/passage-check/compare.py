"""Compare raw and citation-format decoding on the pinned questions and two frozen comparison sets."""
import argparse
import json
import re
from pathlib import Path

from server import MODEL, MODEL_PINS, SUITE, run

HERE = Path(__file__).resolve().parent


def contains_cited_value(row):
    value, label = row["expected"].rsplit(" ", 1)
    quote = re.escape(value)
    return (row.get("finishReason") == "stop" and row["output"].endswith(" " + label)
            and re.search(r"(?<![\w,])" + quote + r"(?![\w,])", row["output"]) is not None)


def compare(gguf, executable, destination, model_id=MODEL):
    grammar = (HERE / "citation.gbnf").read_text(encoding="utf-8")
    destination.mkdir(parents=True, exist_ok=False)
    scores = []
    all_requests = set()
    for path in (SUITE, HERE / "HeldOut.json", HERE / "Transfer.json"):
        suite = json.loads(path.read_bytes())
        case_ids = [case["id"] for case in suite["cases"]]
        for mode in ("unrestricted", "citation-grammar", "quoted-span"):
            report = destination / f"{suite['suiteID']}-{mode}.json"
            observed = run(gguf, executable, report, suite_path=path,
                           grammar=grammar if mode == "citation-grammar" else None,
                           extractive=mode == "quoted-span", model_id=model_id)
            rows = observed["cases"]
            if [row["caseID"] for row in rows] != case_ids:
                raise ValueError(f"Incomplete case list in {report.name}")
            for row in rows:
                request = row.get("requestID")
                if not request or request in all_requests or not isinstance(row.get("output"), str):
                    raise ValueError(f"Missing or duplicate server reply in {report.name}: {row['caseID']}")
                all_requests.add(request)
            supported = [row for row in rows if row["expected"] != "UNKNOWN"]
            absent = [row for row in rows if row["expected"] == "UNKNOWN"]
            scores.append(dict(suite=suite["suiteID"], mode=mode, passed=observed["passed"],
                               total=len(rows), supported=len(supported),
                               supportedOutputsContainingExpectedValueAndEndingInCorrectLabel=sum(
                                   contains_cited_value(row) for row in supported),
                               absent=len(absent), exactAbstentions=sum(row["passed"] for row in absent),
                               report=report.name))
    (destination / "comparison.json").write_text(json.dumps(scores, indent=2) + "\n", encoding="utf-8")
    return scores


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--gguf", type=Path, required=True)
    parser.add_argument("--llama-server", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--model", choices=MODEL_PINS, default=MODEL)
    arguments = parser.parse_args()
    print(json.dumps(compare(arguments.gguf, arguments.llama_server, arguments.output_dir, arguments.model), indent=2))
