"""Collect binary teacher probabilities, fit the selector, then open the held-out documents."""
import argparse
import hashlib
import json
import math
from pathlib import Path
from statistics import mean, median
import sys
import time
import urllib.request

from student import features, fit, pick, predict

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
sys.path.insert(0, str(HERE.parent / "passage-check"))
from server import local_server

TEACHER = "deepseek-r1-distill-qwen-1.5b-q4_k_m"
TEACHER_SHA = "1741e5b2d062b07acf048bf0d2c514dadf2a48f94e2b4aa0cfe069af3838ee2f"
PROMPT = """Read a source sentence. Decide if that sentence supplies the answer to the whole question.
Y means the requested information is given. N means some requested detail is missing.
Sentence: The ferry leaves at noon.
Question: When does the ferry depart?
Decision: Y
Sentence: The ferry leaves at noon.
Question: What is the price of a ferry ticket?
Decision: N
Sentence: {sentence}
Question: {question}
Decision:"""


def dump(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False) + "\n")


def digest(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def training_docs():
    source_path = ROOT / "docs/research/project-sources.json"
    sources = {s["id"]: s for s in json.loads(source_path.read_bytes())["sources"]}
    catalog = json.loads((HERE.parent / "source-answers/reviewed-questions.json").read_bytes())
    prompts = json.loads((HERE / "training-prompts.json").read_bytes())
    if set(catalog) != set(prompts) or set(catalog) != set(sources):
        raise ValueError("Source inventory differs from the reviewed training inventory")
    docs = []
    for key, entry in catalog.items():
        src = sources[key]
        ident = {k: src[k] for k in ("id", "url", "finding")}
        snapshot = json.dumps(ident, sort_keys=True, ensure_ascii=False, separators=(",", ":")).encode()
        choices = list(entry["questions"].values())
        if hashlib.sha256(snapshot).hexdigest() != entry["sourceSHA256"] or not all(s in src["finding"] for s in choices):
            raise ValueError("Changed source: " + key)
        questions = [(q, i) for i, q in enumerate(entry["questions"])]
        questions += [(q, i) for i, q in enumerate(prompts[key]["alternate"])]
        questions += [(q, -1) for q in prompts[key]["missing"]]
        if len(prompts[key]["alternate"]) != len(choices):
            raise ValueError("Missing paraphrase: " + key)
        docs.append(dict(id=key, url=src["url"], sentences=choices, questions=questions))
    return docs


def validate(docs, previous=()):
    for field in ("id", "url"):
        keys = [d[field] for d in [*previous, *docs]]
        if len(keys) != len(set(keys)):
            raise ValueError("Duplicate document " + field)
    def phrases(group, field):
        for doc in group:
            for value in doc[field]:
                yield (value[0] if field == "questions" else value).strip().casefold()
    for field in ("questions", "sentences"):
        rows = list(phrases(docs, field))
        if len(rows) != len(set(rows)) or set(rows).intersection(phrases(previous, field)):
            raise ValueError("Repeated " + field)
    for doc in docs:
        if not doc["sentences"] or any(not q or i not in range(-1, len(doc["sentences"])) for q, i in doc["questions"]):
            raise ValueError("Invalid question key")


def post(connection, path, data):
    client, port, key = connection
    req = urllib.request.Request(f"http://127.0.0.1:{port}/{path}", data=json.dumps(data).encode(),
                                headers={"Content-Type":"application/json", "Authorization":"Bearer " + key})
    with client.open(req, timeout=90) as response:
        return json.load(response)


def token_ids(connection):
    ids = {}
    for label in ("Y", "N"):
        tokens = post(connection, "tokenize", {"content":label, "add_special":False})["tokens"]
        if len(tokens) != 1:
            raise ValueError("Teacher decision must be a single token")
        ids[label] = tokens[0]
    return ids


def teach(connection, ids, question, sentence):
    prompt = PROMPT.format(sentence=sentence, question=question)
    # Add the same bias to both allowed labels. Relative odds are preserved.
    payload = dict(prompt=prompt, n_predict=1, n_probs=2, post_sampling_probs=True,
                   logit_bias=[[i, 80.0] for i in ids.values()], temperature=1.0,
                   top_k=0, top_p=1.0, min_p=0.0, repeat_penalty=1.0, seed=41,
                   samplers=["temperature"], cache_prompt=True)
    start = time.perf_counter()
    reply = post(connection, "completion", payload)
    elapsed = time.perf_counter() - start
    alternatives = reply["completion_probabilities"][0]["top_probs"]
    probs = {v["id"]: v["prob"] for v in alternatives}
    if set(probs) != set(ids.values()) or not all(math.isfinite(p) and 0 <= p <= 1 for p in probs.values()):
        raise ValueError("Expected probabilities for both pinned label tokens: " + repr(alternatives))
    total = sum(probs.values())
    if not 0.999 <= total <= 1.001:
        raise ValueError("Label probability mass is incomplete")
    return dict(probYes=probs[ids["Y"]]/total, alternatives=alternatives, sampled=reply["content"],
                promptSHA256=hashlib.sha256(prompt.encode()).hexdigest(), timeMs=elapsed*1000)


def collect(docs, connection, ids, output):
    rows = []
    with output.open("x") as file:
        for doc in docs:
            for question, gold in doc["questions"]:
                pairs = [teach(connection, ids, question, s) for s in doc["sentences"]]
                row = dict(source=doc["id"], url=doc["url"], question=question,
                           sentences=doc["sentences"], gold=gold, teacher=pairs)
                print(json.dumps(row, separators=(",", ":")), file=file, flush=True)
                rows.append(row)
    return rows


def log_odds(prob):
    prob = max(1e-9, min(1 - 1e-9, prob))
    return math.log(prob / (1 - prob))


def calibration(rows):
    """Equal-class midpoint of mean log odds, fit only to reviewed training pairs."""
    values = [[], []]
    for row in rows:
        for i, pair in enumerate(row["teacher"]):
            values[int(i == row["gold"])].append(log_odds(pair["probYes"]))
    if not all(values):
        raise ValueError("Both reviewed classes are required to calibrate the teacher")
    return (mean(values[0]) + mean(values[1])) / 2


def calibrated(prob, offset):
    return 1 / (1 + math.exp(offset - log_odds(prob)))


def learn(rows):
    all_gold, verified_gold, verified_soft = [], [], []
    offsets = {source: calibration([r for r in rows if r["source"] != source])
               for source in sorted({r["source"] for r in rows})}
    for row in rows:
        vectors = features(row["question"], row["sentences"])
        for i, (x, teacher) in enumerate(zip(vectors, row["teacher"])):
            y = int(i == row["gold"])
            prob = calibrated(teacher["probYes"], offsets[row["source"]])
            all_gold.append((x, y))
            if (prob > .5) == y:
                verified_gold.append((x, y))
                verified_soft.append((x, prob))
    stats = dict(totalPairs=len(all_gold), retainedPairs=len(verified_soft),
                 retainedPositive=sum(y for _, y in verified_gold),
                 retainedNegative=sum(1-y for _, y in verified_gold),
                 crossFittedOffsets=offsets, testOffset=calibration(rows))
    return {"student": fit(verified_soft), "hard": fit(verified_gold), "direct": fit(all_gold)}, stats


def score(rows, nets, offset):
    predictions = []
    names = ["rawTeacher", "teacher", "lexical", *nets]
    counts = {name: {"answerable":0, "absent":0} for name in names}
    student_time, teacher_time = [], []
    for row in rows:
        q, s, gold = row["question"], row["sentences"], row["gold"]
        raw_teacher = [t["probYes"] for t in row["teacher"]]
        lexical = [v[2] for v in features(q, s)]
        best = max(range(len(s)), key=lexical.__getitem__)
        decisions = {"rawTeacher":pick(raw_teacher), "teacher":pick([calibrated(p, offset) for p in raw_teacher]),
                     "lexical":best if lexical[best] > .15 else -1}
        teacher_time.append(sum(t["timeMs"] for t in row["teacher"]))
        for name, net in nets.items():
            start = time.perf_counter_ns()
            decisions[name] = pick(predict(net, q, s))
            if name == "student":
                student_time.append((time.perf_counter_ns()-start)/1e6)
        for name, decision in decisions.items():
            counts[name]["absent" if gold < 0 else "answerable"] += int(decision == gold)
        predictions.append(dict(source=row["source"], question=q, gold=gold, decisions=decisions,
                                studentQuote=s[decisions["student"]] if decisions["student"] >= 0 else "UNKNOWN"))
    passed = (all(counts["student"][k] >= counts["teacher"][k] for k in ("answerable","absent"))
              and sum(counts["student"].values()) > sum(counts["lexical"].values()))
    return dict(counts=counts, studentMeetsPilotTarget=passed, answers=sum(r["gold"] >= 0 for r in rows),
                absent=sum(r["gold"] < 0 for r in rows), predictions=predictions,
                medianTeacherMs=median(teacher_time), medianStudentMs=median(student_time))


def main():
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument("--gguf", type=Path, required=True)
    cli.add_argument("--llama-server", type=Path, required=True)
    cli.add_argument("--out", type=Path, required=True)
    args = cli.parse_args()
    if digest(args.gguf) != TEACHER_SHA:
        raise ValueError("Unexpected teacher model digest")
    args.out.mkdir(exist_ok=False)
    train = training_docs()
    validate(train)
    with local_server(args.gguf, args.llama_server.resolve(strict=True), TEACHER) as connection:
        ids = token_ids(connection)
        labeled = collect(train, connection, ids, args.out/"train.jsonl")
        nets, stats = learn(labeled)
        for name, net in nets.items():
            dump(args.out/(name+".json"), net)
        # Freeze the actual exported weights before opening the evaluation fixture.
        nets = {name:json.loads((args.out/(name+".json")).read_bytes()) for name in nets}
        heldout = json.loads((HERE/"heldout.json").read_bytes())
        validate(heldout, train)
        test = collect(heldout, connection, ids, args.out/"test.jsonl")
    result = score(test, nets, stats["testOffset"])
    result.update(training=stats, teacher=TEACHER, teacherSHA256=TEACHER_SHA, decisionTokenIDs=ids,
                  trainQuestions=len(labeled), trainSources=[d["id"] for d in train],
                  testSources=[d["id"] for d in heldout], studentBytes=(args.out/"student.json").stat().st_size,
                  studentSHA256=digest(args.out/"student.json"), testFixtureSHA256=digest(HERE/"heldout.json"))
    dump(args.out/"results.json", result)
    print(json.dumps({k:v for k,v in result.items() if k != "predictions"}, indent=2))


if __name__ == "__main__":
    main()
