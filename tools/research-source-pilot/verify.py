#!/usr/bin/env python3
"""Independent stdlib replay of the frozen v1 workshop sentence selector.

Usage: python3 verify.py TRUSTED-FREEZE-SHA256 REPORT.json
The trusted digest must come from a separately retained record. Adjacent digest
files are never consulted. Passing proves consistency with pinned curated notes
and numeric replay, not source truth, a signature, or execution attestation.
This program never imports or executes JavaScript.
"""

import hashlib
import json
import math
from pathlib import Path
import re
import sys
from urllib.parse import urlsplit


HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
SHA256 = re.compile(r"[0-9a-f]{64}\Z")
SHA1 = re.compile(r"[0-9a-f]{40}\Z")
IDENTIFIER = re.compile(r"[a-zA-Z0-9][a-zA-Z0-9_.-]*\Z")
BASELINE_PATH = re.compile(r"(?:apps/web/model-workshop/[a-z-]+\.(?:js|json)|package\.json)\Z")
FROZEN_FILES = ("sources.json", "cases.json", "baseline.json")
MODEL_KEYS = ("soft", "hard")
FEATURE_NAMES = ["query_overlap", "sentence_overlap", "jaccard", "character_overlap",
                 "bigram_overlap", "quantity_question", "numeric_evidence", "quantity_match",
                 "overlap_margin", "unmatched_share"]
STOP = frozenset("a an the of in on to for and or by is are be was were has have does do can with from its it this that as at what which how may".split())
QUANTITY = re.compile(r"\b(how (many|much|long)|maximum|minimum|percentage|price|fee|rate|when|time)\b", re.I | re.ASCII)
NUMERIC = re.compile(r"\d|\b(one|two|three|four|five|six|seven|eight|nine|ten)\b", re.I | re.ASCII)
JS_SPACE = "\u0009\u000b\u000c\u0020\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u202f\u205f\u3000\ufeff\n\r\u2028\u2029"
UNKNOWN = "UNKNOWN · insufficient evidence"
PROBABILITY_TOLERANCE = 1e-12


class VerificationError(ValueError):
    """The supplied record does not match the independently checked evidence."""


def check(condition, message):
    if not condition:
        raise VerificationError(message)


def sha256(data):
    return hashlib.sha256(data.encode("utf-8") if isinstance(data, str) else data).hexdigest()


def _pairs(pairs):
    result = {}
    for key, value in pairs:
        check(key not in result, "Duplicate JSON object key: " + key)
        result[key] = value
    return result


def _nonfinite(value):
    raise VerificationError("Non-finite JSON number: " + value)


def parse_json(data):
    try:
        return json.loads(data, object_pairs_hook=_pairs, parse_constant=_nonfinite)
    except (json.JSONDecodeError, UnicodeDecodeError) as error:
        raise VerificationError("Invalid UTF-8 JSON") from error


def file_bytes(path, limit=256 * 1024):
    check(path.is_file(), "Missing regular file: " + str(path))
    check(path.stat().st_size <= limit, "File exceeds size limit: " + str(path))
    data = path.read_bytes()
    check(len(data) <= limit, "File exceeds size limit: " + str(path))
    return data


def fields(value, names, label):
    check(type(value) is dict and set(value) == set(names), "Unexpected fields in " + label)


def same(left, right):
    """Type-aware equality: True must never stand in for 1 or 1.0."""
    if type(left) is not type(right):
        return False
    if type(left) is dict:
        return set(left) == set(right) and all(same(left[k], right[k]) for k in left)
    if type(left) is list:
        return len(left) == len(right) and all(same(a, b) for a, b in zip(left, right))
    return left == right


def js_length(value):
    return len(value.encode("utf-16-le")) // 2


