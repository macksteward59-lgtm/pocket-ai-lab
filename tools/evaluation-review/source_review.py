"""Verify one saved source review against its separately copied digest and local source register."""
import argparse
from datetime import datetime
import hashlib
import json
from pathlib import Path
import re

from verify import SHA256, unique_fields

ROOT = Path(__file__).resolve().parents[2]
REGISTER = ROOT / "docs/research/project-sources.json"
REGISTER_SHA256 = "6f619e398638c3695fc2bc8e589176d3222b684582c5b2b01c16aca273c959fd"
REVISION = "a13f2314652f5243296acf8d8c4d74e0349eda1b"
LIMIT = 128 * 1024


def read_small(path):
    with path.open("rb") as stream:
        data = stream.read(LIMIT + 1)
    if len(data) > LIMIT:
        raise ValueError("Review or original answer is too large")
    return data


def review(data, expected, original=None):
    def decode(value):
        return json.loads(value, object_pairs_hook=unique_fields)
    envelope = decode(data)
    payload = envelope["payloadJSON"]
    digest = hashlib.sha256(payload.encode()).hexdigest()
    if envelope["format"] != "pocket-ai-lab.source-review.v1" or digest != expected or digest != envelope["sha256"]:
        raise ValueError("Review differs from the separate SHA-256")
    body = decode(payload)
    draft, corrections = body["draft"], body["corrections"]
    register = REGISTER.read_bytes()
    if hashlib.sha256(register).hexdigest() != REGISTER_SHA256 or draft["registerRevision"] != REVISION:
        raise ValueError("Unexpected source register")
    source = draft["passage"]
    known = next((s for s in decode(register)["sources"] if s["id"] == source["id"]), None)
    if not known or any(source[k] != known[k] for k in ("url", "finding")):
        raise ValueError("Citation or source passage changed")
    if (not isinstance(draft["question"], str) or not draft["question"].strip() or
            not draft["model"] or not SHA256.fullmatch(draft["modelSHA256"]) or
            not re.fullmatch(r"[!-~]{1,128}", draft["requestID"]) or draft["origin"] not in ("imported", "localRuntime")):
        raise ValueError("Invalid source answer identity")
    if not isinstance(corrections, list) or len(corrections) > 32:
        raise ValueError("Invalid revision history")
    excerpts = [draft["excerpt"]]
    for edit in corrections:
        stamp = datetime.fromisoformat(edit["date"].replace("Z", "+00:00"))
        if stamp.tzinfo is None or edit["excerpt"] == excerpts[-1]:
            raise ValueError("Invalid correction record")
        excerpts.append(edit["excerpt"])
    if any(not isinstance(q, str) or not q.strip() or q not in known["finding"] for q in excerpts):
        raise ValueError("Uncited excerpt")
    if original is not None:
        observed = decode(original)
        retrieved = observed["retrieved"]
        ids = [entry["id"] for entry in retrieved]
        catalog = {s["id"]: s for s in decode(register)["sources"]}
        if (not 1 <= len(ids) <= 2 or len(set(ids)) != len(ids) or known["id"] not in ids or
                any(entry["id"] not in catalog or any(entry[k] != catalog[entry["id"]][k] for k in ("url", "finding"))
                    for entry in retrieved)):
            raise ValueError("Original retrieved passages differ from the register")
        label = ("[A]", "[B]")[ids.index(known["id"])]
        if (draft["origin"] != "imported" or observed["status"] != "quote_proposed" or
                observed["semanticSupportVerified"] is not False or observed["rawOutput"] != excerpts[0] + " " + label or
                any(observed[k] != draft[k] for k in ("question", "requestID", "model", "modelSHA256", "registerRevision")) or
                (observed["answer"], observed["source"], observed["sourceURL"]) != (excerpts[0], known["id"], known["url"])):
            raise ValueError("Original server reply differs from saved draft")
    return dict(digest=digest, question=draft["question"], requestID=draft["requestID"], origin=draft["origin"],
                source=known["id"], sourceURL=known["url"], original=excerpts[0], current=excerpts[-1],
                ownerRevisions=len(corrections), originalFileMatched=original is not None, hardwareVerified=False)


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("file", type=Path)
    ap.add_argument("--expected-digest", required=True)
    ap.add_argument("--original", type=Path)
    args = ap.parse_args()
    try:
        print(json.dumps(review(read_small(args.file), args.expected_digest,
                                read_small(args.original) if args.original else None), indent=2))
    except (KeyError, ValueError, TypeError, OSError, AttributeError, RecursionError) as error:
        ap.exit(1, f"Review failed: {error}\n")
