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
    base = AutoModelForCausalLM.from_pretrained(config["baseRepo"], revision=config["baseRevision"])
    baseline = evaluate(base, tokenizer, heldout_rows)
    model = get_peft_model(base, LoraConfig(
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
    step = 0
    while step < config["maxSteps"]:
        for row in train_rows:
            if step >= config["maxSteps"]:
                break
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
            batch, labels = completion_batch(tokenizer, row, config["sequenceLength"])
            loss = model(**batch, labels=labels).loss
            loss.backward()
            optimizer.step()
            optimizer.zero_grad(set_to_none=True)
            losses.append(float(loss.detach()))
            step += 1
            if time.time() - step_started > config["budgetSeconds"]:
                (out / "blocker.json").write_text(json.dumps({
                    "blocked": True,
                    "reason": "one step exceeded the whole time budget",
                    "stepSeconds": time.time() - step_started,
                    "authorized": False,
                }, indent=2), encoding="utf-8")
                return 4
    trained = evaluate(model, tokenizer, heldout_rows)
    report = {
        "baseRepo": config["baseRepo"],
        "baseRevision": config["baseRevision"],
        "license": config["license"],
        "steps": len(losses),
        "trainLossStart": losses[0] if losses else None,
        "trainLossEnd": losses[-1] if losses else None,
        "baselineExact": baseline["exact"],
        "heldoutExact": trained["exact"],
        "heldoutCount": len(heldout_rows),
        "baselinePredictions": baseline["predictions"],
        "predictions": trained["predictions"],
        "seconds": round(time.time() - started, 3),
        "authorized": False,
        "production": False,
        "eagle3": False,
    }
    (out / "metrics.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
    model.save_pretrained(out / "adapter")
    tokenizer.save_pretrained(out / "adapter")
    print(json.dumps({k: report[k] for k in ("steps", "trainLossStart", "trainLossEnd", "baselineExact", "heldoutExact", "heldoutCount", "seconds", "authorized")}))
    return 0


def completion_batch(tokenizer, row: dict, sequence_length: int):
    prompt = row["prompt"] + "\n"
    eos = tokenizer.eos_token or ""
    full = tokenizer(prompt + row["completion"] + eos, return_tensors="pt", truncation=True, max_length=sequence_length)
    prompt_ids = tokenizer(prompt, add_special_tokens=True).input_ids
    labels = full["input_ids"].clone()
    cut = min(len(prompt_ids), labels.shape[1] - 1)
    labels[0, :cut] = -100
    return full, labels


def evaluate(model, tokenizer, rows: list[dict]) -> dict:
    import torch
    model.eval()
    predictions = []
    with torch.no_grad():
        for row in rows:
            inputs = tokenizer(row["prompt"] + "\n", return_tensors="pt")
            generated = model.generate(**inputs, max_new_tokens=16, do_sample=False)
            text = tokenizer.decode(generated[0][inputs["input_ids"].shape[1]:], skip_special_tokens=True).strip()
            predictions.append({
                "id": row["id"],
                "expected": row["completion"],
                "prediction": text,
                "exact": text == row["completion"],
                "authorized": False,
            })
    return {"exact": sum(1 for item in predictions if item["exact"]), "predictions": predictions}


if __name__ == "__main__":
    raise SystemExit(main())
