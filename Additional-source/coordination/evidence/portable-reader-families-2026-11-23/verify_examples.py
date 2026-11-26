"""Check the archived reader blends and score every model using the Python reader."""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path


def load_json(path):
    return json.loads(path.read_bytes())


def parameters(net):
    return [value for row in net["weights"] for value in row] + net["biases"] + net["output"] + [net["intercept"]]


def predictions(reader, weights, documents):
    return [reader.pick(reader.predict(weights, question, doc["sentences"]))
            for doc in documents for question, _gold in doc["questions"]]


def score(indices, documents):
    gold = [index for doc in documents for _question, index in doc["questions"]]
    assert len(indices) == len(gold)
    return {"correct": sum(actual == expected for actual, expected in zip(indices, gold)), "total": len(gold)}


def check_pair(folder, reader, held_out, transfer):
    family_path = folder / "family.json"
    family = load_json(family_path)
    receipt = load_json(folder / "acceptance.json")
    assert hashlib.sha256(family_path.read_bytes()).hexdigest() == receipt["fileSHA256"] == receipt["offlineReExportSHA256"]
    rows = {item["id"]: item for item in family["readers"]}
    child = rows[family["root"]]
    left, right = [rows[child["run"][role]["id"]] for role in ("base", "second")]
    assert child["run"]["rightPercent"] == 35 and child["run"]["editedParameters"] == 0
    assert left["run"]["teacher"]["id"] == right["id"]
    p = child["run"]["rightPercent"]
    expected = [a if a == b else (a * (100-p) + b*p)/100 for a,b in
                zip(parameters(left["weights"]), parameters(right["weights"]))]
    assert len(expected) == 97 and parameters(child["weights"]) == expected

    roles = {"startingBase": rows[left["run"]["base"]["id"]], "sharedTeacher": right,
             "trainedParent": left, "blend": child}
    assert len({row["id"] for row in roles.values()}) == len(rows) == 4
    observed = {}
    for role, row in roles.items():
        local = predictions(reader, row["weights"], held_out)
        external = predictions(reader, row["weights"], transfer)
        observed[role] = {"id": row["id"], "heldOut": score(local, held_out),
                          "transfer": score(external, transfer), "transferChoices": external}
        if role == "blend":
            assert local[0] >= 0 and held_out[0]["sentences"][local[0]] == receipt["offlineChatAnswer"]
    for row, parent_roles in [(left, {"base": "startingBase", "teacher": "sharedTeacher", "candidate": "trainedParent"}),
                              (child, {"base": "trainedParent", "second": "sharedTeacher", "candidate": "blend"})]:
        for label, role in parent_roles.items():
            assert observed[role]["heldOut"] == row["run"]["scores"][label]
    return observed


def main():
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument("--workshop", type=Path, required=True, help="Checkout of the tested PR source")
    args = cli.parse_args()
    directory = Path(__file__).resolve().parent
    module = args.workshop / "tools/public-source-distillation/student.py"
    spec = importlib.util.spec_from_file_location("reader_reference", module)
    reader = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(reader)
    held_out = args.workshop / "apps/web/model-workshop/evaluation.json"
    transfer = directory.parent / "public-source-distillation-2026-11-22/transfer-questions.json"
    digest = hashlib.sha256(transfer.read_bytes()).hexdigest()
    assert digest == "b2ac6e95e0805575e15ad3e24d4189202d1786f01488d2b04a114d11c846c2aa"
    result = {"transferQuestionSHA256": digest, "families": {}}
    for direction in ("chromium-to-webkit", "webkit-to-chromium"):
        result["families"][direction] = check_pair(directory / direction, reader, load_json(held_out), load_json(transfer))
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
