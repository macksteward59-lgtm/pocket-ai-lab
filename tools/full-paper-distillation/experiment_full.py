"""Train a five-sentence reranker using source-excluded DeepSeek labels on QASPER train."""
import argparse
from collections import Counter
import hashlib
import json
import math
from pathlib import Path
import sys
import tarfile

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent/"long-document-reader"))
from benchmark import checked, choose, load_corpus, load_nets
from student import features, fit, forward, pick, words
sys.path.insert(0, str(HERE.parent/"public-source-distillation"))
from experiment import TEACHER, TEACHER_SHA, calibration, calibrated, local_server, token_ids, teach

DATA_SHA = "a28fdf966db827bcee3d873107d6b6669864fb7ca8fbf73a192f5e39191bdb5a"


def split_data(path, split):
    with tarfile.open(path, "r:gz") as arch:
        names = [m for m in arch.getmembers() if m.isfile() and Path(m.name).name.startswith("qasper-"+split+"-") and m.name.endswith(".json")]
        if len(names) != 1:
            raise ValueError("Missing unique split: "+split)
        return json.load(arch.extractfile(names[0]))


class BM25:
    def __init__(self, sentences):
        self.counts = [Counter(words(s)) for s in sentences]
        df = Counter()
        for row in self.counts:
            df.update(row.keys())
        size = len(sentences)
        self.idf = {w:math.log(1+(size-n+.5)/(n+.5)) for w,n in df.items()}
        avg = sum(sum(c.values()) for c in self.counts)/max(1,size)
        self.norm = [1.2*(.25+.75*sum(c.values())/max(avg,1e-10)) for c in self.counts]

    def shortlist(self, question):
        terms = sorted(set(words(question)) & self.idf.keys())
        scores = [sum(self.idf[w]*row[w]*2.2/(row[w]+self.norm[i]) for w in terms if w in row)
                  for i,row in enumerate(self.counts)]
        return sorted(range(len(scores)), key=lambda i:-scores[i])[:5]


def inputs_for_teacher(shortlist, gold):
    indices = list(shortlist)
    if not gold:
        return indices, [0], -1
    # Use one reference and the strongest nonreference competitor for fitting.
    correct = next((s for s in indices if s in gold), min(gold))
    if correct not in indices:
        indices[-1] = correct
    competitor = next((i for i,s in enumerate(indices) if s not in gold), None)
    selected = [indices.index(correct)]
    if competitor is not None:
        selected.append(competitor)
    return indices, selected, 0


def collect(qs, docs, connection, ids, out):
    index = {k:BM25(s) for k,s in docs.items()}
    rows = []
    with (out/"teacher-train.jsonl").open("x") as fh:
        for q in qs:
            s = docs[q["document"]]
            retrieved = index[q["document"]].shortlist(q["question"])
            indices, selected, gold = inputs_for_teacher(retrieved, q["gold"])
            vectors = features(q["question"], [s[i] for i in indices])
            labels = [teach(connection,ids,q["question"],s[indices[i]]) for i in selected]
            row = dict(id=q["id"], source=q["document"], gold=gold, teacher=labels, shortlist=retrieved,
                       candidates=indices, scored=[indices[i] for i in selected], referenceIndices=q["gold"],
                       x=[vectors[i] for i in selected])
            print(json.dumps(row,separators=(",",":")),file=fh,flush=True)
            rows.append(row)
    return rows


def train(rows):
    offsets = {d:calibration([r for r in rows if r["source"]!=d]) for d in {r["source"] for r in rows}}
    gold_pairs, hard, soft = [], [], []
    for r in rows:
        for i,(x,teacher) in enumerate(zip(r["x"],r["teacher"],strict=True)):
            y = int(i==r["gold"])
            p = calibrated(teacher["probYes"],offsets[r["source"]])
            gold_pairs.append((x,y))
            if (p>.5)==y:
                hard.append((x,y))
                soft.append((x,p))
    nets = {k:fit(v) for k,v in (("domainHard",hard),("domainSoft",soft),("direct",gold_pairs))}
    return nets, dict(total=len(gold_pairs), retained=len(hard), retainedPositive=sum(y for _,y in hard),
                      retainedNegative=sum(1-y for _,y in hard), offsets=offsets)


