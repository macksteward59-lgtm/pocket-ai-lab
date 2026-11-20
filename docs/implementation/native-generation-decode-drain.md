# Native generation decode drain

## Completion defect

The pinned llama.cpp revision is
`5f490d7bfe78844e6390c869454c149fd7e003a8` (`b12233`). Its decode operation can
return while backend computation and output copies are still queued. Output
getters synchronize automatically, but a successful decode return alone is not a
drain guarantee. The pinned implementation explicitly leaves the final
synchronization to output access:

- [Decode and synchronization implementation](https://github.com/ggml-org/llama.cpp/blob/5f490d7bfe78844e6390c869454c149fd7e003a8/src/llama-context.cpp).
- [Public API contract](https://github.com/ggml-org/llama.cpp/blob/5f490d7bfe78844e6390c869454c149fd7e003a8/include/llama.h).

The ordinary bridge generates its final requested token and decodes that token
before returning. Unlike intermediate sampling or successful embedding capture,
that final ordinary decode has no later output getter. Consequently the old
`decode_tokens` helper could return and allow the native mutex, Swift invocation
and model-use pin to be released while backend work was outstanding. A following
memory clear is not a substitute: `llama_memory_clear` delegates directly to the
memory implementation without synchronizing the context scheduler.

## Repair

The helper now calls `llama_synchronize(engine->ctx)` immediately after every
`llama_decode`, before disposing of the batch or checking cancellation and decode
errors. This ordering also drains an aborted or failed decode before returning
its error. A cancellation that arrives during synchronization is observed by the
existing subsequent atomic check, so it cannot publish a successful text result.

The existing native mutex and Swift invocation remain held throughout the drain.
No new cancellation identity, scheduler, model lifecycle or inference path is
introduced. The raw-input evaluator already uses an explicit synchronization at
the corresponding boundary.

This repair establishes completion semantics. It does **not** establish the cause
of PR #231's earlier greedy-text drift. That diagnostic branch retains its own
unchanged source revision and running CI. Its adjacent text controls, original
assertions and frozen recipient benchmark remain available in this child branch.

## Deterministic regression

`Tests/NativeBridgeDrainSmoke/main.c` compiles the actual production C translation
unit against the pinned public headers and a clearly declared fake backend. It
calls the public generation function; it does not copy the decode helper or check
source strings. The fixture marks native work outstanding at the final token's
decode and requires it to be drained before generation returns.

The required cases cover successful final-token generation followed by another
request's memory reset, an aborted decode (`2`), a fatal decode error (`-2`, as
defined by the pinned public API), and cancellation delivered during
synchronization. Error and
cancellation cases must return empty output. The fixture must fail against the
old implementation and pass against the repair without changing its assertions.
This is a simulated native-lifecycle test, not real GGUF or GPU evidence.

Run after the existing pinned-source verification has populated vendor headers:

```sh
bash runtime/ios/scripts/test-native-bridge-drain.sh
```

An explicit pinned-header directory can be passed as the first argument. Native
CI runs this fixture after its normal checksum-verified llama.cpp preparation,
then continues through the existing native build, XCTest and pinned-model gates.
The child PR's base branch is included in the native workflow's branch filter.

## Validation and limits

The same final fixture was compiled and executed on Linux with GCC 14.2.0 against
both the original production source and the repair:

| Production source | Fixture result |
| --- | --- |
| Parent `0a3bc9df657445de4433f534c597ebdea0a34725`, copied into an isolated temporary tree with `git show` | All four cases failed; 17 failed assertions |
| Repair with explicit synchronization | All four cases passed; zero failed assertions and no outstanding work |

The success case performs two generations and checks that the second request's
memory reset encounters no previous queued work. Abort, fatal-error and
in-drain cancellation cases require empty text and a nonempty error. Every case
checks batch and sampler cleanup. The test's checks remain active with `NDEBUG`.

All seven local public headers were independently compared byte for byte with
the exact pinned upstream revision. The observed `llama.h` SHA-256 was
`a806cb05ff2f218945acefc0d5e49681f41d76af5d7ef7613d954fc18c81fe2a`.
Linked and unlinked C11 syntax, Bash syntax, workflow YAML and embedded Python,
and whitespace checks passed. No local Apple compiler or Metal execution was
available. The Darwin dead-strip build remains a hosted CI gate.

Hosted compilation, real-model generation, unchanged text controls and complete
recipient evidence remain separate gates. Earlier passes on the parent commit
do not validate this runtime change. Ordinary request timing now includes the
final decode's completion; apparent timing differences must account for this
corrected completion boundary as well as any scheduling overhead.

Synchronization may change scheduling or add barrier overhead. No latency,
throughput or memory improvement is claimed. The hosted runners do not establish
physical iPhone Air or Apple Silicon acceptance. Frozen benchmark configuration,
model weights, GIE representation, APEX/East permissions and production routing
are unchanged.
