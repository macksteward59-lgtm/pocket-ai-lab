# Notebook answers and source selection

On November 22, 2026, the source-checked prototype gave the expected answer on 48 of 48 fresh notebook cases on each of Linux x86-64 and hosted Intel macOS. The same 48 cases ran on both operating systems. The program looked up the requested document ID before asking the model about its contents. When the record was missing, the lookup returned unknown without starting an inference request.

## Frozen word-choice comparison

[Draft #278](https://github.com/macksteward59-lgtm/pocket-ai-lab/pull/278), commit `f52e1b745bb3312ee4aaf566d7c7018ebef8e4ae`, kept the original 36 raw cedar/maple prompts and their strict letter parser. The two modes used identical prompts and a four-token ceiling. The candidate constrained replies to A or B. The prompt manifest SHA-256 was `95acbcd4237899a2234fd9c16f5e86823cec1595e6922c96cb54851d15432992`. The [hosted run](https://github.com/macksteward59-lgtm/pocket-ai-lab/actions/runs/45038005130) exercised two checksum-pinned models with llama.cpp b12233. All 144 response records were separately checked against the manifest and rescored from the raw text.

| Model and decoder | Valid letters / 36 | Original facts / 12 | Changed facts / 12 | Both answers right / 12 pairs | Blind key matches / 12 |
|---|---:|---:|---:|---:|---:|
| SmolLM2 135M, unrestricted | 0 | 0 | 0 | 0 | 0 |
| SmolLM2 135M, A/B | 36 | 8 | 6 | 2 | 6 |
| Qwen2.5 0.5B, unrestricted | 8 | 0 | 0 | 0 | 3 |
| Qwen2.5 0.5B, A/B | 36 | 12 | 12 | 12 | 6 |

The last column reports guesses against a hidden key when the prompt contained no fact. The original [native SmolLM2 result](https://github.com/macksteward59-lgtm/pocket-ai-lab/actions/runs/45031228658) remains 0/36. These figures describe separate Linux measurements.

## Fresh notebook cases

[Draft #279](https://github.com/macksteward59-lgtm/pocket-ai-lab/pull/279), commit `6fbc8b7740a321a14d9ece2115357575075edc77`, specified the vocabulary, policies, scoring and resource limits before CI drew seed `59004480b0c25ce9974266c67bba252f`. Each of 12 new word pairs had four conditions. A matching record supplied the original or flipped fact, no record was supplied, or the supplied record belonged to another note. The [Linux and Mac jobs](https://github.com/macksteward59-lgtm/pocket-ai-lab/actions/runs/45038507763) received byte-identical cases with SHA-256 `20f314edd4d0eb6e26619fc8b63bcab8602789965cb70b74d5b3a78488c150c3`. Both used the Qwen2.5-0.5B-Instruct Q4_K_M artifact `74a4da8c9fdbcd15bd1f6d01d621410d31c6fc00986f5eb687824e7b93d7a9db` on CPU.

| Policy | Linux correct / 48 | Mac correct / 48 | Model calls per host | Missing or unrelated notes |
|---|---:|---:|---:|---|
| Model can answer A or B | 24 | 24 | 48 | Guessed on all 24 |
| Model can answer A, B or unknown | 34 | 37 | 48 | Abstained on all 24, also missed supplied facts |
| Source lookup, then A/B model | 48 | 48 | 24 | Lookup returned unknown on all 24 |

Independent rescoring derived each expected answer from the actual source ID, stored word and choices. It checked 288 unique case-policy-host records and distinguished every model call from a lookup abstention. The fixed schema, two choices, known vocabulary and one fresh seed bound the finding. Accuracy on arbitrary questions requires its own evaluation.

## Existing project-source command

[Draft #280](https://github.com/macksteward59-lgtm/pocket-ai-lab/pull/280), commit `235bdfec1d76b6ae694b40c6ea985e62ce4894e1`, adds `--source-id` to the source-answer command. The SQLite search considers only the selected reviewed record. An exact request for another record, an absent record, or a search with no matching terms yields `UNKNOWN` without a model file or server. On a match, the CLI still checks whether the proposed quote occurs in the cited source. A quote can be irrelevant, so the output keeps `semanticSupportVerified` false.

Eight CLI/SQLite tests and five web index tests passed locally. Both the [hosted CLI checks](https://github.com/macksteward59-lgtm/pocket-ai-lab/actions/runs/45039193793) and [general CI](https://github.com/macksteward59-lgtm/pocket-ai-lab/actions/runs/45039190135) passed. In the positive CLI test, its existing pinned Qwen2.5 1.5B model produced a quote containing `10,000 neurons per day` from `CF-QUOTA`. Independent verification matched the returned text and source URL to the bundled register. The two no-source runs returned empty candidate lists, no model request ID and `UNKNOWN`. The published allowance can be checked independently in [Cloudflare's pricing documentation](https://developers.cloudflare.com/workers-ai/platform/pricing/).

## Original evidence archives

The following are byte-for-byte copies of the GitHub Actions ZIP files. They contain synthetic inputs, raw replies, or public-source CLI records.

| File | SHA-256 |
|---|---|
| [Frozen Linux results](frozen-linux.zip) | `16bfe307bdde6f30e305bb78de1c2fcb3268a503b1a1384b0dbf96b707e363c5` |
| [Fresh Linux results](fresh-linux.zip) | `ac90ed807c33097d7e63b9d3a7c83db0cfab5dd7a05e6551f4509afdd2122766` |
| [Fresh macOS results](fresh-macos.zip) | `8c2911431f7f4442d0c43be12274dc39cd62dee03f93363674ef14b83f04a6e1` |
| [Source CLI results](scoped-cli.zip) | `287c044c54e224539393354bf64b5a08a58653ace7da92fdd191b511a9303672` |

The three changes are draft PRs. The physical iPhone Air still needs a signed offline run and independently verified export. The earlier [unsigned kit and simulator export](https://github.com/macksteward59-lgtm/pocket-ai-lab/blob/9b404b75d9bf7d20483818034f355e03a08e963a/coordination/evidence/rls-v312-2026-11-22/V71-postgres.md#unsigned-iphone-kit-from-the-apple-hosted-build) document the current device boundary. The Cloudflare note for this research is `1f089190-19f3-4d40-b700-94afe5c432a8`.
