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
from reviewed import reviewed_result
from server import MODEL, MODEL_PINS, local_server, request_reply, verify_model


def validate_question(question):
    if not 1 <= len(question.strip()) <= 300 or any(ch in question for ch in "\r\n\x00"):
        raise ValueError("Use one question of 1 to 300 characters")


def retrieve(question, source_id=None):
    validate_question(question)
    command = ["node", str(HERE / "retrieve.mjs"), question]
    if source_id is not None:
        command.append(source_id)
    result = subprocess.run(command, capture_output=True,
                            check=True, timeout=15, text=True)
    record = json.loads(result.stdout)
    if source_id is not None:
        record["requestedSourceID"] = source_id.strip().upper()
    return record


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


def answer(question, connection, model_id, *, record=None):
    if record is None:
        record = retrieve(question)
    sources = record["sources"]
    result = dict(question=question, registerRevision=record["registerRevision"], retrieved=sources,
                  model=model_id, modelSHA256=MODEL_PINS[model_id], semanticSupportVerified=False)
    if "requestedSourceID" in record:
        result["requestedSourceID"] = record["requestedSourceID"]
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


def containing_sentence(quote, finding):
    """Extend a quote only when it identifies a single sentence of the reviewed summary."""
    matches = [sentence for sentence in re.split(r"(?<=[.!?])\s+", finding) if quote in sentence]
    return matches[0] if len(matches) == 1 else quote


def assess_support(proposal, connection):
    """Check the complete cited sentence so the extractive span limit cannot clip a fact."""
    if proposal["status"] != "quote_proposed":
        return proposal
    source = next(item for item in proposal["retrieved"] if item["id"] == proposal["source"])
    excerpt = containing_sentence(proposal["answer"], source["finding"])
    evidence = {"question": proposal["question"], "proposedQuote": excerpt,
                "sourceSummary": source["finding"]}
    prompt = ("Judge the proposed quote using only the supplied text. "
              "Does the quote itself provide the whole fact requested by the question, "
              "with the correct subject, units, time and conditions? The source summary "
              "provides context. A related topic or a different quantity is insufficient. "
              "Return YES only if the quote answers the question. Otherwise return NO.\n"
              + json.dumps(evidence, ensure_ascii=False))
    reply = request_reply(connection, proposal["model"], prompt, 8, 'root ::= "YES" | "NO"\n')
    choice = reply["choices"][0]
    verdict = choice["message"]["content"]
    if (reply["model"] != proposal["model"] or not reply["id"] or
            choice["finish_reason"] != "stop" or verdict not in ("YES", "NO")):
        raise ValueError("Incomplete or invalid quote support assessment")
    checked = dict(proposal, answer=excerpt, supportAssessment=dict(
        verdict=verdict, requestID=reply["id"], prompt=prompt,
        proposedQuote=proposal["answer"], assessedQuote=excerpt, proposedSource=proposal["source"]))
    if verdict == "NO":
        checked.update(status="insufficient_evidence", answer="UNKNOWN", source=None)
        checked.pop("sourceURL", None)
    return checked


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--gguf", type=Path, help="Required for inference or --check")
    parser.add_argument("--llama-server", type=Path, help="Required for inference or --check")
    parser.add_argument("--source-id", help="Only consider this reviewed source record")
    parser.add_argument("--reviewed-only", action="store_true",
                        help="Look up a listed question without a model")
    parser.add_argument("--assess-support", action="store_true",
                        help="Ask the model to check a proposed quote before returning it")
    parser.add_argument("--model", choices=MODEL_PINS, default=MODEL)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--question")
    group.add_argument("--list-reviewed", action="store_true",
                       help="List the reviewed questions for --source-id")
    group.add_argument("--check", action="store_true", help="Run the frozen end-to-end study")
    args = parser.parse_args()
    if args.reviewed_only and args.question is None:
        parser.error("--reviewed-only requires --question")
    if args.reviewed_only or args.list_reviewed:
        if args.source_id is None or args.assess_support:
            parser.error("Reviewed questions require --source-id and cannot use --assess-support")
    if args.check and args.assess_support:
        parser.error("--assess-support applies to a single --question")
    if args.source_id is not None:
        if args.check:
            parser.error("--source-id applies to a single --question")
        args.source_id = args.source_id.strip().upper()
        if not re.fullmatch(r"[A-Z0-9][A-Z0-9_-]{0,63}", args.source_id):
            parser.error("Use a source ID of 1 to 64 letters, digits, underscores or hyphens")
    if args.reviewed_only or args.list_reviewed:
        if args.question is not None:
            try:
                validate_question(args.question)
            except ValueError as error:
                parser.error(str(error))
        record = retrieve(args.source_id, args.source_id)
        print(json.dumps(reviewed_result(record, args.source_id, args.question), ensure_ascii=False, indent=2))
        return
    record = None
    if args.question is not None:
        try:
            record = retrieve(args.question, args.source_id)
        except ValueError as error:
            parser.error(str(error))
        if not record["sources"]:
            result = answer(args.question, None, args.model, record=record)
            print(json.dumps(result, ensure_ascii=False, indent=2))
            return
    if args.gguf is None or args.llama_server is None:
        parser.error("--gguf and --llama-server are required to generate an answer or run --check")
    verify_model(args.gguf, args.model)
    binary = args.llama_server.resolve(strict=True)
    with local_server(args.gguf, binary, args.model) as connection:
        if args.question is not None:
            result = answer(args.question, connection, args.model, record=record)
            if args.assess_support:
                result = assess_support(result, connection)
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
