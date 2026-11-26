"""Answer a question about the reviewed project source register by proposing a cited excerpt."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
import time

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "passage-check"))
from extractive import labeled_grammar
from server import MODEL, MODEL_PINS, local_server, request_reply, verify_model


def retrieve(question):
    if not 1 <= len(question.strip()) <= 300 or any(ch in question for ch in "\r\n\x00"):
        raise ValueError("Use one question of 1 to 300 characters")
    result = subprocess.run(["node", str(HERE / "retrieve.mjs"), question], capture_output=True,
                            check=True, timeout=15, text=True)
    return json.loads(result.stdout)


def read_quote(output, sources):
    if output == "UNKNOWN":
        return {"status": "abstained", "answer": "UNKNOWN", "source": None}
    citation = re.fullmatch(r"(.+) \[([AB])\]", output)
    if citation:
        index = ord(citation[2]) - ord("A")
        if index < len(sources) and citation[1] in sources[index]["finding"]:
            return dict(status="quote_proposed", answer=citation[1],
                        source=sources[index]["id"], sourceURL=sources[index]["url"])
    raise ValueError("Reply did not select an exact excerpt from its cited source")


def answer(question, connection, model_id):
    record = retrieve(question)
    sources = record["sources"]
    result = dict(question=question, registerRevision=record["registerRevision"], retrieved=sources,
                  model=model_id, modelSHA256=MODEL_PINS[model_id], semanticSupportVerified=False)
    if not sources:
        return dict(result, status="no_candidates", answer="UNKNOWN", source=None)
    passages = [f"[{letter}] {item['finding']}" for letter, item in zip("AB", sources)]
    prompt = ("Use only the supplied project-source summaries. Answer the question with the shortest "
              "exact phrase that gives the requested fact, followed by its passage label. If the passages "
              "do not give the requested fact, answer UNKNOWN. Return only that answer.\n\n"
              + "\n".join(passages) + "\n\nQuestion: " + question)
    start = time.monotonic()
    response = request_reply(connection, model_id, prompt, 48, labeled_grammar(passages))
    choice = response["choices"][0]
    if response["model"] != model_id or choice["finish_reason"] != "stop" or not response["id"]:
        raise ValueError("Unexpected model, missing request ID or incomplete answer")
    output = choice["message"]["content"]
    result.update(read_quote(output, sources), rawOutput=output, requestID=response["id"],
                  latencyMs=round(1000 * (time.monotonic() - start)), prompt=prompt)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--gguf", required=True, type=Path)
    parser.add_argument("--llama-server", required=True, type=Path)
    parser.add_argument("--model", choices=MODEL_PINS, default=MODEL)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--question")
    group.add_argument("--check", action="store_true", help="Run the frozen end-to-end study")
    args = parser.parse_args()
    verify_model(args.gguf, args.model)
    binary = args.llama_server.resolve(strict=True)
    with local_server(args.gguf, binary, args.model) as connection:
        if args.question:
            result = answer(args.question, connection, args.model)
        else:
            fixture = (HERE / "questions.json").read_bytes()
            rows = []
            for case in json.loads(fixture):
                reply = answer(case["question"], connection, args.model)
                passed = reply["answer"] == case["answer"] and reply["source"] == case["source"]
                rows.append(dict(id=case["id"], passed=passed, expected=case["answer"],
                                 expectedSource=case["source"], **reply))
            result = dict(fixtureSHA256=hashlib.sha256(fixture).hexdigest(), rows=rows,
                          total=len(rows), passed=sum(row["passed"] for row in rows))
        print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
