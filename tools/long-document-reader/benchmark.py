"""Evaluate immutable sentence selectors against independent QASPER paper-level annotations."""
import argparse
from collections import Counter, defaultdict
import hashlib
import json
from pathlib import Path
import re
from statistics import median
import sys
import tarfile

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "public-source-distillation"))
from student import features, forward, pick

ARCHIVE_SHA = "72a52a41193e2838b8074f80ac074b94f956b84886c36a61c58a7df4171bdd72"
WEIGHTS = {"hard":"cbe45e272cd1f398bb2b141a5ef0ee453db70d1e78f288c988f73f09b1ee82e9",
           "soft":"a83d342fa81b413eb38602ed2c6f76f3be4153fad3db5b628f1ea02314826754"}
TOPIC = re.compile(r"translat|summari[sz]|pars(?:e|er|ing)|morpholog|corefer|caption|dialog(?:ue)?|speech recognition", re.I)
EXCLUDED = re.compile(r"attack|offensive|exploit|malware|vulnerabilit|phishing|cybersecurity|adversarial", re.I)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def checked(path, expected):
    data = path.read_bytes()
    if sha(data) != expected:
        raise ValueError("Digest mismatch for " + path.name)
    return data


def load_corpus(path):
    checked(path, ARCHIVE_SHA)
    with tarfile.open(path, "r:gz") as archive:
        matches = [e for e in archive.getmembers() if e.isfile() and Path(e.name).name.startswith("qasper-test") and e.name.endswith(".json")]
        if len(matches) != 1:
            raise ValueError("Could not identify the pinned test JSON")
        return json.load(archive.extractfile(matches[0]))


def norm(text):
    return " ".join(text.casefold().split())


def passages(doc):
    paragraphs = [doc["abstract"]] + [p for section in doc["full_text"] for p in section["paragraphs"]]
    sentences, groups = [], defaultdict(list)
    for paragraph in paragraphs:
        parts = [s.strip() for s in re.split(r"(?<=[.!?])\s+", paragraph) if s.strip()]
        groups[norm(paragraph)].extend(range(len(sentences), len(sentences) + len(parts)))
        sentences.extend(parts)
    return sentences, groups


def reference(qa, sentences, groups):
    answers = [v["answer"] for v in qa["answers"]]
    if not answers:
        return None, "no_annotations"
    if all(a["unanswerable"] for a in answers):
        return ([], []), "absent"
    if any(a["unanswerable"] for a in answers):
        return None, "disagreement"
    hits, evidence = set(), set()
    for a in answers:
        if len(a["extractive_spans"]) != 1:
            continue
        needle = norm(a["extractive_spans"][0])
        if not needle:
            continue
        pattern = re.compile(r"(?<!\w)" + re.escape(needle) + r"(?!\w)")
        indices = {i for p in a["evidence"] for i in groups.get(norm(p), [])}
        aligned = {i for i in indices if pattern.search(norm(sentences[i]))}
        if aligned:
            hits.update(aligned)
            evidence.update(indices)
    return ((sorted(hits), sorted(evidence)), "supported") if hits else (None, "no_single_aligned_span")


def choose(corpus):
    questions, documents, exclusions = [], {}, Counter()
    for doc_id, doc in corpus.items():
        if not TOPIC.search(doc["title"]) or EXCLUDED.search(doc["title"]):
            continue
        sentences, groups = passages(doc)
        if len(sentences) < 40:
            exclusions["short_document"] += 1
            continue
        documents[doc_id] = sentences
        for qa in doc["qas"]:
            ref, status = reference(qa, sentences, groups)
            exclusions[status] += 1
            if ref is not None:
                gold, evidence = ref
                questions.append(dict(id=qa["question_id"], document=doc_id, question=qa["question"],
                                      gold=gold, evidence=evidence, kind=status))
    selected, per_doc, totals = [], Counter(), Counter()
    if len(set(q["id"] for q in questions)) != len(questions):
        raise ValueError("Duplicate question ID")
    for q in sorted(questions, key=lambda q: sha(q["id"].encode())):
        key = (q["kind"], q["document"])
        if per_doc[key] < 2 and totals[q["kind"]] < 24:
            per_doc[key] += 1
            totals[q["kind"]] += 1
            selected.append(q)
    if not totals["supported"] or not totals["absent"]:
        raise ValueError("Need both evaluation groups")
    return selected, {q["document"]:documents[q["document"]] for q in selected}, dict(exclusions)


def evaluate(question, sentences, nets):
    xs = features(question, sentences)
    scores = {name:[forward(net, x)[1] for x in xs] for name,net in nets.items()}
    lexical = [v[2] for v in xs]
    ix = lexical.index(max(lexical))
    choices = {name:pick(probs) for name,probs in scores.items()}
    choices["lexical"] = ix if lexical[ix] > .15 else -1
    return choices, scores["hard"]


def load_nets():
    return {k:json.loads(checked(HERE / ("hard.json" if k == "hard" else "student.json"), hash_))
            for k,hash_ in WEIGHTS.items()}


def run(corpus, out):
    cases, docs, inventory = choose(corpus)
    nets = load_nets()
    rows, expected = [], []
    counts = {k:Counter() for k in ("hard","soft","lexical")}
    for q in cases:
        sentences = docs[q["document"]]
        guesses, probs = evaluate(q["question"], sentences, nets)
        evidence = q["evidence"]
        restricted = {}
        if evidence:
            choices, _ = evaluate(q["question"], [sentences[i] for i in evidence], nets)
            restricted = {k:evidence[v] if v >= 0 else -1 for k,v in choices.items()}
        for k,v in guesses.items():
            if q["kind"] == "supported":
                outcome = "supported_correct" if v in q["gold"] else ("supported_refused" if v < 0 else "supported_wrong")
                if restricted[k] in q["gold"]:
                    counts[k]["restricted_correct"] += 1
            else:
                outcome = "absent_correct" if v < 0 else "absent_answered"
            counts[k][outcome] += 1
        rows.append(dict(id=q["id"], document=q["document"], kind=q["kind"], sentenceCount=len(sentences),
                         gold=q["gold"], evidence=evidence, choices=guesses, evidenceOnly=restricted,
                         selectedSentenceSHA256=sha(sentences[guesses["hard"]].encode()) if guesses["hard"] >= 0 else None))
        expected.append(dict(id=q["id"], index=guesses["hard"], scores=probs))
    lengths = list(map(len, docs.values()))
    report = dict(datasetSHA256=ARCHIVE_SHA, weights=WEIGHTS, source="QASPER v0.3 test, Dasigi et al. 2021",
                  inventory=inventory, documents=len(docs), groups=dict(Counter(q["kind"] for q in cases)),
                  sentencesPerPaper=dict(min=min(lengths), median=median(lengths), max=max(lengths)),
                  counts=counts, rows=rows)
    out.mkdir(exist_ok=True)
    dump = lambda name, obj: (out/name).write_text(json.dumps(obj,ensure_ascii=False,separators=(",",":"))+"\n")
    dump("report.json", report)
    dump("oracle.json", expected)
    # The local simulator input has no expected answers or teacher scores.
    dump("inputs.json", dict(documents=docs, questions=[{k:q[k] for k in ("id","document","question")} for q in cases]))
    print(json.dumps({k:v for k,v in report.items() if k != "rows"},indent=2))


if __name__ == "__main__":
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument("--archive", type=Path, required=True)
    cli.add_argument("--out", type=Path, required=True)
    args = cli.parse_args()
    run(load_corpus(args.archive), args.out)
