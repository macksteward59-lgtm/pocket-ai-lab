# DeepSeek local development qualification

This is an additive candidate experiment on the existing PR #234 native stack. It does not replace the frozen SmolLM recipient v1 or raw/chat calibration, select the default model, or accept a model on a physical iPhone. The existing numerical-input/GIE path still requires its separately supported architecture and learned compatibility; successful qwen2 text generation would not satisfy those conditions. ExploitGym remains a separate retained evaluation environment.

## Candidate and provenance

| Field | Frozen value |
| --- | --- |
| Model | DeepSeek-R1-Distill-Qwen-1.5B |
| Local ID | `deepseek-r1-distill-qwen-1.5b-q4_k_m` |
| Conversion | Bartowski community Q4_K_M; not a publisher-provided GGUF |
| Hugging Face repository | `bartowski/DeepSeek-R1-Distill-Qwen-1.5B-GGUF` |
| Revision | `9cc28b17e86fa2415fcb070f8ee5ec27c965aa61` |
| File | `DeepSeek-R1-Distill-Qwen-1.5B-Q4_K_M.gguf` |
| Bytes | `1117320800` |
| SHA-256 | `1741e5b2d062b07acf048bf0d2c514dadf2a48f94e2b4aa0cfe069af3838ee2f` |
| llama.cpp | `b12233`, commit `5f490d7bfe78844e6390c869454c149fd7e003a8` |
| Architecture | `qwen2`, 28 blocks, 1536 embedding width |
| Embedded template | 2237 UTF-8 bytes, SHA-256 `b6835114b7303ddd78919a82e4d9f7d8c26ed0d7dfc36beeb12d524f6144eab1` |

