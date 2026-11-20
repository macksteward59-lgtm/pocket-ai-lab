# Frozen native text recipient benchmark

## Purpose and evidence boundary

This pilot measures whether the pinned recipient follows a small private fact
supplied as ordinary text through `NativeInferenceRuntime.generate`. It establishes
a behavioral reference before any learned mapping into the numerical-input API.
The host creates the messages and answer keys; there is no producer model, learned
mapper, GIE input, weight update, coordinator route, APEX decision or UI change.

The test exercises the existing model pool, scheduler and native text generation
path. A passing execution test means the fixed measurement completed with correct
provenance and cleanup. It imposes **no minimum model-quality score**. Poor answers,
malformed answers and no measured benefit from the message remain valid findings.

## Frozen version 1

| Setting | Value |
| --- | --- |
| Suite ID / version | `pocket-recipient-private-facts` / `1` |
| Seed | `0x50414C5245435631` |
| Generator | SplitMix64 with explicit wrapping UInt64 arithmetic |
| Cases / scheduled requests | 12 / 36 |
| Choices | `cedar`, `maple` |
| Prompt format | Plain ASCII, no chat template |
| Maximum prompt bytes | 512; actual message-present prompts are 195 bytes and absent prompts are 197 bytes |
| Generation | Temperature 0, at most 4 generated tokens, at most 128 output bytes |
| Context length in the real-model test | 512 |
| Runner budget | 900 monotonic seconds, checked between requests |
| Manifest size | 13,085 bytes |
| Manifest SHA-256 | `376b9eef0c0b6b935307a4e9b2ce48ad5780281a1944394ac7a174a40ca3a51d` |

The expected digest was computed before observing any model output. The canonical
manifest starts with `PAL-RECIPIENT-TEXT-MANIFEST-1` and a newline. Each ordered
field has `name:decimal-UTF8-byte-length`, a newline, the exact value bytes, and a
newline. Fields include the generator and parser rules, configuration, all case
keys, condition order, and every prompt byte. JSON encoder ordering is irrelevant
to this digest. Changing a prompt, key, order, parser or scoring rule requires a
new suite version and an explicitly recorded new manifest before its evaluation.

The six permutations of `correct`, `absent` and `counterfactual` are each crossed
with original answer A and original answer B. Option order swaps between
permutation pairs. Each nonce object ID consumes one independent PRNG draw and
does not use the answer key. Correct and counterfactual messages have equal byte
lengths. All 12 predetermined cases remain in the report; there is no case
selection, retry-until-correct or same-version prompt tuning after observation.

The first correct-message prompt is exactly the following ASCII text, with no
newline after the final colon:

```text
Read the message and answer the question.
Message: The stored word for OBJ-AB40EC30 is cedar.
Question: Which word is stored for OBJ-AB40EC30?
A: cedar
B: maple
Reply with exactly A or B.
Answer:
```

For the counterfactual condition, only `cedar` in the Message line changes to
`maple`. For the absent condition that line is
`Message: No stored word is supplied for OBJ-AB40EC30.` The query and choices are
otherwise unchanged. Case IDs, condition names, seed, execution ordinal and answer
keys never enter the model prompt. Object IDs are necessary task content, not
hidden answer labels. This is a frozen raw-text runtime test; it does not claim to
be the model's best achievable result under a chat template or a different prompt.

## Answers and metrics

The parser trims only ASCII space, tab, CR and LF at the two edges. The remaining
bytes must be exactly `A` or `B`. Lowercase letters, explanations, punctuation,
multiple answers, Unicode lookalikes and other Unicode whitespace are invalid.
An invalid output is retained verbatim and scores zero. A thrown generation call
has a separate `generationFailed` status, nil raw output, and its error string.
The runtime's throwing `generate` API does not expose any partial buffer.

Every condition uses the fixed denominator **12**, including invalid, failed or
unstarted rows. The report provides:

- **Correct-message accuracy:** the original private-fact answer under the
  correct message.
- **Absent-message accuracy:** that same original answer when the message does
  not supply the fact. A correct guess is possible; this is the control baseline.
- **Specific counterfactual-following rate:** the opposite answer explicitly
  supplied by the counterfactual message. Any arbitrary output change is
  insufficient.
- **Paired correct-only and absent-only counts:** cases where the correct arm
  succeeds and the absent arm fails, and the reverse. Their difference divided
  by 12 equals the correct-minus-absent accuracy difference.
- **Correct-and-counterfactual pair rate:** cases where both arms follow their
  own, opposite answer keys. This requires the exact intended answer switch.
- **Execution counts:** scheduled, attempted, completed, invalid-answer,
  generation-failed and not-run-for-budget rows.

Twelve cases form a small feasibility pilot, not a powered estimate of generalized
task quality. A useful result would require a measured message benefit and the
intended counterfactual behavior. Any subsequent task family, prompt format,
training split or acceptance threshold must be frozen separately. This pilot does
not establish cross-model transfer, GIE compatibility or a production route.

## Runtime, identity and cancellation

The public runner accepts an existing runtime and lease, the expected lowercase
64-hex model SHA-256, and an optional asynchronous, nonthrowing `onTrial` callback.
It checks the manifest and exact UTF-8 content-addressed descriptor/session IDs,
then streams the model file through SHA-256 before and after execution. The real
XCTest additionally hashes before model load and checks the repository's pinned
digest:

