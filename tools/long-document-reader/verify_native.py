"""Compare independently executed iOS scores with every frozen Python prediction."""
import argparse
import hashlib
import json
import math
from pathlib import Path
from statistics import median


def verify(reference, native):
    if native["platform"] != "iOS Simulator" or not native["os"]:
        raise ValueError("Missing simulator runtime evidence")
    rows = native["predictions"]
    if not rows or [r["id"] for r in rows] != [r["id"] for r in reference]:
        raise ValueError("Question IDs differ")
    maximum = 0.0
    total = 0
    records = []
    for actual, expected in zip(rows,reference):
        if actual["index"] != expected["index"] or len(actual["scores"]) != len(expected["scores"]):
            raise ValueError("Choice or number of candidates differs for "+actual["id"])
        if any(not math.isfinite(v) for v in actual["scores"]):
            raise ValueError("Nonfinite native score")
        error = max(abs(a-b) for a,b in zip(actual["scores"],expected["scores"]))
        if error > 1e-8:
            raise ValueError(f"Probability mismatch for {actual['id']}: {error}")
        maximum = max(maximum,error)
        total += len(actual["scores"])
        records.append(dict(id=actual["id"], index=actual["index"], candidates=len(actual["scores"]),
                            maxAbsError=error, milliseconds=actual["milliseconds"]))
    return dict(platform=native["platform"], os=native["os"], questions=len(rows), scores=total,
                maxAbsError=maximum, medianScoreMs=median(x["milliseconds"] for x in records), rows=records)


if __name__ == "__main__":
    cli = argparse.ArgumentParser(description=__doc__)
    for name in ("oracle","native","out"):
        cli.add_argument("--"+name,type=Path,required=True)
    args = cli.parse_args()
    report=verify(json.loads(args.oracle.read_bytes()),json.loads(args.native.read_bytes()))
    report["nativeOutputSHA256"]=hashlib.sha256(args.native.read_bytes()).hexdigest()
    args.out.write_text(json.dumps(report,indent=2)+"\n")
    print(json.dumps({k:v for k,v in report.items() if k!="rows"},indent=2))
