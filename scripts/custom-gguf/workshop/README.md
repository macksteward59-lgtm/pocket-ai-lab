# Local language-model training

The Model workshop can run a small CPU LoRA experiment on two local language-model checkpoints. The base supplies the starting weights. The teacher scores yes/no continuations on six synthetic document records. Training retains confident decisions that agree with the authored labels, requires both classes, and fits the teacher's probabilities over 24 LoRA steps. A separate four-document comparison measures constrained yes/no accuracy for the base, teacher and reopened candidate. The saved artifact can answer prompts or become a parent for another build.

## Host setup

Use a POSIX host with Python 3.11 or 3.12. The tested CPU packages are installed with the following commands in a dedicated virtual environment.

```sh
python -m pip install --index-url https://download.pytorch.org/whl/cpu torch==2.8.0
python -m pip install transformers==4.55.4 peft==0.17.1 safetensors==0.6.2
```

Set `POCKET_TRAINING_DIR` to an absolute directory owned by the training host. Give it enough RAM for two in-memory representations of a loaded model plus the optimizer and workspace. The worker runs one operation at a time. Use host permissions to limit writes to the host operator and the worker. Place stable, fully materialized snapshot directories under `imports/<display name>/`. Each needs a regular `config.json`, `tokenizer.json`, and single unsharded `model.safetensors`. The supported family uses native dense Llama with SiLU and standard rotary attention, up to 160 million parameters. Each tokenizer must encode the two decisions as distinct single-token continuations. Keep source model cards, license details and upstream revisions alongside each import. Only the three runtime files participate in the artifact digest.

A partially trained model can supply starting weights. This recipe starts a fresh optimizer. Merged candidate weights and their parents, weight hashes, recipe, example counts and scores are saved under `candidates/`. Repeating the same named build with the same parents and package versions reopens its original result. Publication uses a same-filesystem directory rename after reloading and evaluating the candidate. Only host-prepared model files and bundled document examples are used. The inference operation produces up to 16 new tokens.

## Verification

```sh
python -m unittest discover -s scripts/custom-gguf/workshop -p 'test_*.py'
python scripts/custom-gguf/workshop/test_worker.py --make-fixtures /tmp/pocket-training-fixture
```

The second command requires a new or empty directory and creates two distinct tiny language-model checkpoints for browser acceptance. On the pinned CPU stack the teacher covered all six training records. The measured scores were 2/4 for the base, 4/4 for the teacher and 2/4 for the candidate. The test checks an actual attention-weight change, candidate generation after reload and a second generation of training. These four questions measure only this synthetic document task. Model selection for a real task needs fresh evaluation.