def text(value, label, maximum=1000):
    check(type(value) is str and bool(value) and value.strip(JS_SPACE) == value,
          "Invalid " + label)
    check(not re.search(r"[\x00-\x1f\x7f\u2028\u2029\ud800-\udfff]", value), "Invalid characters in " + label)
    check(js_length(value) <= maximum, "Too long: " + label)


def identifier(value, label):
    text(value, label, 100)
    check(IDENTIFIER.fullmatch(value) is not None, "Invalid " + label)


def array(value, label, lower, upper):
    check(type(value) is list and lower <= len(value) <= upper, "Invalid " + label)


def finite_number(value, limit=None):
    return (type(value) in (int, float) and math.isfinite(value)
            and (limit is None or abs(value) <= limit))


def canonical(value):
    """The corpus canonical format only admits safe integers, never floats."""
    if value is None or type(value) in (bool, str):
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    if type(value) is int:
        check(abs(value) <= 9007199254740991, "Unsafe integer in canonical data")
        return str(value)
    if type(value) is list:
        return "[" + ",".join(canonical(x) for x in value) + "]"
    if type(value) is dict:
        check(all(type(k) is str for k in value), "Non-string canonical key")
        # Schema keys and identifiers in this corpus are ASCII; UTF-16 sorting
        # also matches the JS comparator should a permitted key contain Unicode.
        order = sorted(value, key=lambda k: k.encode("utf-16-be"))
        return "{" + ",".join(canonical(k) + ":" + canonical(value[k]) for k in order) + "}"
    raise VerificationError("Unsupported canonical value")


def validate_corpus(corpus, suite):
    fields(corpus, ["schema", "created_date", "evaluation_kind", "training_sources", "primary_bytes_pinned", "notes", "sources"], "corpus")
    fields(suite, ["schema", "evaluation_kind", "scoring", "cases"], "suite")
    check(corpus["schema"] == "pocket-source-pilot-corpus-v1", "Wrong corpus schema")
    check(suite["schema"] == "pocket-source-pilot-cases-v1", "Wrong suite schema")
    check(corpus["evaluation_kind"] == suite["evaluation_kind"] == "visible-development-fixture", "Wrong evaluation scope")
    check(corpus["primary_bytes_pinned"] is False, "Primary-byte scope overstated")
    text(corpus["created_date"], "date", 10)
    text(corpus["notes"], "corpus notes")
    text(suite["scoring"], "scoring description")
    array(corpus["sources"], "sources", 1, 32)
    array(corpus["training_sources"], "training sources", 0, 64)
    array(suite["cases"], "cases", 1, 64)
    families, by_id, notes, case_ids, training_ids = {}, {}, set(), set(), set()

    def bind_family(family, split):
        check(family not in families or families[family] == split, "Source-family split leakage: " + family)
        families[family] = split

    for item in corpus["training_sources"]:
        fields(item, ["id", "family", "split"], "training source")
        identifier(item["id"], "training ID")
        identifier(item["family"], "training family")
        check(item["id"] not in training_ids, "Duplicate training source ID")
        training_ids.add(item["id"])
        check(item["split"] == "training", "Wrong training split")
        bind_family(item["family"], item["split"])

    for source in corpus["sources"]:
        fields(source, ["id", "family", "split", "title", "authors", "version", "url", "related_urls", "text_kind", "rights", "notes"], "source")
        identifier(source["id"], "source ID")
        identifier(source["family"], "source family")
        check(source["id"] not in by_id and source["id"] not in training_ids, "Duplicate source ID")
        check(source["split"] == "evaluation", "Wrong source split")
        bind_family(source["family"], source["split"])
        for name in ("title", "version", "rights"):
            text(source[name], name)
        array(source["authors"], "authors", 1, 30)
        for author in source["authors"]:
            text(author, "author", 160)
        check(source["text_kind"] in ("curated_paraphrase", "owned_synthetic"), "Wrong text kind")
        array(source["related_urls"], "related URLs", 0, 20)
        for url in [source["url"], *source["related_urls"]]:
            text(url, "URL", 1500)
            if source["text_kind"] == "owned_synthetic" and url.startswith("urn:pocket:fixture:"):
                continue
            check(url.startswith("https://"), "Unsupported citation URL")
            try:
                parsed = urlsplit(url)
                check(bool(parsed.hostname) and not parsed.username and not parsed.password, "Invalid citation URL")
            except ValueError as error:
                raise VerificationError("Invalid citation URL") from error
        array(source["notes"], "notes", 1, 64)
        for note in source["notes"]:
            fields(note, ["id", "text", "locator", "provenance", "claim_type", "limitation"], "note")
            identifier(note["id"], "note ID")
            check(note["id"] not in notes, "Duplicate note ID")
            notes.add(note["id"])
            text(note["text"], "note text", 6000)
            text(note["locator"], "locator", 1500)
            text(note["claim_type"], "claim type", 150)
            text(note["limitation"], "limitation")
            expected = "owned_synthetic" if source["text_kind"] == "owned_synthetic" else "source_reported"
            check(note["provenance"] == expected, "Wrong note provenance")
        check(js_length("\n".join(n["text"] for n in source["notes"])) <= 6000, "Passage exceeds reader limit")
        by_id[source["id"]] = source

    for case in suite["cases"]:
        fields(case, ["id", "source_id", "question", "kind", "expected_note_id", "label_provenance"], "case")
        identifier(case["id"], "case ID")
        check(case["id"] not in case_ids, "Duplicate case ID")
        case_ids.add(case["id"])
        text(case["question"], "question", 500)
        text(case["label_provenance"], "label provenance", 500)
        identifier(case["source_id"], "case source ID")
        check(case["source_id"] in by_id, "Unknown case source")
        check(case["kind"] in ("supported", "unsupported", "contradiction", "untrusted_instruction"), "Wrong case kind")
        if case["kind"] == "supported":
            check(type(case["expected_note_id"]) is str and case["expected_note_id"] in
                  {n["id"] for n in by_id[case["source_id"]]["notes"]}, "Invalid expected note")
        else:
            check(case["expected_note_id"] is None, "Abstention case carries an answer")
    check(all(any(c["source_id"] == source_id for c in suite["cases"]) for source_id in by_id), "Source has no cases")
    check(len(canonical(corpus).encode()) <= 128 * 1024 and len(canonical(suite).encode()) <= 128 * 1024, "Corpus exceeds limit")
    return by_id, families


