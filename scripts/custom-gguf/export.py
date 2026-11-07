"""Merge a passed LoRA into the pinned base and quantize Q4_K_M.

Refuses to run unless export_guard sees a held-out improvement and
authorized is not true. Does not rename an existing base GGUF.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

from export_guard import export_allowed

ROOT = Path(__file__).resolve().parent


def main() -> int:
    run = Path(sys.argv[1] if len(sys.argv) > 1 else "models/custom-run")
    metrics_path = run / "metrics.json"
    if not metrics_path.is_file():
        print(json.dumps({"exported": False, "reason": "metrics.json is missing"}))
        return 2
    metrics = json.loads(metrics_path.read_text(encoding="utf-8"))
    allowed, reason = export_allowed(metrics)
    if not allowed:
        print(json.dumps({"exported": False, "reason": reason, "authorized": False}))
        return 2
    config = json.loads((ROOT / "config.json").read_text(encoding="utf-8"))
    convert = Path(os.environ.get("LLAMA_CPP_CONVERT", "/tmp/llama.cpp/convert_hf_to_gguf.py"))
    quantize = Path(os.environ.get("LLAMA_QUANTIZE", "/tmp/llama-b12189/llama-quantize"))
    if not convert.is_file() or not quantize.is_file():
        print(json.dumps({"exported": False, "reason": "llama.cpp convert or quantize tool is missing", "authorized": False}))
        return 3
    from peft import PeftModel
    from transformers import AutoModelForCausalLM, AutoTokenizer
    merged_dir = run / "merged"
    if merged_dir.exists():
        shutil.rmtree(merged_dir)
    tokenizer = AutoTokenizer.from_pretrained(config["baseRepo"], revision=config["baseRevision"])
    base = AutoModelForCausalLM.from_pretrained(config["baseRepo"], revision=config["baseRevision"])
    merged = PeftModel.from_pretrained(base, run / "adapter").merge_and_unload()
    merged.save_pretrained(merged_dir)
    tokenizer.save_pretrained(merged_dir)
    f16 = run / "pocket-ai-lab-experimental-f16.gguf"
    q4 = run / "pocket-ai-lab-experimental-q4_k_m.gguf"
    subprocess.run([sys.executable, str(convert), str(merged_dir), "--outfile", str(f16), "--outtype", "f16"], check=True)
    lib = str(quantize.parent)
    env = os.environ.copy()
    env["LD_LIBRARY_PATH"] = lib + (":" + env["LD_LIBRARY_PATH"] if env.get("LD_LIBRARY_PATH") else "")
    subprocess.run([str(quantize), str(f16), str(q4), "Q4_K_M"], check=True, env=env)
    print(json.dumps({"exported": True, "path": str(q4), "authorized": False, "reason": reason}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
