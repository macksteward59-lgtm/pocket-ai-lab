# Pinned GGUF recipient template contract probe

## Why this probe exists

The first frozen native recipient v1 measurement attempted all 36 requests but returned 32 invalid-format text outputs and four empty-output backend errors. Each of the correct, absent, and counterfactual arms scored 0/12. The original execution gates failed. [The preserved evidence and independent audit](https://github.com/macksteward59-lgtm/pocket-ai-lab/tree/4d8880d4a598f0c617b6d80afa42468d0ed6cfd1/docs/evidence/native-recipient-v1/44762948524) retain that negative result without rescoring or changing the manifest.

The llama.cpp startup log truncates `tokenizer.chat_template`. It cannot establish the complete model input format, and the failed outputs alone do not establish which formatting or token-handling choice caused the failure. Before freezing a separately versioned response-format experiment, read the exact template and declared tokenizer settings from the already pinned model artifact.

This probe is a standalone metadata reader. It does not load tensors into an inference backend, tokenize a prompt, execute a template, generate text, or score a recipient answer. Its success cannot establish that a future prompt will follow the requested response format.

## Contract and scope

`runtime/ios/scripts/recipient_gguf_template.py` verifies the model's complete byte length and SHA-256 against the provided existing `runtime/ios/pin/smoke-gguf.json` before interpreting its metadata. The workflow uses the existing `build-llama-cpp.sh fetch-gguf` helper and the unchanged model pin. The model file is not committed or uploaded.

The parser accepts a bounded, explicitly supported GGUF metadata subset and rejects malformed or unsupported input. It preserves the exact UTF-8 chat-template bytes, exposes their length and SHA-256, and records declared tokenizer metadata and special-token IDs with their vocabulary strings. Missing optional settings remain unknown; the reader does not invent runtime defaults. A missing or invalid chat template fails the probe. Tensor payload validation and template execution are outside this reader's contract.

The source definitions are the public GGUF declarations and Python reader at the already pinned llama.cpp commit [`5f490d7bfe78844e6390c869454c149fd7e003a8`](https://github.com/ggml-org/llama.cpp/tree/5f490d7bfe78844e6390c869454c149fd7e003a8). See the reader's constants and validation errors for its exact supported versions, byte order, types, and bounds. It is deliberately not a general replacement for llama.cpp's GGUF loader.

The supported format is little-endian GGUF version 2 or 3 with flat metadata arrays. The reader retains at most 16 MiB from the same stream used for full-file hashing; this is a metadata-prefix budget, not a total process-memory claim. Other bounds include 4,096 metadata keys, 1 MiB strings, 16 KiB vocabulary strings, one million array elements, and 64 special-token declarations. Duplicate keys, invalid UTF-8, unsupported types, nested arrays, noncanonical Boolean values, truncation, and out-of-range special-token IDs fail the probe.

Alongside the template, the reader preserves declared tokenizer model and pretokenizer names, BOS/EOS insertion flags, space-prefix and whitespace-cleanup flags, and named special-token IDs with their exact vocabulary strings when available. Pin verification covers the entire file, including bytes beyond the captured metadata prefix. The report is published atomically only after validation and cannot overwrite the model or pin through a direct path, hard link, or symlink.

## Local fixture validation

Run the synthetic-format tests without a model download:

```sh
python3 -m unittest discover -s runtime/ios/scripts -p test_recipient_gguf_template.py -v
```

The fixtures test metadata decoding and rejection behavior. They do not represent actual model execution or prove compatibility with arbitrary GGUF files. The hosted workflow separately verifies extraction from the exact existing model artifact.

All 20 fixture tests passed before publication, including a literal wire-format fixture that does not reuse parser type constants, every truncated prefix of a representative metadata fixture, exact Unicode/newline preservation, pin mismatch outside metadata, type and resource bounds, alias protection, and transactional output failure. Workflow YAML, all three shell blocks, embedded Python syntax and whitespace checks also passed. Independent read-only review found no blocking workflow or scope issue; that review is not a formal GitHub approval or real-model extraction result.

With that artifact already available locally, run:

```sh
python3 runtime/ios/scripts/recipient_gguf_template.py \
  --model /absolute/path/to/SmolLM2-135M-Instruct-Q4_K_M.gguf \
  --pin runtime/ios/pin/smoke-gguf.json \
  --output /absolute/path/to/recipient-template-metadata.json
```

## Hosted metadata-only validation

`.github/workflows/recipient-template-contract-ci.yml` runs the fixture tests and bounded metadata extraction on Linux. It has read-only repository permissions and a 15-minute job limit. Model download has a five-minute limit; metadata extraction has a two-minute limit. The PR workflow targets the drain-repair branch or `main`; it does not require another native inference run.

The artifact includes the exact metadata report, unchanged model and llama.cpp pins, and a provenance JSON document with run ID, attempt, checked-out SHA, byte lengths and SHA-256 digests. The provenance explicitly states `realModelExecution: false`. The template remains data throughout. A CI summary reports extraction only and makes no claim about generation quality, phone performance, or v1 acceptance.

## Next experiment boundary

Preserve v1's prompt bytes, parser, answer keys, case order, model pin, token limit, scoring, and failed execution gate. This probe changes none of them, nor does it change the native bridge, provider, runtime route, model selection, or authorization behavior.

A subsequent response-format pilot must be a separate experiment version with a precommitted manifest, exact input-format contract, fixed generation settings and parser, explicit failure accounting, and a frozen interpretation of success before any new output is observed. The extracted template is evidence needed to specify that contract; applying it and proving the native tokenizer's handling of special tokens remain separate work. A metadata pass does not authorize a learned GIE mapping or production recipient route.