def load_frozen(trusted_digest, directory=HERE, root=ROOT):
    check(type(trusted_digest) is str and SHA256.fullmatch(trusted_digest), "Supply the separately retained freeze SHA-256")
    directory, root = Path(directory), Path(root).resolve()
    frozen_bytes = file_bytes(directory / "freeze.json")
    check(sha256(frozen_bytes) == trusted_digest, "Freeze digest mismatch")
    freeze = parse_json(frozen_bytes)
    fields(freeze, ["schema", "frozen_utc", "evaluation_kind", "baseline_revision", "files", "family_splits", "label_review"], "freeze")
    check(freeze["schema"] == "pocket-source-pilot-freeze-v1", "Wrong freeze schema")
    check(freeze["evaluation_kind"] == "visible-development-fixture", "Wrong freeze scope")
    text(freeze["frozen_utc"], "freeze date")
    text(freeze["label_review"], "label review")
    fields(freeze["files"], FROZEN_FILES, "frozen files")
    data = {}
    for filename in FROZEN_FILES:
        expected = freeze["files"][filename]
        check(type(expected) is str and SHA256.fullmatch(expected), "Invalid frozen digest")
        raw = file_bytes(directory / filename)
        check(sha256(raw) == expected, "Frozen file digest mismatch: " + filename)
        data[filename] = parse_json(raw)
    corpus, suite, baseline = (data[n] for n in FROZEN_FILES)
    by_id, families = validate_corpus(corpus, suite)
    check(same(families, freeze["family_splits"]), "Frozen family split mismatch")
    fields(baseline, ["repository", "revision", "scope", "files"], "baseline")
    check(baseline["repository"] == "macksteward59-lgtm/pocket-ai-lab", "Wrong baseline repository")
    check(type(baseline["revision"]) is str and SHA1.fullmatch(baseline["revision"]) and
          baseline["revision"] == freeze["baseline_revision"], "Wrong baseline revision")
    text(baseline["scope"], "baseline scope")
    array(baseline["files"], "baseline files", 8, 32)
    assets = {}
    for entry in baseline["files"]:
        fields(entry, ["path", "git_blob_sha", "sha256", "bytes"], "baseline asset")
        rel = entry["path"]
        check(type(rel) is str and BASELINE_PATH.fullmatch(rel) and rel not in assets, "Invalid baseline path")
        check(type(entry["bytes"]) is int and 0 < entry["bytes"] <= 256 * 1024, "Invalid baseline byte count")
        check(type(entry["sha256"]) is str and SHA256.fullmatch(entry["sha256"]), "Invalid baseline digest")
        check(type(entry["git_blob_sha"]) is str and SHA1.fullmatch(entry["git_blob_sha"]), "Invalid Git blob digest")
        resolved = (root / rel).resolve()
        check(resolved.is_relative_to(root), "Baseline path escapes candidate")
        raw = file_bytes(resolved)
        check(len(raw) == entry["bytes"] and sha256(raw) == entry["sha256"], "Pinned baseline changed: " + rel)
        git_blob = hashlib.sha1(b"blob " + str(len(raw)).encode("ascii") + b"\0" + raw).hexdigest()
        check(git_blob == entry["git_blob_sha"], "Git blob mismatch: " + rel)
        assets[rel] = raw
    required = {"apps/web/model-workshop/" + n for n in
                ("reader.js", "compare.js", "catalog.js", "identity.js", "edit.js", "family.js", "soft.json", "hard.json")}
    check(required <= set(assets), "Missing required baseline asset")
    return freeze, corpus, suite, baseline, assets


