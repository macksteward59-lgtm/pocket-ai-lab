# Unmeasured first format-calibration run — 44774751361

[Workflow run 44774751361](https://github.com/macksteward59-lgtm/pocket-ai-lab/actions/runs/44774751361), attempt 1, **failed before tokenization or generation**. Raw/chat quality and format are **unmeasured**; zero-filled partial metrics are not observed 0/36 scores.

## Immutable identities

| Identity | Value |
| --- | --- |
| Source PR | [#234](https://github.com/macksteward59-lgtm/pocket-ai-lab/pull/234) |
| Source commit | [`811b02646fc30cba4eea86dc53adecde208b7222`](https://github.com/macksteward59-lgtm/pocket-ai-lab/commit/811b02646fc30cba4eea86dc53adecde208b7222) |
| Actual PR merge checkout | `f27ce2295b0fa83239c28a87b5ddaff5fdbdaccf` |
| Source and merge tree | `c663bd1092db9b98756368a56f52003891501a7b` |
| Native job | [136421516995](https://github.com/macksteward59-lgtm/pocket-ai-lab/actions/runs/44774751361/job/136421516995) |
| Evidence-contract job | [136421457133](https://github.com/macksteward59-lgtm/pocket-ai-lab/actions/runs/44774751361/job/136421457133) |
| General CI | [44774739665](https://github.com/macksteward59-lgtm/pocket-ai-lab/actions/runs/44774739665), attempt 1, job 136421414557 |

Full captured API metadata and source/merge identities are in [`run-metadata.json`](run-metadata.json).

## Outcome and boundary

General CI and all 43 Python evidence-contract tests passed. Native dependencies rebuilt successfully after a cache miss; model/metadata verification and preparation of all 72 frozen prompts passed. Darwin compilation of the vocabulary-only probe then failed twice with `use of undeclared identifier 'O_NOFOLLOW'`, at `main.c` lines 95 and 214. [`tokenizer-stderr.log`](tokenizer-stderr.log) preserves the diagnostics.

Tokenizer stdout is empty. Its independent contract check failed; native fixture build/tests and the measurement XCTest were skipped. The always-run measurement capture failed for missing evidence and preserved **zero START, zero TRIAL and zero SUMMARY records**. The separate chat-format gate was skipped. Provenance capture and artifact upload passed.

No native vocabulary observation or inference occurred. The manifest, pins, partial audit and compiler failure remain exactly as captured. Original recipient v1 negatives and acceptance gates remain unchanged. The separately preserved [fixed run](../44777249548/) reached measurement; its scores do not replace this unmeasured result. The original first-run independent report retains the compiler cause as suspected at capture time.

## Preserved bytes

Original artifact `14650660530` (`recipient-format-calibration-44774751361-1`): **39,323 bytes**, SHA-256 `8e934e88330f6d47023e5112f911925b329ef6c626dd118397e8861dcb3cd819`. [`artifact.zip.base64`](artifact.zip.base64) reconstructs the exact ZIP with **87 members, including all 72 prompts**. [`artifact-members.json`](artifact-members.json) retains every member size and digest.

All non-prompt artifact members are also preserved separately. JSON/JSONL and small text/log files are copied verbatim. Artifact logs larger than 32,768 bytes and all three complete GitHub job logs are encoded as deterministic gzip plus Base64. These are complete logs, not excerpts. [`representation-index.json`](representation-index.json) maps each encoded file to its original path, byte size, SHA-256 and restoration path. The independent audit and capture metadata are unchanged; original scratch paths describe their capture location.

Every representation was decoded and compared byte-for-byte with its source, every ZIP member verified, and all direct copies checked. [`SHA256SUMS`](SHA256SUMS) covers every published file in this directory except itself. [Restoration instructions](../README.md#restoring-the-preserved-files) apply to either run. The independent consistency audit does not convert any failed gate to acceptance.
