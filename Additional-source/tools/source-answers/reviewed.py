"""Resolve an authored question and exact excerpt against the current source index."""
import hashlib
import json
from pathlib import Path

CATALOG = Path(__file__).with_name("reviewed-questions.json")


def reviewed_result(record, source_id, question=None):
    catalog = json.loads(CATALOG.read_text(encoding="utf-8"))
    result = dict(mode="reviewed_questions", requestedSourceID=source_id,
                  registerRevision=record["registerRevision"], model=None)
    if question is not None:
        result["question"] = question

    def unknown(reason):
        return dict(result, status=reason, answer="UNKNOWN", source=None, availableQuestions=[])

    if len(record["sources"]) != 1 or record["sources"][0]["id"] != source_id:
        return unknown("source_unavailable")
    entry = catalog.get(source_id)
    if entry is None:
        return unknown("questions_unavailable")
    source = record["sources"][0]
    identity = {key: source[key] for key in ("id", "url", "finding")}
    encoded = json.dumps(identity, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode()
    digest = hashlib.sha256(encoded).hexdigest()
    if digest != entry["sourceSHA256"]:
        return unknown("source_changed")
    questions = entry["questions"]
    if not all(quote and quote in source["finding"] for quote in questions.values()):
        return unknown("excerpt_unavailable")
    result.update(reviewedSourceSHA256=digest, availableQuestions=list(questions))
    if question is None:
        return dict(result, status="questions_listed", source=source_id, sourceURL=source["url"])
    quote = questions.get(question.strip())
    if quote is None:
        return dict(result, status="question_not_listed", answer="UNKNOWN", source=None)
    return dict(result, status="reviewed_answer", answer=quote, source=source_id, sourceURL=source["url"])
