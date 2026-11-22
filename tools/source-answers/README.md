# Ask about Pocket AI Lab project sources

For an offline answer from the project's reviewed catalog, list the questions for one source and pass a listed question back to the command. This uses Node SQLite and Python. No model or server is required.

```bash
python3 tools/source-answers/answer.py --source-id CF-QUOTA --list-reviewed
python3 tools/source-answers/answer.py --source-id CF-QUOTA --reviewed-only \
  --question "What is the published daily free allocation and reset time?"
```

The catalog covers 14 questions across eight public source summaries. A listed question returns its exact excerpt, publisher URL, and source revision fingerprint. For an unlisted question the command returns `UNKNOWN` and shows the questions it can answer. Copy a question as listed, including capitalization and punctuation. A change to the source ID, URL or finding requires a new review. These are excerpts of the project's reviewed summaries.

Ask a question about the bundled, reviewed public source summaries. This command uses the consumer app's SQLite search, takes up to two source records, then asks the local model for a short quoted answer with a source ID or UNKNOWN. It only reads the reviewed register. A quoted phrase can be irrelevant to the question. Each result carries the original finding, source link, register revision, model identity and a flag identifying semantic support as unverified.

Using Node 22.13+ or Node 24 and the pinned model and Linux runtime from [the comparison guide](../passage-check/README.md), run:

```bash
python3 tools/source-answers/answer.py --gguf /path/to/model.gguf --llama-server /path/to/llama-server \
  --question "At what time does the daily free neuron allocation reset?"
```

Use `--source-id CF-QUOTA` with a question to restrict retrieval and citations to that reviewed source. A missing ID, a decision ID, or a question with no search terms matching the selected record returns `UNKNOWN` before any model is loaded. For an empty lookup, the model file and server arguments are optional. A matching source can still contain a passage that does not answer the question, so the result keeps `semanticSupportVerified` false.

Add `--assess-support` to a question to try a second local model call on a proposed quote. When a proposed phrase identifies a single sentence, the command extends it to that exact sentence from the reviewed summary. This preserves details that can fall after the eight-word proposal limit. An ambiguous or cross-sentence phrase stays as quoted. The same model sees the question, the candidate quote and the reviewed summary. If it rejects the quote, the command returns `UNKNOWN` with status `insufficient_evidence`. The output retains the original phrase, assessed quote, source, verdict and both request IDs for review. An initial abstention skips the second call. Both decisions are model judgments.

Run `python3 tools/source-answers/compare_support.py --gguf /path/to/model.gguf --llama-server /path/to/llama-server` to compare both decisions on 12 fixed questions. All 12 must retrieve their selected record. The acceptance target is all six supplied facts with their required text and source, and all six missing facts answered with `UNKNOWN`. Add `--fixture transfer` for eight additional questions, with the same per-question criteria. The script records every reply, including misses. The workflow reports experiment completion and the quality result separately.

Use `--check` in place of `--question` to run the five frozen cases. The expected fact and source ID are both graded. Raw replies from completed inference and UNKNOWN decisions remain in the report. With the public Linux downloader, `bash tools/openclaw-review/run-linux.sh --compare-passages /tmp/pocket-comparison --include-source-answers` runs both studies and writes `source-answers.json` into a new output directory. The register contains published information. It has no access to the owner's account balance or phone sensors.
