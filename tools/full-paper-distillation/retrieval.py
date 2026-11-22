"""Benchmark ranked evidence, with one query from each previously unused QASPER paper."""
import argparse
import hashlib
import json
from pathlib import Path

from experiment_full import BM25, choose, load_corpus
from benchmark import TOPIC, EXCLUDED, passages, reference


def fresh(corpus):
    _, used, _ = choose(corpus)
    eligible = []
    docs = {}
    for key, paper in corpus.items():
        if key in used or not TOPIC.search(paper["title"]) or EXCLUDED.search(paper["title"]):
            continue
        sentences, groups = passages(paper)
        if len(sentences) < 40:
            continue
        for qa in paper["qas"]:
            ref, kind = reference(qa,sentences,groups)
            if kind == "supported":
                eligible.append((qa["question_id"],key,qa["question"],ref[0]))
                docs[key]=sentences
    selected={}
    for q in sorted(eligible,key=lambda r:hashlib.sha256(r[0].encode()).hexdigest()):
        selected.setdefault(q[1],q)
        if len(selected)==24:
            break
    if not selected:
        raise ValueError("No independent documents")
    return selected.values(), docs, sorted(used)


class Encoder:
    def __init__(self, weights, tokenizer):
        import onnxruntime as ort
        from tokenizers import Tokenizer
        self.tokenizer=Tokenizer.from_file(str(tokenizer))
        self.tokenizer.enable_truncation(max_length=512)
        self.tokenizer.enable_padding(pad_id=0,pad_token="[PAD]")
        opts=ort.SessionOptions()
        opts.intra_op_num_threads=3
        self.session=ort.InferenceSession(str(weights),opts,providers=["CPUExecutionProvider"])

    def encode(self, texts, prefix):
        import numpy as np
        blocks=[]
        requested={v.name for v in self.session.get_inputs()}
        for start in range(0,len(texts),16):
            encoded=self.tokenizer.encode_batch([prefix+t for t in texts[start:start+16]])
            ids=np.asarray([e.ids for e in encoded],dtype=np.int64)
            mask=np.asarray([e.attention_mask for e in encoded],dtype=np.int64)
            inputs={"input_ids":ids,"attention_mask":mask,"token_type_ids":np.zeros_like(ids)}
            hidden=self.session.run(["last_hidden_state"],{k:inputs[k] for k in requested})[0]
            if hidden.ndim!=3 or not np.isfinite(hidden).all():
                raise ValueError("Unexpected encoder output")
            pooled=(hidden*mask[...,None]).sum(axis=1)/mask.sum(axis=1,keepdims=True)
            norms=np.linalg.norm(pooled,axis=1,keepdims=True)
            if (norms<=0).any():
                raise ValueError("Cannot normalize zero embedding")
            blocks.append(pooled/norms)
        return np.concatenate(blocks,axis=0)


def main():
    cli=argparse.ArgumentParser(description=__doc__)
    for name in ("archive","weights","tokenizer","out"):
        cli.add_argument("--"+name,type=Path,required=True)
    args=cli.parse_args()
    selected,docs,excluded=fresh(load_corpus(args.archive))
    model=Encoder(args.weights,args.tokenizer)
    rows=[]
    for qid,key,question,gold in selected:
        sentences=docs[key]
        bm=BM25(sentences).shortlist(question)
        query=model.encode([question],"query: ")[0]
        matrix=model.encode(sentences,"passage: ")
        sc=matrix@query
        dense=sorted(range(len(sc)),key=lambda ix:-sc[ix])[:5]
        rows.append(dict(id=qid,document=key,sentences=len(sentences),gold=gold,bm25=bm,e5=dense))
    counts={k:{f"at{n}":sum(bool(set(row[k][:n])&set(row["gold"])) for row in rows)
               for n in (1,5)} for k in ("bm25","e5")}
    out=dict(dataset="QASPER v0.3 test", model="Xenova/e5-small-v2",
             revision="02af79985278377e65c724a76275707cb0333c70",
             modelSHA256=hashlib.sha256(args.weights.read_bytes()).hexdigest(),
             tokenizerSHA256=hashlib.sha256(args.tokenizer.read_bytes()).hexdigest(),
             excludedDocuments=excluded, count=len(rows), counts=counts,rows=rows)
    args.out.write_text(json.dumps(out,indent=2)+"\n")
    print(json.dumps({"papers":len(rows),"counts":counts},indent=2))


if __name__=="__main__":
    main()
