# Ask about Pocket AI Lab project sources

Ask a question about the bundled, reviewed public source summaries. This command uses the consumer app's SQLite search, takes up to two source records, then asks the local model for a short quoted answer with a source ID or UNKNOWN. It only reads the reviewed register. A quoted phrase can be irrelevant to the question. Each result carries the original finding, source link, register revision, model identity and a flag identifying semantic support as unverified.

Using Node 22.13+ or Node 24 and the pinned model and Linux runtime from [the comparison guide](../passage-check/README.md), run:

```bash
python3 tools/source-answers/answer.py --gguf /path/to/model.gguf --llama-server /path/to/llama-server \
  --question "At what time does the daily free neuron allocation reset?"
```

Use `--check` in place of `--question` to run the five frozen cases. The expected fact and source ID are both graded. Raw replies from completed inference and UNKNOWN decisions remain in the report. With the public Linux downloader, `bash tools/openclaw-review/run-linux.sh --compare-passages /tmp/pocket-comparison --include-source-answers` runs both studies and writes `source-answers.json` into a new output directory. The register contains published information. It has no access to the owner's account balance or phone sensors.