The original upload's [LFS pointer](https://huggingface.co/bartowski/DeepSeek-R1-Distill-Qwen-1.5B-GGUF/commit/755373c6eceff0e2f5ef39080d60154619779b2f) and the [selected immutable snapshot's metadata](https://huggingface.co/api/models/bartowski/DeepSeek-R1-Distill-Qwen-1.5B-GGUF/revision/9cc28b17e86fa2415fcb070f8ee5ec27c965aa61?blobs=true) agree on size and SHA-256. The Xet identifier is not the file SHA-256. Every actual download is independently hashed; remote pointer metadata alone is not local verification.

The [converter's README](https://huggingface.co/bartowski/DeepSeek-R1-Distill-Qwen-1.5B-GGUF/blob/9cc28b17e86fa2415fcb070f8ee5ec27c965aa61/README.md) identifies the upstream model but does not attest the exact upstream conversion commit. `upstreamConversionRevision` therefore remains null. Do not substitute the current upstream revision as historical conversion provenance.

[DeepSeek's release](https://huggingface.co/deepseek-ai/DeepSeek-R1-Distill-Qwen-1.5B) is MIT, with Apache-2.0 Qwen2.5-Math ancestry. The pin preserves that provenance and license links. The reviewed pin validator explicitly permits MIT and Apache-2.0; other license identifiers remain rejected. The older Apache smoke pins and default are unchanged. No weights are committed or redistributed by this PR.

## Reuse and acquisition

`scripts/local-gguf/fetch-smoke-gguf.mjs` still uses the existing selector and JSON output. Its new shared downloader incrementally hashes and writes an exclusive temporary file, rejects a body beyond the exact pinned byte count, and atomically installs the completed artifact only after size and hash verification. It rechecks cached files. Errors, redirects outside the approved HTTPS hosts, timeout and checksum mismatch do not replace the destination. Tests inject bounded byte streams; they do not access a model or network.

Explicit acquisition:

```bash
POCKET_GGUF_ID=deepseek-r1-distill-qwen-1.5b-q4_k_m \
  node scripts/local-gguf/fetch-smoke-gguf.mjs
```

This downloads weights, not a working app or a readiness receipt. The native importer and existing lifecycle remain responsible for their own verification and use.

## Precommitted invocation

The versioned `scripts/model-qualification/deepseek-r1-distill-qwen-1.5b-v1.json` declares eight development cases and exact expected answers before live inference. It is copied byte-for-byte into every run's artifact and bound by SHA-256 to preparation, native results and the independent audit. Its initial exact-byte SHA-256 is `ad2a548fba3f040877d236b6642b101d8d7389993156f74819747357bd7d9818`. It is not an unseen final test set.

- Context: 2048 tokens; maximum generation: 512 tokens per request; output cap: 16384 UTF-8 bytes.
- Temperature: zero/greedy, matching a controlled supported native profile. This differs from the original R1 publisher's recommended temperature around 0.6 and does not reproduce its full sampler.
- One user message, no system message. Native prompt bytes are `<｜User｜>` + the frozen question + `<｜Assistant｜><think>\n`.
- The caller omits a literal BOS because the existing native tokenizer uses `add_special=true, parse_special=true`, and this artifact declares `add_bos=true`. A real vocabulary-only preflight must observe exactly one BOS, correct role/thinking token IDs and byte-exact detokenization.
- The selected older GGUF template ends with `<｜Assistant｜>`. The experiment explicitly adds the original R1 recommendation's thinking prefix. It does not silently claim that the older embedded template already contains that suffix or substitute the current upstream template.
- The preflight also observes `llama_token_to_piece(..., special=false)`: the reasoning markers are USER_DEFINED and must remain visible; role/BOS/EOS CONTROL tokens must not appear in output pieces.
- Exactly one closing `</think>` separates the prefilled reasoning from the final answer. An emitted opening `<think>` is rejected. The entire final suffix must be a JSON object containing only an `answer` string. Duplicate keys, fences, extra prose, multiple objects or an unfinished boundary fail. JSON fragments inside reasoning are never selected as answers.
- Eight cases, one request per case, no retries. A monotonic 900-second budget is checked between requests and at run completion. It is not an interrupting per-request timer. The hosted experiment step also has an 18-minute hard timeout; interrupted jobs retain available logs and cannot pass integrity.

The tasks cover exact echo, arithmetic, supplied fact extraction, absent information with explicit UNKNOWN, a changed fact, both option orders and an untrusted instruction. This narrow development protocol is a candidate feasibility measurement, not a general success rate or security certification.

## Execution and independent gates

The new test-only `DeepSeekQualification*` files call existing `GGUFMetadataInspector`, `NativeInferenceRuntime.acquire`, `generateForEvaluation`, `release` and `unload`. No second runtime, production model route or inference implementation is introduced. The old ASCII/SmolLM tokenization probe remains unchanged; the additive candidate probe accepts prepared UTF-8 bytes, loads only vocabulary and creates no inference context.

The dedicated **DeepSeek Local Qualification** workflow checks out the exact pull-request head, reuses verified native dependency caches, builds the actual Swift package, verifies all eight named fixture tests ran, and then executes the optional real-model test on hosted Intel macOS CPU. Its permissions are read-only. It does not request model API credentials, paid inference or deployment.

Two gates remain distinct:

1. **Measurement integrity:** exact identities, unchanged model bytes, all eight records in order, distinct request IDs, correct prompt hashes, independent parser agreement, honest unknown telemetry and complete lease/model/scheduler cleanup. Partial, failed and incorrect outputs are retained.
2. **Development quality:** all eight requests completed and all eight final answers are valid and exactly correct. A complete measurement may fail this gate. Every unsuccessful case remains in the fixed denominator.

`prepare`, `tokenizer`, `verify` and `gate` subcommands in `qualification.py` implement the independent side. The existing bounded GGUF metadata reader is reused. Failed jobs upload their available raw logs, profile, pins, prompt bytes, tokenizer records, audit and source provenance. The native test does not convert a quality failure into a pass, and the workflow does not use `continue-on-error` to hide that gate.

## What the measurements mean

Recorded time covers native acquire/load and total generation duration per request. The backend currently emits one completed text buffer, so first-token latency, actual generated-token count and stop reason are explicitly null. A successful generation return cannot distinguish EOS from output-token/context exhaustion. Do not report tokens/second or assume EOS from these records.

Memory is `getrusage(RUSAGE_SELF).ru_maxrss` on Darwin, in bytes, measured in the inference XCTest process. It is that process's cumulative high-water RSS, not a per-trial incremental peak, file size, model-pool reservation or available phone memory. The 1600 MiB admission estimate and 4096 MiB experiment allowance are configuration values, not measurements. CPU offload observations are preserved; the run is not reported as Metal inference merely because the library can initialize Metal.

Hosted evidence does not establish physical-iPhone speed, thermal/battery behavior, signing/installability, production readiness, a learned GIE representation, cross-model latent compatibility, ExploitGym performance or APEX authority. A same-artifact full reference/native inference comparison and physical-device testing remain separate next gates. No model is promoted by this experiment. Model/profile choices must be compared on common held-out tasks before selecting a production default.

LittleBit remains a separately researched compression method, not the format of this Q4_K_M file and not an implemented runtime path.