def evaluate(qs, docs, nets):
    indexes = {k:BM25(s) for k,s in docs.items()}
    counts = {k:Counter() for k in [*nets,"originalFull"]}
    recall=Counter()
    rows=[]
    for q in qs:
        s=docs[q["document"]]
        indices=indexes[q["document"]].shortlist(q["question"])
        xs=features(q["question"],[s[i] for i in indices])
        decisions={}
        for k,net in nets.items():
            i=pick([forward(net,x)[1] for x in xs])
            decisions[k]=indices[i] if i>=0 else -1
        decisions["originalFull"]=pick([forward(nets["originalShort"],x)[1] for x in features(q["question"],s)])
        gold=q["gold"]
        if gold:
            recall["at1"]+=int(indices[0] in gold)
            recall["at5"]+=int(bool(set(indices)&set(gold)))
        for k,i in decisions.items():
            if gold:
                outcome="supported_correct" if i in gold else ("supported_refused" if i<0 else "supported_wrong")
            else:
                outcome="absent_correct" if i<0 else "absent_answered"
            counts[k][outcome]+=1
        rows.append(dict(id=q["id"],document=q["document"],gold=gold,shortlist=indices,
                         decisions=decisions,sentenceCount=len(s)))
    return counts,recall,rows


def dump(path,obj):
    path.write_text(json.dumps(obj,sort_keys=True,separators=(",",":"),allow_nan=False)+"\n")


def main():
    cli=argparse.ArgumentParser(description=__doc__)
    for name in ("train-dev","test","gguf","llama-server","out"):
        cli.add_argument("--"+name,type=Path,required=True)
    args=cli.parse_args()
    checked(args.train_dev,DATA_SHA)
    with args.gguf.open("rb") as m:
        if hashlib.file_digest(m,"sha256").hexdigest()!=TEACHER_SHA:
            raise ValueError("Incorrect DeepSeek GGUF")
    args.out.mkdir(exist_ok=False)
    train_docs=split_data(args.train_dev,"train")
    qs,docs,inv=choose(train_docs)
    with local_server(args.gguf,args.llama_server.resolve(strict=True),TEACHER) as c:
        rows=collect(qs,docs,c,token_ids(c),args.out)
    nets,stats=train(rows)
    for k,net in nets.items():
        dump(args.out/(k+".json"),net)
    # Read the development labels only after the fitted models have been written.
    nets={k:json.loads((args.out/(k+".json")).read_bytes()) for k in nets}
    hashes={k:hashlib.sha256((args.out/(k+".json")).read_bytes()).hexdigest() for k in nets}
    dev_docs=split_data(args.train_dev,"dev")
    test_ids=set(load_corpus(args.test))
    if set(dev_docs)&set(train_docs) or test_ids&(set(dev_docs)|set(train_docs)):
        raise ValueError("Official splits share a paper ID")
    dev, papers, dev_inv=choose(dev_docs)
    if {q["id"] for q in qs}&{q["id"] for q in dev}:
        raise ValueError("Question IDs overlap")
    nets["originalShort"]=load_nets()["hard"]
    counts,recall,selected=evaluate(dev,papers,nets)
    ng=sum(bool(q["gold"]) for q in dev)
    gates={k:v["supported_correct"]*2>=ng and v["supported_wrong"]==0 and v["absent_answered"]==0
           for k,v in counts.items()}
    report=dict(trainDataSHA256=DATA_SHA, teacherSHA256=TEACHER_SHA, weights=hashes, trainQuestions=len(qs),
                training=stats, trainInventory=inv, trainDocuments=len(docs),devDocuments=len(papers),
                devInventory=dev_inv, supported=ng, absent=len(dev)-ng, counts=counts, recall=recall,
                meetsAnswerModeCriterion=gates, rows=selected)
    dump(args.out/"results.json",report)
    print(json.dumps({k:v for k,v in report.items() if k not in ("rows","training")},indent=2))


if __name__ == "__main__":
    main()
