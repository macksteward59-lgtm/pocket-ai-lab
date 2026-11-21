# Synthetic word recall on Linux CPU

These files preserve the original Actions artifact ZIPs as base64. Decode a file with `base64 --decode`, check the archive SHA-256 against the table and open its JSONL file for the raw responses. All inputs use synthetic records.

| Archive | Source | SHA-256 of decoded ZIP |
| --- | --- | --- |
| initial.zip.base64 | [Historical prompts, two decoder arms](https://github.com/macksteward59-lgtm/pocket-ai-lab/actions/runs/44944403691) | `46fce23b0475fbee800a801041a359c681126baec9b525c06e1787810c349037` |
| fresh-smol.zip.base64 | [New balanced word pairs, SmolLM2](https://github.com/macksteward59-lgtm/pocket-ai-lab/actions/runs/44944736431) | `d1d8de4f26dfcf1a31eee21c720372ec32484852e771df6a2f3feed9d6d7681c` |
| fresh-qwen.zip.base64 | [New balanced word pairs, Qwen2.5](https://github.com/macksteward59-lgtm/pocket-ai-lab/actions/runs/44944736431) | `25b24afdeee575b077c7716733050e05941319dc87a4649e0546a8bd7eb14b53` |

On the new cards SmolLM2 chose A in all 36 attempts and followed both messages in 0/12 cases. Qwen2.5 followed both messages in 12/12 cases. When the message omitted the label, both models matched the hidden answer on 6/12 cards. All 72 responses were well formed. A second Linux run, using the same checked Qwen model and b12233 CPU runtime, produced a byte-identical 36-row trials file with SHA-256 `7817ace5a7f9d36356db6497d49be0f9016e24499c8756b8ff0e5e6aaca210b6`. The adjoining JSON file is its summary. All scores were also recomputed from the archived responses. The study covers one short English word-recall task. Physical iPhone Air performance and inference hosted by Cloudflare require separate evidence.
