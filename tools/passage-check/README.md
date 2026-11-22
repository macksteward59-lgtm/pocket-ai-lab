# Compare answers backed by passages

On Linux x86_64 run `bash tools/openclaw-review/run-linux.sh --compare-passages /tmp/pocket-study` with a new output directory. The command verifies the model and runtime downloads, starts a private CPU inference server, and saves the raw replies from all 54 requests. A server or transport failure makes the run incomplete. Answer quality is the exact-match count in each JSON report. The summary also reports exact abstentions and how many supported replies contain the expected value and finish with the right label. A longer or contradictory answer can satisfy that last diagnostic, so it never changes the strict score.

Each suite contains six questions. The first is shared with the iPhone. The second contains similar records and absent facts. Early unrestricted and citation-format runs on those two suites informed the design of the extractive mode. The third suite was committed before trying that mode. All suites and the grader retain their original answers. No answer key is sent to the model.

| Decoding mode | What the model can return |
| --- | --- |
| Unrestricted | Its normal text response |
| Citation grammar | A single line ending in a passage label, or UNKNOWN |
| Quoted span | Up to eight consecutive words extracted from one supplied passage and its matching label, or UNKNOWN |

The last mode can select the wrong phrase or an irrelevant passage. The grader requires the expected answer and the expected citation, and also grades refusals. Use this mode only for extractive questions. Compute broader research quality separately. The native application currently uses its ordinary model output.


## Compare a second server model

With the same b12608 Linux runtime, use a separate directory for the publisher's [Qwen2.5-3B-Instruct Q4_K_M file](https://huggingface.co/Qwen/Qwen2.5-3B-Instruct-GGUF/blob/7dabda4d13d513e3e842b20f0d435c732f172cbe/qwen2.5-3b-instruct-q4_k_m.gguf). The runner verifies its SHA-256 before starting. On the same host run the following command with the downloaded files. Each report records which model served the request.

```bash
python3 tools/passage-check/compare.py --model qwen2.5-3b-instruct-q4_k_m \
  --gguf /path/to/qwen2.5-3b-instruct-q4_k_m.gguf --llama-server /path/to/llama-server \
  --output-dir /tmp/pocket-study-3b
```

This comparison uses CPU inference. Its timing and memory use cannot establish that the 3B model fits an iPhone Air. The GitHub job uses the 1.5B reference by default.
