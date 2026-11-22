"""Measure MiniLM reranking of the E5 sentence pool on the same QASPER cases."""
import argparse
import hashlib
import json
from pathlib import Path
from statistics import median
from time import perf_counter

from retrieval import load_corpus, passages, reference
from retrieval_windows import ENCODER_SHA, RANK_LIMIT, TOKENIZER_SHA, verify_file

MODEL = "cross-encoder/ms-marco-MiniLM-L6-v2"
REVISION = "233902d25c440f23af6f7d6e94d2946bac0bee0a"
WEIGHTS_SHA = "3573b6b9593cb2f75987a31815d409ca3dd8808629118fd20451bb1a5d90cec7"


class Reranker:
    def __init__(self, weights, tokenizer):
        import onnxruntime as ort
        from tokenizers import Tokenizer

        self.tokenizer = Tokenizer.from_file(str(tokenizer))
        self.tokenizer.enable_truncation(max_length=512)
        self.tokenizer.enable_padding(pad_id=0, pad_token="[PAD]")
        options = ort.SessionOptions()
        options.intra_op_num_threads = 3
        self.session = ort.InferenceSession(str(weights), options, providers=["CPUExecutionProvider"])

    def score(self, question, texts):
        import numpy as np

        batch = self.tokenizer.encode_batch([(question, text) for text in texts])
        if any(item.overflowing for item in batch):
            raise ValueError("A question and candidate pair exceeded the encoder context limit")
        inputs = {
            "input_ids": np.asarray([item.ids for item in batch], dtype=np.int64),
            "attention_mask": np.asarray([item.attention_mask for item in batch], dtype=np.int64),
            "token_type_ids": np.asarray([item.type_ids for item in batch], dtype=np.int64),
        }
        logits = self.session.run(["logits"], inputs)[0]
        if logits.shape != (len(texts), 1) or not np.isfinite(logits).all():
            raise ValueError("Unexpected reranker scores")
        return logits[:, 0].tolist()


def rank_candidates(candidates, logits):
    """Use the original E5 order for exact ties."""
    return [index for index, _ in sorted(zip(candidates, logits, strict=True), key=lambda pair: -pair[1])]


def hit(ranking, gold, limit):
    return bool(set(ranking[:limit]) & set(gold))


def evaluate(corpus, rows, model):
    results = []
    for row in rows:
        paper = corpus[row["document"]]
        sentences, groups = passages(paper)
        question, = (qa for qa in paper["qas"] if qa["question_id"] == row["id"])
        aligned, kind = reference(question, sentences, groups)
        if kind != "supported" or aligned[0] != row["gold"] or len(sentences) != row["sentences"]:
            raise ValueError("Source alignment changed for " + row["id"])
        spans = row["ranks"]["e5Sentence"]
        candidates = [start for start, _ in spans]
        if (len(candidates) != RANK_LIMIT or len(set(candidates)) != RANK_LIMIT
                or any(end != start + 1 or not 0 <= start < len(sentences) for start, end in spans)):
            raise ValueError("Invalid sentence pool for " + row["id"])

        started = perf_counter()
        logits = model.score(question["question"], [sentences[index] for index in candidates])
        elapsed = (perf_counter() - started) * 1000
        results.append(dict(id=row["id"], document=row["document"], gold=row["gold"],
                            e5Sentence=candidates, reranked=rank_candidates(candidates, logits),
                            logitsInE5Order=logits, scoreMilliseconds=elapsed))

    counts = {}
    for method in ("e5Sentence", "reranked"):
        counts[method] = {
            f"top{limit}": sum(hit(row[method], row["gold"], limit) for row in results)
            for limit in (1, 5, RANK_LIMIT)
        }
    pairs = [(hit(row["e5Sentence"], row["gold"], 5), hit(row["reranked"], row["gold"], 5)) for row in results]
    return dict(count=len(results), counts=counts, gainedAt5=sum(after and not before for before, after in pairs),
                lostAt5=sum(before and not after for before, after in pairs),
                medianScoreMilliseconds=median(row["scoreMilliseconds"] for row in results), rows=results)


def main():
    cli = argparse.ArgumentParser(description=__doc__)
    for name in ("archive", "weights", "tokenizer", "windows", "out"):
        cli.add_argument("--" + name, type=Path, required=True)
    args = cli.parse_args()
    verify_file(args.weights, WEIGHTS_SHA)
    verify_file(args.tokenizer, TOKENIZER_SHA)
    source = args.windows.read_bytes()
    baseline = json.loads(source)
    if baseline["modelSHA256"] != ENCODER_SHA or baseline["tokenizerSHA256"] != TOKENIZER_SHA:
        raise ValueError("Unexpected E5 baseline")
    corpus = load_corpus(args.archive)
    model = Reranker(args.weights, args.tokenizer)
    cohorts = {name: evaluate(corpus, data["rows"], model) for name, data in baseline["cohorts"].items()}
    report = dict(model=MODEL, revision=REVISION, weightsSHA256=WEIGHTS_SHA,
                  tokenizerSHA256=TOKENIZER_SHA, baseWindowsSHA256=hashlib.sha256(source).hexdigest(),
                  candidateCount=RANK_LIMIT, cohorts=cohorts)
    args.out.write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps({name: data["counts"] for name, data in cohorts.items()}, indent=2))


if __name__ == "__main__":
    main()
