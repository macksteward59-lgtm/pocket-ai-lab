# Complete format calibration with failed strict gate — 44777249548

[Workflow run 44777249548](https://github.com/macksteward59-lgtm/pocket-ai-lab/actions/runs/44777249548), attempt 1, **failed only the separate 36-of-36 chat response-format gate**. All 72 scheduled attempts were observed; measurement integrity passed.

## Immutable identities

| Identity | Value |
| --- | --- |
| Source PR | [#234](https://github.com/macksteward59-lgtm/pocket-ai-lab/pull/234) |
| Source commit | [`6a61281a1d28a6b8ee1a292c74f8515c2250d110`](https://github.com/macksteward59-lgtm/pocket-ai-lab/commit/6a61281a1d28a6b8ee1a292c74f8515c2250d110) |
| Actual PR merge checkout | `2fce444a03c5b74d836404d2022f6b39f921b692` |
| Source and merge tree | `44b48a0e9ef0b66cb14896ba3f2b4677132e4c57` |
| Native job | [136430313590](https://github.com/macksteward59-lgtm/pocket-ai-lab/actions/runs/44777249548/job/136430313590) |
| Evidence-contract job | [136430232585](https://github.com/macksteward59-lgtm/pocket-ai-lab/actions/runs/44777249548/job/136430232585) |
| General CI | [44777232870](https://github.com/macksteward59-lgtm/pocket-ai-lab/actions/runs/44777232870), attempt 1, job 136430175407 |

Full captured API metadata and source/merge identities are in [`run-metadata.json`](run-metadata.json).

## Measured result

| Measurement | Raw | Chat |
| --- | ---: | ---: |
| Observed attempts | 36 | 36 |
| Completed text returns | 32 | 36 |
| Generation errors | 4 | 0 |
| Completed outputs rejected by strict parser | 32 | 36 |
| Strict valid A/B answers | **0/36** | **0/36** |
| Correct / absent / counterfactual scores | 0/12 each | 0/12 each |
| Intended correct/counterfactual switches | 0/12 | 0/12 |

Raw output frequencies were `"\n\nWhat is"` ×29, `" cedar\n\nWhat"` ×3, and null ×4. The four error rows retained `backendFailed("llama.cpp returned empty text. No token was invented.")` at paired ordinals 12, 28, 52 and 57 (original source-trial ordinals 6, 14, 26 and 29). Chat output frequencies were `"B: maple"`, `"B: cedar"`, and `"No stored word is"` ×12 each. These remain invalid; no text was reinterpreted or rescored. All paired correct counts were zero.

[`evidence/audit.json`](evidence/audit.json) records `integritySuccess: true`, `metricsAreCompleteMeasurement: true`, and `chatFormatFeasible: false`. All 36 raw trial content records match [original v1 child run 44762948524](../../native-recipient-v1/44762948524/) excluding UUIDs and latency. The original v1 completion/error requirements and failed gates remain unchanged.

## Passed checks and limits

General CI, 43 Python evidence-contract tests, seven native fixture tests, the measurement XCTest, integrity, provenance and upload passed. The native cache was explicitly restored; the cache-save step was skipped. The only implementation change after the first source was the guarded Darwin feature-test macro; frozen experiment data, model, parser, settings and gates were unchanged.

The vocabulary-only probe emitted 75 records and verified all 72 exact token sequences and detokenizations, with raw counts 65–69 and chat counts 95–99. Effective add-BOS/add-EOS were false; the 368-byte template and marker IDs/counts matched. This establishes vocabulary-only tokenization under the pinned library; the production generation invocation itself was not instrumented by that probe.

All 72 request UUIDs were unique. The runner verified the same 105,454,432-byte model before and after measurement at SHA-256 `2e8040ceae7815abe0dcb3540b9995eaa1fa0d2ca9e797d0a635ae4433c68c2d`; llama.cpp was `5f490d7bfe78844e6390c869454c149fd7e003a8` (`b12233`). Provider was `llamaCpp`; requested/observed GPU offload were zero. Cleanup released the lease and recorded no loaded/pending/unloading models, leases, uses, requests, waits or reserved memory. This independent artifact audit did not download the model again.

The measured run recorded **22.073 seconds** (summed individual request latency: 20.949 seconds). The whole measurement XCTest reported **66.206 seconds**. These scopes differ and support no performance claim. This single hosted Mac run establishes no isolated cause of prior errors, useful private-fact or learned GIE communication, physical-device acceptance or production readiness.

## Preserved bytes

Original artifact `14650318847` (`recipient-format-calibration-44777249548-1`): **105,688 bytes**, SHA-256 `e501207e0fe98bdc919b6103b4b61233fa95026bb851509254636d7d73d5a0ac`. [`artifact.zip.base64`](artifact.zip.base64) reconstructs the exact ZIP with **90 members, including all 72 prompts**. [`artifact-members.json`](artifact-members.json) retains every member size and digest.

All non-prompt artifact members are also preserved separately. JSON/JSONL and small text/log files are copied verbatim. Artifact logs larger than 32,768 bytes and all three complete GitHub job logs are encoded as deterministic gzip plus Base64. These are complete logs, not excerpts. [`representation-index.json`](representation-index.json) maps each encoded file to its original path, byte size, SHA-256 and restoration path. The independent audit and capture metadata are unchanged; original scratch paths describe their capture location.

Every representation was decoded and compared byte-for-byte with its source, every ZIP member verified, and all direct copies checked. [`SHA256SUMS`](SHA256SUMS) covers every published file in this directory except itself. [Restoration instructions](../README.md#restoring-the-preserved-files) apply to either run. The independent consistency audit does not convert any failed gate to acceptance.
