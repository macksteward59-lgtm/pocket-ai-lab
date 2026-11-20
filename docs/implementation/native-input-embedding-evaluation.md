# Native raw input-embedding evaluation

## Purpose and status

The native runtime now has an experimental operation for evaluating a bounded
matrix of explicitly supplied **first-layer model-input embeddings** and returning
the final position's full vocabulary logits. It uses the existing
`NativeInferenceRuntime`, model pool, scheduler and `LlamaCppMetalBackend` session.
It does not create another inference runtime.

This is an execution boundary for numerical experiments. It does not establish
that any sender representation communicates useful information to a recipient.
The initial C implementation supports GGUF `general.architecture = llama`, requires
a decoder without an encoder and a context with memory, and fails explicitly for
unsupported architecture, dimension or vocabulary limits. Other architectures
need their own validated support before this restriction is widened.

The implementation is based on the pinned public llama.cpp API at commit
`5f490d7bfe78844e6390c869454c149fd7e003a8`:

- [`llama_batch`](https://github.com/ggml-org/llama.cpp/blob/5f490d7bfe78844e6390c869454c149fd7e003a8/include/llama.h#L249-L274)
  accepts a row-major Float32 matrix in `embd` when `token` is null.
- [Loaded context and model getters](https://github.com/ggml-org/llama.cpp/blob/5f490d7bfe78844e6390c869454c149fd7e003a8/include/llama.h#L577-L625)
  distinguish `llama_model_n_embd_inp` from output width and expose actual context,
  batch and vocabulary bounds.
- [Batch allocation and decode](https://github.com/ggml-org/llama.cpp/blob/5f490d7bfe78844e6390c869454c149fd7e003a8/include/llama.h#L971-L1007)
  require explicit initialization and allow partial memory state after abort;
  this operation drains and clears it before returning.

No private/staging token-embedding export API is used.

## Representation contract

`NativeInputEmbeddingRequest` contains an immutable request UUID, exact model ID,
token-row count, input dimension and contiguous row-major values. There is no text
prompt, token lookup, automatic BOS, appended suffix, sampler or continuation.
The rows start at position zero in sequence zero. The result binds the request
UUID, model ID and input shape to an owned finite logits array.

GIE captures a different representation: its decoded segments are reconstructed,
pooled **final-layer output vectors**, not original token input embeddings or even
an unpooled token sequence. Equal dimensions or a matching model ID cannot turn
those vectors into the intended first-layer input representation. The new request
has no conversion initializer from GIE, and no coordinator routes GIE into it.

The optional `InputEmbeddingEvaluatingLlamaEngine` protocol reports capabilities
from the loaded engine. A model profile's capability strings neither enable the
operation nor provide evidence that it ran. Numerical input support also grants
no agent permission, APEX approval or evidence-signing authority.

## Admission and resource limits

| Quantity | Bound |
| --- | --- |
| Input token rows | At most 256, further clamped to the loaded sequence context, logical batch and physical microbatch capacities |
| Input row width | Actual `llama_model_n_embd_inp`, at most 8,192 |
| Input bytes | At most 16 MiB; row and width limits currently impose a stricter 8 MiB product ceiling |
| Output logits | Exactly the loaded vocabulary size, at most 262,144 Float32 values (1 MiB) |
| Sequences / decode batches | One sequence, one batch per evaluation |
| Requested output positions | Final input row only |

Swift validates cheap shape, overflow, finite-value and identity checks before
inference. It validates the backend's capability metadata before allocating or
accepting output. Model identity comparisons use exact UTF-8 bytes, including
request, lease descriptor, lease session and the actual stored native model ID.

The C boundary independently validates pointers, cardinality, actual width,
context/batch/byte bounds, all finite inputs and the full output capacity **before
changing model context**. It initializes all used batch metadata, runs decode,
synchronizes native work, reads logits only after successful decode with an
explicitly marked final row, validates finite values, and copies them into caller
storage. The operation clears model memory before and after evaluation. It does
not preserve an input prefix for future generation.

An error publishes no successful result. The C output count stays zero on failure,
and any logits copied during a subsequently cancelled operation are cleared. Swift
does not return the buffer on failure. Unsupported capability, malformed requests,
malformed backend metadata and malformed output have distinct runtime errors;
there is no automatic text fallback.

## Scheduling, cancellation and unload

The public runtime methods use the exact active model lease and existing scheduler.
Evaluation queries capabilities directly within its existing permit, avoiding a
nested admission request. It holds the model use pin and scheduler permit through
the operation and cancellation drain, then releases them on success or failure.

The backend registers the detached task alongside its other native operations.
`cancelAndWait`, `unload` and normal completion all handle that task. Cancellation
identity is request-specific; automatic cancellation handlers and cleanup also use
a fresh internal invocation token, so reusing a public request UUID cannot let an
old handler cancel or erase a later invocation. Explicit drain clears the matching
task registry before returning. Cancellation is reset on the actor before launching
work, never inside the worker. Active task registries preserve exclusivity after
the request identity has been cancelled; unload also rejects new operations while
it drains existing work. Ordinary text and latent export use the same exclusivity
check, preventing a new request from clearing cancellation prematurely.

Cancellation is cooperative. The pinned native abort callback does not promise
immediate Metal interruption; the caller retains resources until native work has
finished and synchronization has completed. A successful metadata query starts no
inference work and needs no request-specific cancellation drain.

## Validation

`NativeInputEmbeddingRuntimeTests.swift` exercises the actual runtime/pool/scheduler
against declared controlled engines. It covers unsupported engines, exact lease
and byte identity, invalid shapes and finite values, backend-specific limits,
malformed capability/output metadata and cancellation/resource lifetime. Fixture
engines are not reported as llama.cpp execution.

The existing pinned-GGUF native runtime smoke additionally evaluates **A → B → A**
through the production runtime and native C bridge. A and B are small deterministic
non-collinear synthetic matrices, deliberately separate from the GIE output tested
earlier in the same smoke. Every result must have the exact finite vocabulary
shape. The maximum absolute logit difference between the two A evaluations must be
at most `1e-3`; the A/B difference must exceed both `1e-2` and 100 times the observed
A/A difference. The test then checks that ordinary greedy text generation still
matches the earlier text result, and verifies idle use pins/scheduler state plus
lease release and unload.

Successful execution emits `POCKET_LLAMA_INPUT_EMBEDDING` with the actual model
digest, row count, input width, vocabulary size, measured repeat/difference values
and post-evaluation text check. The full XCTest result must also pass: a marker
alone is not acceptance. Hosted simulator runs without the configured GGUF skip
the real-model smoke; the workflow's pinned-GGUF macOS phase must execute it.
Exact-head results belong in the PR and coordination log, not inferred from source.

Passing this experiment establishes that supplied raw numerical inputs affect
real model logits repeatably. It does not establish learned GIE compatibility,
semantic message transmission, cross-model transfer, held-out task quality,
production route authorization or physical iPhone Air performance. A validated
representation mapping and controlled comparison with the text path remain
necessary before a useful recipient route can be enabled.
