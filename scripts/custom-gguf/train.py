"""Bounded experimental LoRA. This does not export a GGUF by itself.

A run that cannot load the pinned base, or that exceeds the time budget,
writes a blocker and exits without inventing weights. Output text is not
authorization. This is not EAGLE-3 training.
"""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def load_rows(name: str) -> list[dict]:
    rows = []
    for line in (ROOT / "data" / name).read_text(encoding="utf-8").splitlines():
        if line.strip():
            row = json.loads(line)
            if row.get("synthetic") is not True:
                raise SystemExit("Refusing a row that is not labeled synthetic")
            rows.append(row)
    return rows


def main() -> int:
    config = json.loads((ROOT / "config.json").read_text(encoding="utf-8"))
    train_rows = load_rows("train.jsonl")
    heldout_rows = load_rows("heldout.jsonl")
    out = Path(sys.argv[1] if len(sys.argv) > 1 else "models/custom-run")
    out.mkdir(parents=True, exist_ok=True)
    started = time.time()
    try:
        import torch
        from peft import LoraConfig, get_peft_model
        from transformers import AutoModelForCausalLM, AutoTokenizer
    except ImportError as error:
        (out / "blocker.json").write_text(json.dumps({
            "blocked": True,
            "reason": "training dependencies are not installed",
            "detail": str(error),
            "authorized": False,
        }, indent=2), encoding="utf-8")
        print(json.dumps({"blocked": True, "reason": "missing dependencies"}))
        return 3

    tokenizer = AutoTokenizer.from_pretrained(config["baseRepo"], revision=config["baseRevision"])
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token
    model = AutoModelForCausalLM.from_pretrained(config["baseRepo"], revision=config["baseRevision"])
    model = get_peft_model(model, LoraConfig(
        r=config["loraR"],
        lora_alpha=config["loraAlpha"],
        target_modules=["q_proj", "v_proj"],
        bias="none",
        task_type="CAUSAL_LM",
    ))
    model.train()
    optimizer = torch.optim.AdamW((p for p in model.parameters() if p.requires_grad), lr=config["learningRate"])
    losses = []
    deadline = started + config["budgetSeconds"]
    for step, row in enumerate(train_rows[: config["maxSteps"]]):
        if time.time() > deadline:
            (out / "blocker.json").write_text(json.dumps({
                "blocked": True,
                "reason": "time budget exhausted before max steps",
                "stepsCompleted": step,
                "losses": losses,
                "authorized": False,
            }, indent=2), encoding="utf-8")
            return 4
        step_started = time.time()
        text = row["prompt"] + "\n" + row["completion"]
        batch = tokenizer(text, return_tensors="pt", truncation=True, max_length=config["sequenceLength"])
        loss = model(**batch, labels=batch["input_ids"]).loss
        loss.backward()
        optimizer.step()
        optimizer.zero_grad(set_to_none=True)
        losses.append(float(loss.detach()))
        if time.time() - step_started > config["budgetSeconds"]:
            (out / "blocker.json").write_text(json.dumps({
                "blocked": True,
                "reason": "one step exceeded the whole time budget",
                "stepSeconds": time.time() - step_started,
                "authorized": False,
            }, indent=2), encoding="utf-8")
            return 4
    model.eval()
    predictions = []
    marker_hits = 0
    marker_total = 0
    with torch.no_grad():
        for row in heldout_rows:
            marker_total += 1 if row["completion"] == "POCKET-LAB-MARKER" else 0
            inputs = tokenizer(row["prompt"] + "\n", return_tensors="pt")
            generated = model.generate(**inputs, max_new_tokens=16, do_sample=False)
            text = tokenizer.decode(generated[0][inputs["input_ids"].shape[1]:], skip_special_tokens=True).strip()
            hit = text == row["completion"]
            if row["completion"] == "POCKET-LAB-MARKER":
                marker_hits += 1 if hit else 0
            predictions.append({
                "id": row["id"],
                "expected": row["completion"],
                "prediction": text,
                "exact": hit,
                "authorized": False,
            })
    report = {
        "baseRepo": config["baseRepo"],
        "baseRevision": config["baseRevision"],
        "license": config["license"],
        "steps": len(losses),
        "trainLossStart": losses[0] if losses else None,
        "trainLossEnd": losses[-1] if losses else None,
        "heldoutExact": sum(1 for item in predictions if item["exact"]),
        "heldoutCount": len(predictions),
        "markerExact": marker_hits,
        "markerCount": marker_total,
        "seconds": round(time.time() - started, 3),
        "predictions": predictions,
        "authorized": False,
        "production": False,
        "eagle3": False,
    }
    (out / "metrics.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    model.save_pretrained(out / "adapter")
    tokenizer.save_pretrained(out / "adapter")
    print(json.dumps({k: report[k] for k in ("steps", "trainLossStart", "trainLossEnd", "heldoutExact", "heldoutCount", "seconds", "authorized")}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