def validate_weights(model):
    fields(model, ["version", "features", "weights", "biases", "output", "intercept"], "weights")
    check(type(model["version"]) is int and model["version"] == 1, "Invalid model version")
    check(same(model["features"], FEATURE_NAMES), "Wrong model features")

    def vector(values, count):
        return type(values) is list and len(values) == count and all(finite_number(x, 1e6) for x in values)

    check(type(model["weights"]) is list and len(model["weights"]) == 8 and
          all(vector(row, 10) for row in model["weights"]) and vector(model["biases"], 8) and
          vector(model["output"], 8) and finite_number(model["intercept"], 1e6), "Invalid model numbers")


def words(value):
    return [w for w in re.findall(r"[a-z0-9]+", value.lower()) if w not in STOP]


def trigrams(tokens):
    return {word[i:i + 3] for word in tokens for i in range(len(word) - 2)}


def bigrams(tokens):
    return {tokens[i] + " " + tokens[i + 1] for i in range(len(tokens) - 1)}


def feature_rows(question, sentences):
    q = words(question)
    terms, chars, pairs = set(q), trigrams(set(q)), bigrams(q)
    spans = [words(s) for s in sentences]
    sets = [set(span) for span in spans]
    overlaps = [len(terms & span) / max(1, len(terms)) for span in sets]
    quantity = int(QUANTITY.search(question) is not None)
    rows = []
    for index, span in enumerate(sets):
        shared = len(terms & span)
        number = int(NUMERIC.search(sentences[index]) is not None)
        rival = max([0] + [value for j, value in enumerate(overlaps) if j != index])
        rows.append([overlaps[index], shared / max(1, len(span)),
                     shared / max(1, len(span) + len(terms) - shared),
                     len(chars & trigrams(span)) / max(1, len(chars)),
                     len(pairs & bigrams(spans[index])) / max(1, len(pairs)),
                     quantity, number, quantity * number, overlaps[index] - rival,
                     sum(w not in span for w in q) / max(1, len(q))])
    return rows