`2e8040ceae7815abe0dcb3540b9995eaa1fa0d2ca9e797d0a635ae4433c68c2d`

The file checks bind this harness to observed artifact bytes. They do not provide
an independent cryptographic attestation of weights already loaded in memory.
The real test loads that verified path itself, holds one exact lease, and uses
one runtime with one concurrent request for the entire sequential schedule.

The backend is `LlamaCppMetalBackend(requireMetal: false)`: **CPU-requested** with
requested GPU layers equal to zero. The actual offload report is recorded without
rewriting values. In particular, `-1` means the linked backend did not report the
number; it is not evidence of zero actual offload. The provider label comes from
the engine owned by the runtime. Fixture engines used in contract tests remain
`other`, never `llamaCpp`.

The runner delegates each request to the existing runtime admission, use-pin and
cancellation-drain behavior. `CancellationError`, native cancellation and model
pool/lease errors propagate. Other generation errors are recorded and the next
scheduled case still runs. There is no automatic alternative inference path.

The 900-second clock starts after manifest/model preflight verification. It
includes requests, callbacks and the final artifact hash, but excludes model load
and caller cleanup. The budget is not hard preemption of a native call. Once a
between-request check reaches the deadline, every remaining planned row is emitted
as `notRunBudget`, with nil request UUID and raw output; no such request is sent to
the model. A final deadline check also marks a run `budgetExceeded` if its last
request or hash crossed the budget, even when all requests were attempted. No
budget-exceeded run passes the complete-measurement CI gate. Per-request latency
covers the call and its runtime drain; it excludes callback serialization.

## Tests and CI evidence

`NativeRecipientTextBenchmarkContractTests.swift` uses explicitly controlled
engines through the actual runtime. It checks the frozen manifest and schedule,
strict parsing, counterfactual-specific scoring, fixed denominators, error
accounting, identity/artifact rejection, cancellation propagation and deterministic
budget exhaustion. Its injectable monotonic clock changes no public configuration
or frozen deadline.

`NativeRecipientTextBenchmarkTests.swift` runs the real pinned GGUF. It records a
start object containing the full manifest and native provenance, then writes an
escaped JSON trial record immediately after each call. Its final summary includes
the run, all raw rows, metrics, actual offload report and cleanup observations.
Model output is always JSON-encoded rather than concatenated into log syntax.

The native CI workflow builds the macOS test product once without selection
filters. It discovers the generated `.xctestrun` and test target, runs the existing
suite excluding this benchmark, then runs only the benchmark in a separate
20-minute step. The benchmark runs after a successful macOS test build whenever
the workflow has not been cancelled, including when the earlier regression suite
failed. The earlier failure remains part of the job result; neither step uses
`continue-on-error`. Each invocation starts a separate XCTest process, and the
benchmark creates its own runtime, model session and lease. The simulator has no
configured model and skips this new real-model test while running its contract
tests.

The first native run on `e47ca2126b2b3e5a067ebd4e44f1bef55f620951`
([#44733326466](https://github.com/macksteward59-lgtm/pocket-ai-lab/actions/runs/44733326466))
failed the pre-existing post-input greedy-text comparison before the benchmark
was scheduled. All 16 benchmark contract tests passed on both engine platforms,
but no real recipient requests ran. A/B/A numerical comparisons passed; that did
not prove ordinary text restoration. The initial ordinary result was reported as
33 characters, the post-input output had 34, and the assertion compared that
post-input ordinary text with an earlier capture-enabled generation. The cause of
the drift across the intervening sequence remains unresolved.

Test-only diagnostics now add two adjacent ordinary generations immediately
before A/B/A and assert their equality. The post-input ordinary result must match
that immediate control and still satisfy the original captured-text comparison.
`POCKET_LLAMA_TEXT_CONTROLS` emits exact JSON-escaped initial, captured and adjacent
ordinary outputs, plus computed match flags, before and after the intervention.
The numerical marker also reports observed booleans instead of unconditionally
printing `textAfter=passed` after a nonfatal XCTest assertion. These controls do
not change the native implementation or remove any prior assertion. The original
20-minute test limits and frozen recipient configuration remain unchanged.

A separate Python verification step preserves observed start/trial/summary JSONL
before checking completion. It decodes the length-prefixed manifest, independently
checks each prompt digest and answer key, reapplies the strict parser, recomputes
all metrics and requires 36 unique attempted requests. It also checks the pinned
model and llama.cpp revision, runtime identity and released/unloaded resources.
A zero-test selection, missing model, missing summary, generation error or partial
run therefore cannot count as successful benchmark execution. Invalid answers
alone do not fail the measurement gate.

The `native-recipient-text-<run-id>-<attempt>` Actions artifact contains incremental
JSONL, the raw XCTest log, capture counts, and (when complete) the canonical
manifest and independently verified summary. Upload runs after failure as well,
preserving any rows emitted before a timeout. Exact-head scores, execution times,
test totals and CI links belong in the PR and coordination record. Hosted Intel
macOS execution does not verify a physical iPhone Air or an Apple Silicon device.
