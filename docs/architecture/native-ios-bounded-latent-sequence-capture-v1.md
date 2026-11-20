# Native iOS Bounded Latent Sequence Capture v1

## Status

Implementation contract for the next native milestone after final-token embedding export. This document does not claim the sequence API is implemented.

## Goal

Capture an ordered sequence of final-layer output embeddings for generated tokens from one llama.cpp inference call. The sequence is intended as input to the GIE temporal pooling and product-quantization prototype. It is not a complete dump of every transformer layer and is not automatically portable between model families.

## Capture semantics

- Capture only generated tokens, never prompt-prefill tokens.
- Capture a row only after the corresponding generated token has been decoded into the llama.cpp context.
- Preserve generation order exactly; row i corresponds to generated token i.
- Do not capture end-of-generation sentinel tokens that are sampled but not decoded.
- Keep llama.cpp n_outputs_max = 1 and n_outputs_max_per_seq = 1. Copy each generated row immediately into a bounded host buffer before the next decode overwrites the output row.
- The returned text and latent rows must come from the same inference request, model session, and generation.
- A sequence is complete only when generation completes successfully and the captured row count matches the number of decoded generated tokens. No partial sequence may be represented as complete.

## Hard bounds

Initial v1 defaults and ceilings:

| Bound | Value |
|---|---:|
| Maximum captured tokens | 256 |
| Maximum embedding dimension | 65,536 |
| Maximum latent host buffer | 16 MiB |
| Maximum output rows resident in llama.cpp context | 1 |

All multiplication and addition used to calculate allocation sizes must use checked arithmetic. Reject zero bounds, dimensions outside the ceiling, overflow, and any request whose tokenCount * embeddingDimension * sizeof(Float) exceeds the byte ceiling. The implementation must fail closed rather than silently truncate.

The maximum captured token count is independent of the model's generation maximum. If the caller requests more generated tokens than the latent capture bound, the sequence API must reject the request before inference or explicitly use a separately negotiated smaller generation limit. It must not run generation and later pretend a truncated sequence is complete.

## Cancellation and lifecycle

- The sequence buffer belongs to one native inference operation and is cleared on success, failure, cancellation, and session teardown.
- Cancellation must be observed between decode steps and must drain before the scheduler permit, model-use pin, or session lock is released.
- The Swift runtime must keep the exact model lease and scheduler permit for the entire generation and copy-out operation.
- No detached capture work may outlive the operation.
- A failed capture must not leak partial embeddings to the codec or message bus.

## Proposed API shape

The C bridge should expose an explicit bounded sequence-capture operation or a scoped capture configuration with:
- maximum token rows;
- maximum total bytes;
- query/copy access to token count and embedding dimension;
- caller-owned output storage or an explicitly owned temporary buffer;
- deterministic disable/clear behavior.

The Swift model should expose row-major data with shape [capturedTokenCount, embeddingDimension], model identity, text, and explicit token count. The runtime API should accept a maximum latent token count and maximum latent bytes and validate the result against those bounds before returning it.

## Validation

Required native tests:
1. A multi-token pinned-GGUF smoke test verifies non-empty text and at least two finite embedding rows.
2. The number of rows equals the number of generated tokens actually decoded, with no prompt rows.
3. Every row preserves order and matches a direct one-token capture reference for deterministic generation where the pinned runtime permits that comparison.
4. Zero, over-limit, and overflow dimensions fail before allocation.
5. A generation that would exceed the negotiated sequence cap fails without returning a partial-success sequence.
6. Cancellation during generation clears the sequence and drains before releasing the lease and scheduler permit.
7. Text-only/unlinked backends continue to fail closed for latent sequence export while ordinary text-only compatibility remains intact.
8. Swift and TypeScript agree on row-major shape, token spans, and fixture bytes before GIE is wired to live native output.

## GIE integration boundary

Native capture supplies ordered activation rows only. Temporal pooling, product quantization, residual quantization, codebook selection, and rate-distortion policy remain in the GIE codec layer. The codec must validate model ID/revision, embedding dimension, sequence length, codebook digest, and token-span metadata.

## Claims boundary

A smaller latent payload can reduce inter-agent communication bytes. It does not by itself reduce model weights, parameter count, KV-cache memory, attention compute, generation compute, or device-resident model memory. Those require separate measurements and optimizations. Acceptance must report payload bytes including envelope metadata, reconstruction distortion, downstream task quality, encode/decode latency, end-to-end transfer latency, and peak temporary memory. Physical iPhone measurements are required for device-performance claims.
