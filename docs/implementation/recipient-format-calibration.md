# Frozen recipient format calibration

## Question and scope

The frozen private-facts v1 benchmark returned 32 invalid-format outputs and four
generation errors in each of two preserved 36-request runs. Its failed acceptance
gates remain unchanged. The later metadata-only probe recovered the exact pinned
model's 368-byte chat template. The native bridge passes supplied prompt text
directly to the tokenizer; it does not render that template.

This separate experiment asks how the same recipient and private-fact questions
behave when the full declared chat template is supplied. It compares raw and
chat-formatted inputs concurrently using the original case content, answer keys,
strict A/B parser and generation limits. This is an exploratory formatting
comparison after a negative result, not an independent confirmation dataset.

Evidence preceding this experiment is preserved in [the coordination evidence
commit](https://github.com/macksteward59-lgtm/pocket-ai-lab/commit/c3272651cb643223658a781882bbcadf4ce2e9fe),
including both failed recipient runs, full native logs and the successful metadata
probe. No observed generation from this new experiment informed its manifest.

## Precommitted contract

| Setting | Frozen value |
| --- | --- |
| Suite / version | `pocket-recipient-format-calibration` / `1` |
| Manifest | `runtime/ios/Tests/LlamaEngineTests/Fixtures/recipient-format-calibration-v1.json` |
| Exact bytes | 44,072 |
| SHA-256 | `95acbcd4237899a2234fd9c16f5e86823cec1595e6922c96cb54851d15432992` |
| Source v1 manifest | `376b9eef0c0b6b935307a4e9b2ce48ad5780281a1944394ac7a174a40ca3a51d` |
| Cases / conditions / formats | 12 / correct, absent, counterfactual / raw, chat |
| Scheduled requests | 72, all fixed before generation |
| Context / tokens / output bound | 512 / 4 / 128 UTF-8 bytes |
| Temperature / requested GPU layers | 0 / 0 |
| Runner / maximum concurrency | Existing `NativeInferenceRuntime.generate` / 1 |
| Time budget | 900 monotonic seconds, checked between requests and after final hashing |
| Model SHA-256 | `2e8040ceae7815abe0dcb3540b9995eaa1fa0d2ca9e797d0a635ae4433c68c2d` |
| llama.cpp | `5f490d7bfe78844e6390c869454c149fd7e003a8` / `b12233` |

The original 36 source trials retain their original order. Each becomes a paired
raw/chat comparison: odd source ordinals run raw then chat; even ordinals run chat
then raw. Thus each format runs first 18 times. There are no retries, selectively
omitted cases, alternative providers, answer repairs or output-based prompt edits.

The chat input is the exact expansion of the declared template for one user
message with `add_generation_prompt=true`. It includes the model's default
system text, the user frame and the assistant prefix. This is a fixed expansion
for host-owned benchmark strings, not a general Jinja interpreter or a production
chat renderer. Its longest prompt is 345 ASCII bytes. The raw arm supplies the
unchanged source v1 prompt. New experiment identifiers and answer keys never enter
either prompt.

The treatment bundles role delimiters, default system content, assistant prefix
and additional input tokens. A measured difference cannot identify which element
caused it. Interleaving balances first/second position, but does not prove absence
of all runtime state or order effects. The result applies to this pinned small
model and these literal cases.

## Empirical input contract before generation

`Tests/RecipientTokenizationProbe/main.c` loads the pinned vocabulary with
`vocab_only=true`. It creates no context, performs no decode and samples nothing.
The wrapper verifies the complete model before and after the probe and checks
staged headers against the prepared pinned source. The existing build helper
supplies verified native archives.

The probe records effective BOS/EOS flags, relevant token IDs and attributes, the
exact loaded template bytes, isolated marker tokenizations with special parsing
on/off, and every planned prompt's complete token sequence. Prompt tokenization
uses the production switches `add_special=true, parse_special=true`. Inputs are
bounded, regular ASCII files without NUL; special-aware detokenization records
exact recovered bytes.

The independent preflight requires the exact template, effective automatic BOS
and EOS insertion both false, isolated delimiter IDs 1 and 2 under special
parsing, distinct ordinary parsing, and exact detokenized prompt bytes. Every
chat prompt must contain three start IDs and two end IDs; raw prompts must contain
neither. All inputs must fit the 512-token context with four generated-token
positions remaining. These are predetermined assertions to test, not observations
inferred from absent GGUF metadata. Any failure stops the experiment before model
generation. A complete JSONL stream does not override a failing probe process,
including a failed final model hash.

This establishes vocabulary-only input mechanics under the pinned library. It
does not capture the tokenizer inside the production generation invocation or
attest in-memory weights. The later experiment uses the unchanged production
bridge and separately hashes the model before load and before/after the schedule.

## Measurements and distinct gates

The parser trims only edge ASCII space, tab, CR and LF, then requires the entire
remaining output to be exactly `A` or `B`. Raw output is preserved exactly.
Malformed outputs score zero. Throwing requests retain null output and a separate
error string; the runtime does not expose a partial buffer. Cancellation and
invalid leases propagate. Unstarted budget rows remain in the fixed schedule.

**Measurement integrity** requires all 72 planned requests to be attempted once,
with exact prompt and identity binding, an accounted output or explicit generation
error, consistent incremental/final records, no budget expiry, and verified final
resource cleanup. Generation errors are measured negative outcomes in this new
comparison. This interpretation was fixed before new output; it does not alter
v1's stricter no-generation-error execution gate. Missing/partial/cancelled runs
cannot pass integrity.

**Chat response-format feasibility** is a separate CI step requiring all 36 chat
rows to complete and return a strict A/B answer with zero generation errors. The
raw arm remains a concurrent comparison and is not required to pass that gate.
A failed format gate fails the workflow. A correct letter format can still carry
the wrong answer, so this gate does not establish task quality.

Task scores remain descriptive: correct-message accuracy, absent-message
accuracy, specific counterfactual following and intended correct/counterfactual
answer switches use a fixed denominator of 12 for each format. Format validity
uses 36. Pairwise raw/chat differences use matched source cases and conditions;
failed and invalid rows remain zero. No task-quality threshold, production
promotion, GIE compatibility, learned mapping, efficiency gain or phone capability
is inferred from a format pass.

The 900-second budget includes request/drain time, callbacks and final model
hashing after preflight, excluding load and caller cleanup. It is not hard
preemption of an individual native call. The hosted experiment step adds an
18-minute outer limit and uploads observed partial evidence after failure.

## Execution and evidence

All new Swift code is test-only. `Package.swift` adds one test resource. Production
Swift and C, v1 benchmark files, model pins and existing workflow gates are
unchanged. The standalone workflow targets this stacked PR's base and `main`;
it does not rerun the full inherited native regression suite to relabel its result.

The workflow runs Python negative-fixture checks, a real vocabulary-only probe,
new Swift fixture tests, then the isolated 72-request real-model experiment. The
real XCTest is opt-in through the generated test plan; ordinary suites skip it.
It uses one verified model lease and the existing native scheduler. The provider
label comes from the runtime engine; fixture engines remain `other`.

START/TRIAL/SUMMARY JSON records are emitted incrementally with JSON escaping.
The Python verifier preserves observed records before checking integrity,
recomputes parsing and metrics, and checks model/manifest/native pin identity and
idle, released and unloaded resources. The artifact contains exact inputs, token
sequences, metadata, native logs, original pins, audits, and source/run/digest
provenance. It contains no model weights. Actual offload fields are retained;
unknown `-1` is not relabelled as measured zero.

Hosted execution is Intel macOS. It does not verify a physical iPhone Air or
Apple Silicon device. Source/fixture validation, empirical tokenization,
measurement completion, format feasibility and task scores must each be reported
with their own exact source/run result. Any new prompt, parser, schedule or
acceptance interpretation after observation requires a new experiment version.
