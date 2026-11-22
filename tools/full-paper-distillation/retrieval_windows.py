"""Compare sentence and paragraph-bounded evidence retrieval on frozen QASPER papers."""
import argparse
import hashlib
import json
from pathlib import Path

from retrieval import BM25, Encoder, EXCLUDED, TOPIC, fresh, load_corpus, passages, reference

ENCODER_REVISION = "02af79985278377e65c724a76275707cb0333c70"
ENCODER_SHA = "a458124320862073798888baec39b3bc5ecb0199e4ebe1ee511b505d611d5193"
TOKENIZER_SHA = "d241a60d5e8f04cc1b2b3e9ef7a4921b27bf526d9f6050ab90f9267a1f9e5c66"
PASSAGE_PREFIX = "passage: "
RANK_LIMIT = 20


def paragraph_ranges(paper, sentences):
    """Recover distinct paragraph boundaries in the legacy sentence numbering."""
    paragraphs = [paper["abstract"]]
    paragraphs.extend(text for section in paper["full_text"] for text in section["paragraphs"])
    ranges = []
    offset = 0
    for paragraph in paragraphs:
        parts, _ = passages({"abstract": paragraph, "full_text": []})
        end = offset + len(parts)
        if parts != sentences[offset:end]:
            raise ValueError("Paragraph segmentation differs from the baseline")
        if parts:
            ranges.append((offset, end))
        offset = end
    if offset != len(sentences):
        raise ValueError("Paragraph boundaries do not cover the baseline sentences")
    return ranges


def candidate_windows(paper, sentences, tokenizer):
    """Keep only windows whose full scored text fits the pinned encoder."""
    candidates = {}
    for first, stop in paragraph_ranges(paper, sentences):
        for index in range(first, stop):
            start = max(first, index - 1)
            end = min(stop, index + 2)
            text = " ".join(sentences[start:end])
            if tokenizer.encode(PASSAGE_PREFIX + text).overflowing:
                start, end, text = index, index + 1, sentences[index]
                if tokenizer.encode(PASSAGE_PREFIX + text).overflowing:
                    continue
            candidates[(start, end)] = text
    return sorted(candidates.items())


def disjoint_questions(corpus, excluded):
    """Select the first eligible question by digest for each unused paper."""
    eligible = []
    for document, paper in corpus.items():
        if document in excluded or not TOPIC.search(paper["title"]) or EXCLUDED.search(paper["title"]):
            continue
        sentences, groups = passages(paper)
        if len(sentences) < 40:
            continue
        for qa in paper["qas"]:
            aligned, kind = reference(qa, sentences, groups)
            if kind == "supported":
                eligible.append((qa["question_id"], document, qa["question"], aligned[0]))
    selected = {}
    for case in sorted(eligible, key=lambda case: hashlib.sha256(case[0].encode()).hexdigest()):
        selected.setdefault(case[1], case)
    return list(selected.values())


def unique_sentences(ranked_spans, limit):
    """Expand ranked spans in source order, counting shared sentences once."""
    exposed = {}
    for start, end in ranked_spans:
        for index in range(start, end):
            exposed[index] = None
            if len(exposed) == limit:
                return list(exposed)
    return list(exposed)


def dense_ranking(model, query, candidates):
    if not candidates:
        return []
    spans, texts = zip(*candidates)
    scores = model.encode(texts, PASSAGE_PREFIX) @ query
    return [spans[ix] for ix in sorted(range(len(scores)), key=lambda ix: -scores[ix])[:RANK_LIMIT]]


