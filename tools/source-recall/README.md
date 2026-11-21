# Source selection and insufficient evidence

This development study checks a capability the earlier A/B benchmark could not score. Can Qwen answer a documentation question, select the supporting passage and decline the same question when the passage is missing?

Use the eight publisher-checked summaries recorded in [the project register](https://github.com/macksteward59-lgtm/pocket-ai-lab/blob/996d8ed1fc600e828f996ca59b506816e7a52c55/docs/research/project-sources.json). This tests reading a retrieved pair of passages. Open-web search and long-form synthesis are separate tasks.

## Frozen protocol

The six questions and answer keys in `questions.json` are fixed before inference. Each question occurs twice. In one condition the two excerpts include a supporting source. In the other, an unrelated excerpt replaces it in the same position. Three answer keys are A and three are B. Three supporting sources occupy slot 1 and three occupy slot 2. Alternate which condition runs first across questions. The model sees the question, answer options and two excerpt texts with numbered positions. It does not receive publisher IDs, condition labels or keys. A local grammar allows A1, A2, B1, B2 or U. U means that the two excerpts provide insufficient evidence. The grammar cannot select the correct code on the model's behalf.

Record all 12 outputs, including failures, under fixed denominators. Report correct option out of six, correct option with supporting citation out of six, evidence-absent abstentions out of six, and cases passing both the cited-answer and missing-evidence conditions out of six. Also count unsupported answers in the missing-evidence condition. The predeclared development threshold is at least 5/6 correct with citation, 5/6 correct abstentions and 5/6 full pairs, with 12 complete inferences. No retries, changes to the scoring key or tuning after observation. A completed measurement can have a negative outcome.

## Run on Linux x86_64

From the repository root run `bash tools/recipient-choice/run.sh /tmp/source-review source-review`, selecting an unused output directory. The existing launcher verifies the model and server release, starts a single loopback CPU process, then runs the study. The source snapshot is versioned in the coordination branch and its bytes are checked before use. The JSON output retains the source IDs, available excerpt slots, rendered prompt, actual output, stop reason, expected answer, scores and errors for each trial. The Actions summary and artifact use the same records.
