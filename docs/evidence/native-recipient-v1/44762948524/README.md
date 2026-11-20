# Frozen native recipient text benchmark v1 — run 44762948524

## Result and acceptance

This is the first completed schedule of the frozen v1 native recipient experiment. It is a negative result. All 36 requests were attempted: 32 returned text that failed the predefined exact A/B parser, and four failed with an empty-output backend error. Correct-message, absent-message, and counterfactual conditions each scored **0/12** using their original fixed denominators. Paired correct-only/absent-only counts and correct-plus-counterfactual answer-switch pairs were also zero.

The unchanged XCTest execution gate and independent CI verifier both **failed** because four generations failed. The independent audit in this directory passed its forensic consistency checks; that is not a replacement CI pass. The run summary's `status: completed` means the schedule finished within its budget, not that every generation succeeded.

| Condition | Scheduled | Invalid text returns | Generation errors | Strict score |
| --- | ---: | ---: | ---: | ---: |
| Correct message | 12 | 9 | 3 | 0/12 |
| Absent message | 12 | 12 | 0 | 0/12 |
| Counterfactual message | 12 | 11 | 1 | 0/12 |

Among the 32 text returns, 29 were the exact string `"\n\nWhat is"` and three were `" cedar\n\nWhat"`. Both strings are invalid under the frozen parser. Error ordinals were 6, 14, 26, and 29; each had null raw output and `backendFailed("llama.cpp returned empty text. No token was invented.")`. These records do not establish whether EOS, whitespace handling, or another mechanism caused the empty outputs.

## Provenance

- Repository: [macksteward59-lgtm/pocket-ai-lab](https://github.com/macksteward59-lgtm/pocket-ai-lab).
- Source: [`1a3a9d2813ab8d0a5a6c582b8b93144b63ee4bd5`](https://github.com/macksteward59-lgtm/pocket-ai-lab/commit/1a3a9d2813ab8d0a5a6c582b8b93144b63ee4bd5), draft [PR #232](https://github.com/macksteward59-lgtm/pocket-ai-lab/pull/232), stacked on PR #231.
- Hosted native [run 44762948524, attempt 1](https://github.com/macksteward59-lgtm/pocket-ai-lab/actions/runs/44762948524); job 136381812208. The source and generated PR merge tree were identical. At this evidence checkpoint the macOS regression suite had passed and the later iOS stages were still running. This directory makes no claim of overall workflow success.
- Actions artifact ID: `14644390151`; name: `native-recipient-text-44762948524-1`.
- Original ZIP: 30,021 bytes; SHA-256 `fcff992d7c15475909286797813c1aec1a8a5782dad825287a35c1d8f8dfc2df`. All six extracted members are preserved byte for byte below; the ZIP itself is not needed to read the evidence.
- Frozen manifest: 13,085 bytes; SHA-256 `376b9eef0c0b6b935307a4e9b2ce48ad5780281a1944394ac7a174a40ca3a51d`.
- Model: `SmolLM2-135M-Instruct-Q4_K_M.gguf`, 105,454,432 bytes; SHA-256 `2e8040ceae7815abe0dcb3540b9995eaa1fa0d2ca9e797d0a635ae4433c68c2d`. The source pin is `runtime/ios/pin/smoke-gguf.json` at the source commit above.
- Pinned llama.cpp revision: `5f490d7bfe78844e6390c869454c149fd7e003a8` (`b12233`).
- Run configuration: context 512, maximum 4 generated tokens, temperature 0, maximum output 128 bytes, maximum experiment duration 900 seconds. These were frozen before observing this output.

## Files and independent audit

The original artifact files are `native-recipient-text-xctest.log` and the five files under `native-recipient-text/`: capture status, manifest, start, trial, and summary records. Their bytes are unchanged. `audit.json` is a separately produced consistency report, not a modified benchmark output. `SHA256SUMS` binds all evidence members, this README, and the audit.

The audit verified the ZIP digest and size, matched each extracted member, reconstructed the canonical length-prefixed manifest and its seeded case/condition order, verified prompt digests and answer keys, checked 36 distinct UUIDs, and recomputed strict-byte parsing and every metric. It also matched incremental records against the raw XCTest log and final summary, and checked the pinned model, llama.cpp revision, generation configuration, offload report, and cleanup fields. The production benchmark source blob was unchanged from its original freeze through the measured source commit.

For the complete accounting and all 23 checks, see `audit.json`. Its original SHA-256 is `6d32b0a6d72560b237056c657daf936db8dac3a85916566c14818750cac85b46`.

## What the evidence does and does not establish

The C drain fixture and full macOS regression passed before this measurement. The benchmark ran through the actual llama.cpp provider with the pinned GGUF, requested CPU execution, and reported zero layers offloaded out of 31. A usable Metal device was present, but this is not evidence of GPU inference. After the benchmark, the caller lease was released; use pins, leases, active and queued requests, model lists, and reserved memory were all empty or zero.

The runner reported 9,477 milliseconds and XCTest reported 14.146 seconds for the test. These are descriptions of this hosted execution, not a performance comparison or physical-iPhone measurement.

The result does not establish useful private-fact communication, a working learned GIE mapper, or production readiness. It also does not establish why the outputs failed the format. The startup log truncates the model's chat template, so that log cannot supply the exact template for a follow-up experiment.

V1 remains frozen: do not change or rescore its prompts, parser, cases, model, generation limits, or acceptance gate after seeing these results. The next bounded step is metadata-only extraction of the pinned GGUF's complete chat template and tokenizer settings. Any later response-format pilot needs its own version and a manifest frozen before new model output is observed. This directory preserves the original negative measurement independently of expiring hosted-artifact retention.