def evaluate(model, corpus, cases, baseline_docs):
    rows = []
    for question_id, document, question, gold in cases:
        paper = corpus[document]
        sentences = baseline_docs.get(document)
        if sentences is None:
            sentences, _ = passages(paper)
        query = model.encode([question], "query: ")[0]
        windows = candidate_windows(paper, sentences, model.tokenizer)
        if not windows:
            raise ValueError("No complete candidate fits the encoder for " + document)
        sentence_candidates = [((ix, ix + 1), text) for ix, text in enumerate(sentences)]
        ranks = {
            "bm25": [(ix, ix + 1) for ix in BM25(sentences).shortlist(question)],
            "e5Sentence": dense_ranking(model, query, sentence_candidates),
            "e5Window": dense_ranking(model, query, windows),
        }
        rows.append(dict(id=question_id, document=document, sentences=len(sentences),
                         windows=len(windows), gold=gold, ranks=ranks))
    return rows


def summarize(rows):
    counts = {}
    for method in ("bm25", "e5Sentence", "e5Window"):
        counts[method] = {
            f"top{limit}Candidates": sum(
                bool(set(unique_sentences(row["ranks"][method][:limit], 3 * RANK_LIMIT)) & set(row["gold"]))
                for row in rows
            )
            for limit in (1, 5)
        }
        budgets = (5,) if method == "bm25" else (5, 20)
        for limit in budgets:
            exposed = [unique_sentences(row["ranks"][method], limit) for row in rows]
            counts[method][f"within{limit}UniqueSentences"] = sum(
                bool(set(indices) & set(row["gold"])) for indices, row in zip(exposed, rows, strict=True)
            )
            counts[method][f"totalSentencesExposedAtBudget{limit}"] = sum(map(len, exposed))
    return counts


def verify_baseline(report, rows):
    """Catch a cohort, baseline ranker, or top-five ranking regression."""
    observed = [
        dict(id=row["id"], document=row["document"], sentences=row["sentences"], gold=row["gold"],
             bm25=[start for start, _ in row["ranks"]["bm25"]],
             e5=[start for start, _ in row["ranks"]["e5Sentence"][:5]])
        for row in rows
    ]
    if report["rows"] != observed:
        raise ValueError("Paired baseline changed within the same execution environment")


def verify_file(path, expected):
    with path.open("rb") as source:
        if hashlib.file_digest(source, "sha256").hexdigest() != expected:
            raise ValueError("Digest mismatch for " + path.name)


def main():
    cli = argparse.ArgumentParser(description=__doc__)
    for name in ("archive", "weights", "tokenizer", "baseline", "out"):
        cli.add_argument("--" + name, type=Path, required=True)
    args = cli.parse_args()
    verify_file(args.weights, ENCODER_SHA)
    verify_file(args.tokenizer, TOKENIZER_SHA)
    corpus = load_corpus(args.archive)
    selected, baseline_docs, original_excluded = fresh(corpus)
    paired = list(selected)
    excluded = set(original_excluded) | {row[1] for row in paired}
    disjoint = disjoint_questions(corpus, excluded)
    if len(paired) != 24 or len(disjoint) != 12:
        raise ValueError("Unexpected frozen cohort sizes")
    model = Encoder(args.weights, args.tokenizer)
    paired_rows = evaluate(model, corpus, paired, baseline_docs)
    verify_baseline(json.loads(args.baseline.read_text()), paired_rows)
    disjoint_rows = evaluate(model, corpus, disjoint, {})
    result = dict(
        dataset="QASPER v0.3 test", model="Xenova/e5-small-v2", revision=ENCODER_REVISION,
        modelSHA256=ENCODER_SHA, tokenizerSHA256=TOKENIZER_SHA,
        windowRadiusSentences=1, maximumRankedCandidates=RANK_LIMIT,
        priorPaperIDsExcludedFromDisjoint=sorted(excluded),
        cohorts={
            "paired": dict(count=len(paired_rows), counts=summarize(paired_rows), rows=paired_rows),
            "disjoint": dict(count=len(disjoint_rows), counts=summarize(disjoint_rows), rows=disjoint_rows),
        },
    )
    args.out.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps({name: data["counts"] for name, data in result["cohorts"].items()}, indent=2))


if __name__ == "__main__":
    main()
