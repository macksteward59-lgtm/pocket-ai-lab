# Experimental fine-tune

This is a CPU LoRA demo on synthetic examples copied from the public trust rule. It is not a production Pocket AI Lab model and not EAGLE-3 training.

Base: `HuggingFaceTB/SmolLM2-135M-Instruct` revision `12fd25f77366fa6b3b4b768ec3050bf629380bac`, Apache-2.0.

```bash
python3 -m unittest discover -s scripts/custom-gguf -p 'test_*.py'
python3 scripts/custom-gguf/train.py models/custom-run
```

`train.py` needs PyTorch, Transformers, and PEFT in the environment that runs it. They are not Node dependencies. The script stops if those imports are missing or a step exceeds `budgetSeconds`. It writes `metrics.json` with `authorized: false`.

`export_guard.py` allows a later GGUF export only when held-out exact match is greater than the base model and the report does not set `authorized` to true. The run recorded in `observed-run.json` did not improve held-out exact match, so no custom GGUF was exported.
