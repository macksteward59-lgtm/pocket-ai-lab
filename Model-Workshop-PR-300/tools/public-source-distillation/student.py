"""Portable question-to-sentence classifier for short English document summaries."""
import argparse
from collections import Counter
import json
import math
from pathlib import Path
import random
import re

STOP = set("a an the of in on to for and or by is are be was were has have does do can with from its it this that as at what which how may".split())
FEATURES = ("query_overlap", "sentence_overlap", "jaccard", "character_overlap", "bigram_overlap",
            "quantity_question", "numeric_evidence", "quantity_match", "overlap_margin", "unmatched_share")
WIDTH = 8


def words(text):
    return [w for w in re.findall(r"[a-z0-9]+", text.lower()) if w not in STOP]


def coverage(a, b):
    return len(a & b) / max(1, len(a))


def features(question, sentences):
    q = words(question)
    qs = set(q)
    qgrams = {w[i:i+3] for w in qs for i in range(len(w) - 2)}
    bigrams = set(zip(q, q[1:]))
    spans = [words(s) for s in sentences]
    overlaps = [coverage(qs, set(span)) for span in spans]
    quantity = float(bool(re.search(r"\b(how (many|much|long)|maximum|minimum|percentage|price|fee|rate|when|time)\b", question.lower())))
    vectors = []
    for i, tokens in enumerate(spans):
        terms = set(tokens)
        grams = {w[j:j+3] for w in terms for j in range(len(w) - 2)}
        number = float(bool(re.search(r"\d|\b(one|two|three|four|five|six|seven|eight|nine|ten)\b", sentences[i].lower())))
        others = overlaps[:i] + overlaps[i+1:]
        counts = Counter(tokens)
        uncommon = sum(counts[w] == 0 for w in q) / max(1, len(q))
        vectors.append([overlaps[i], coverage(terms, qs), len(qs & terms) / max(1, len(qs | terms)),
                        coverage(qgrams, grams), coverage(bigrams, set(zip(tokens, tokens[1:]))),
                        quantity, number, quantity * number, overlaps[i] - max(others, default=0), uncommon])
    return vectors


def forward(net, row):
    hidden = [math.tanh(sum(w*x for w, x in zip(unit, row)) + bias)
              for unit, bias in zip(net["weights"], net["biases"])]
    score = sum(w*h for w, h in zip(net["output"], hidden)) + net["intercept"]
    return hidden, 1 / (1 + math.exp(-max(-40, min(40, score))))


def fit(pairs):
    if not pairs or len({target > 0.5 for _, target in pairs}) != 2:
        raise ValueError("Training requires both support and insufficient-evidence labels")
    rng = random.Random(923)
    net = dict(version=1, features=list(FEATURES), weights=[[rng.uniform(-0.3, 0.3) for _ in FEATURES] for _ in range(WIDTH)],
               biases=[0.0]*WIDTH, output=[rng.uniform(-0.3, 0.3) for _ in range(WIDTH)], intercept=0.0)
    order = list(pairs)
    for epoch in range(150):
        rng.shuffle(order)
        rate = 0.06 / (1 + epoch / 45)
        for row, target in order:
            hidden, actual = forward(net, row)
            delta = actual - target
            for j, h in enumerate(hidden):
                dh = delta * net["output"][j] * (1 - h*h)
                for k, x in enumerate(row):
                    net["weights"][j][k] -= rate * (dh*x + 0.001*net["weights"][j][k])
                net["biases"][j] -= rate * dh
                net["output"][j] -= rate * (delta*h + 0.001*net["output"][j])
            net["intercept"] -= rate * delta
    return net


def pick(scores):
    winner = max(range(len(scores)), key=scores.__getitem__)
    return winner if scores[winner] > 0.5 else -1


def predict(net, question, sentences):
    return [forward(net, x)[1] for x in features(question, sentences)]


if __name__ == "__main__":
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument("--model", type=Path, required=True)
    cli.add_argument("--question", required=True)
    cli.add_argument("--sentence", action="append", required=True)
    args = cli.parse_args()
    net = json.loads(args.model.read_text())
    if net["version"] != 1 or net["features"] != list(FEATURES):
        cli.error("Incompatible feature schema")
    scores = predict(net, args.question, args.sentence)
    index = pick(scores)
    print(json.dumps(dict(index=index, answer=args.sentence[index] if index >= 0 else "UNKNOWN", scores=scores)))
