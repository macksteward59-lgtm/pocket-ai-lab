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

## Compare an iPhone run with the hosted reference

Keep the six exported JSON files together in a new folder. In another file, save a JSON object mapping each case ID to the event SHA-256 copied independently from the app before exporting. All six attempts must use the same model session and model file. The checker detects a missing or repeated case, a changed export, a different model and a changed server report. A bad answer is retained and scored.

The [unaltered hosted report](https://github.com/macksteward59-lgtm/pocket-ai-lab/blob/agent-coordination/docs/evidence/source-recall/device-server-v1/hosted-linux.json) from run 44981550177 has the SHA-256 shown below. Save its raw JSON as `hosted-linux.json`. After collecting the phone exports, run this from the checkout containing this tool.

```bash
python3 tools/passage-check/device_comparison.py --exports ./phone-exports \
  --digests ./observed-digests.json --server ./hosted-linux.json \
  --server-sha256 22303c00da9a96e0a25872bfb2ef9c85839d2e7706c629fc9df21cedeceb861b
```

The output gives the expected answer, both actual answers and scores for each question. Only journal attempts reporting completed native execution can count toward the native total. Record the device, iOS version, app build, user-observed run, model hash, memory, thermals and recovery separately for physical-device acceptance. These exported files can be checked locally without publishing their contents.