def dot(left, right):
    result = 0.0
    for a, b in zip(left, right):
        result += a * b
    return result


def forward(model, row):
    hidden = [math.tanh(dot(w, row) + b) for w, b in zip(model["weights"], model["biases"])]
    logit = dot(model["output"], hidden) + model["intercept"]
    return 1.0 / (1.0 + math.exp(-max(-40.0, min(40.0, logit))))


def replay(model, question, sentences):
    scores = [forward(model, row) for row in feature_rows(question.strip(JS_SPACE), sentences)]
    chosen, maximum = -1, 0.5
    for index, score in enumerate(scores):
        if score > maximum:
            chosen, maximum = index, score
    return chosen, scores


def expected_citation(source, note):
    return {"source_id": source["id"], "source_family": source["family"],
            "version": source["version"], "url": source["url"], "text_kind": source["text_kind"],
            "note_id": note["id"], "locator": note["locator"],
            "note_sha256": sha256(note["text"]), "source_record_sha256": sha256(canonical(source))}


def empty_metrics():
    return {"supported": {"correct": 0, "total": 0, "wrong_selection": 0, "abstained": 0},
            "abstention": {"correct": 0, "total": 0, "answered": 0},
            "citation_integrity": {"valid": 0, "total": 0}}


def verify_report(trusted_digest, report_path, directory=HERE, root=ROOT):
    freeze, corpus, suite, baseline, assets = load_frozen(trusted_digest, directory, root)
    report_bytes = file_bytes(Path(report_path), 1024 * 1024)
    report = parse_json(report_bytes)
    fields(report, ["schema", "freeze_sha256", "baseline_revision", "evaluation_kind", "execution_scope", "model_training",
                    "remote_actions", "primary_source_semantics_independently_proven", "models", "cases", "metrics"], "report")
    expected_header = {"schema": "pocket-source-pilot-report-v1", "freeze_sha256": trusted_digest,
                       "baseline_revision": baseline["revision"], "evaluation_kind": "visible-development-fixture",
                       "execution_scope": "node-host-curated-notes", "model_training": False,
                       "remote_actions": False, "primary_source_semantics_independently_proven": False}
    for name, expected in expected_header.items():
        check(same(report[name], expected), "Wrong report declaration: " + name)
    array(report["models"], "report models", 2, 2)
    models = {}
    for key, record in zip(MODEL_KEYS, report["models"]):
        fields(record, ["key", "asset_path", "asset_sha256", "model_id", "weights_sha256", "weights_json", "engine", "training_in_this_run"], "model record")
        path = "apps/web/model-workshop/" + key + ".json"
        check(record["key"] == key and record["asset_path"] == path, "Wrong model identity/order")
        check(record["asset_sha256"] == sha256(assets[path]), "Wrong weight asset digest")
        check(type(record["weights_json"]) is str, "Invalid normalized weights")
        # These pinned files already have compact normalized object/number order.
        # Reuse their exact JSON lexemes instead of reserializing binary floats.
        expected_json = assets[path].decode("utf-8").rstrip("\r\n")
        check(record["weights_json"] == expected_json, "Normalized weights differ from pinned asset")
        model = parse_json(record["weights_json"])
        validate_weights(model)
        check(same(model, parse_json(assets[path])), "Weight values differ from frozen asset")
        digest = sha256(record["weights_json"])
        check(record["model_id"] == record["weights_sha256"] == digest, "Wrong normalized model hash")
        check(record["engine"] == "pocket-workshop-v1" and record["training_in_this_run"] is False, "Wrong model execution scope")
        models[key] = model
    ordered = [(source, case) for source in corpus["sources"] for case in suite["cases"] if case["source_id"] == source["id"]]
    array(report["cases"], "report cases", len(ordered), len(ordered))
    metrics = {key: empty_metrics() for key in MODEL_KEYS}
    prediction_count, citation_count, maximum_difference = 0, 0, 0.0
    for (source, case), row in zip(ordered, report["cases"]):
        fields(row, ["id", "source_id", "kind", "expected_note_id", "outputs"], "report case")
        for name in ("id", "source_id", "kind", "expected_note_id"):
            check(same(row[name], case[name]), "Case metadata mismatch: " + name)
        array(row["outputs"], "model outputs", 2, 2)
        sentences = [note["text"] for note in source["notes"]]
        for key, output in zip(MODEL_KEYS, row["outputs"]):
            fields(output, ["model_key", "decision", "selected_note_id", "answer_sha256", "citation", "citation_binding_valid", "correct", "probabilities"], "model output")
            check(output["model_key"] == key, "Wrong output model/order")
            selected, probabilities = replay(models[key], case["question"], sentences)
            note = None if selected < 0 else source["notes"][selected]
            note_id = None if note is None else note["id"]
            answer = UNKNOWN if note is None else note["text"]
            check(output["decision"] == ("abstain" if note is None else "answer"), "Decision differs from replay")
            check(same(output["selected_note_id"], note_id), "Selected note differs from replay")
            check(output["answer_sha256"] == sha256(answer), "Answer digest differs from selected note")
            check(output["correct"] is (note_id == case["expected_note_id"]), "Incorrect correctness flag")
            check(same(output["citation"], None if note is None else expected_citation(source, note)), "Citation binding mismatch")
            check(same(output["citation_binding_valid"], None if note is None else True), "Wrong citation validity flag")
            array(output["probabilities"], "probabilities", len(probabilities), len(probabilities))
            for observed, expected in zip(output["probabilities"], probabilities):
                check(finite_number(observed) and 0 <= observed <= 1, "Invalid probability")
                difference = abs(observed - expected)
                check(difference <= PROBABILITY_TOLERANCE, "Probability differs from independent replay")
                maximum_difference = max(maximum_difference, difference)
            result = metrics[key]
            if case["kind"] == "supported":
                result["supported"]["total"] += 1
                measure = "correct" if note_id == case["expected_note_id"] else ("abstained" if note_id is None else "wrong_selection")
                result["supported"][measure] += 1
            else:
                result["abstention"]["total"] += 1
                result["abstention"]["correct" if note_id is None else "answered"] += 1
            if note is not None:
                result["citation_integrity"]["total"] += 1
                result["citation_integrity"]["valid"] += 1
                citation_count += 1
            prediction_count += 1
    check(same(report["metrics"], metrics), "Reported metrics differ from replay")
    return {"status": "verified", "freeze_sha256": trusted_digest,
            "report_sha256": sha256(report_bytes), "baseline_revision": baseline["revision"],
            "frozen_files_verified": len(FROZEN_FILES), "baseline_assets_verified": len(assets),
            "sources_verified": len(corpus["sources"]), "cases_verified": len(ordered),
            "predictions_replayed": prediction_count, "citations_verified": citation_count,
            "maximum_probability_difference": maximum_difference, "metrics": metrics,
            "scope": "Pinned curated-note integrity and numeric replay; not semantic accuracy, primary-source truth, execution attestation, or device acceptance."}


def main(argv=None):
    arguments = sys.argv[1:] if argv is None else argv
    if len(arguments) != 2:
        print("Usage: python3 verify.py TRUSTED-FREEZE-SHA256 REPORT.json", file=sys.stderr)
        return 2
    try:
        result = verify_report(arguments[0], arguments[1])
    except (VerificationError, OSError, UnicodeError, TypeError, OverflowError) as error:
        print("Verification failed: " + str(error), file=sys.stderr)
        return 1
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
