# Native iOS Final-Token Embedding Export

## What is exported

The pinned llama.cpp API exposes `llama_get_embeddings_ith(ctx, -1)` when
context embedding extraction is enabled. Pocket AI Lab now copies the final
generated token's **last-layer output embedding** into caller-owned Swift
storage.

This is not a complete dump of every transformer layer's hidden states, and
it is not automatically a portable latent representation for a different
model. The model ID and revision must remain part of any downstream codec
negotiation.

## Memory and execution behavior

- The C bridge enables embedding extraction in the llama.cpp context.
- The bridge reserves one output row because the current decoder marks only
  the final token of each decode batch for logits output.
- Swift obtains the required output dimension, allocates a bounded buffer,
  copies the embedding while holding the native session lock, and rejects
  missing, empty, oversized, or non-finite vectors.
- The optional `LatentExportingLlamaEngine` capability leaves ordinary
  `LlamaEngine` implementations unchanged.
- `NativeInferenceRuntime.generateWithLatent` uses the same model lease,
  scheduler permit, cancellation drain, and output bounds as normal inference.

## Trust boundary

The embedding is model output data. It is not evidence, an approval, an
authorization token, or proof that two agents can decode each other's vector.
APEX/Director policy must still authorize any transfer. Codec compatibility,
integrity, expiry, replay protection, and recipient binding remain the
responsibility of the latent channel.

## Validation and limitations

The pinned-GGUF XCTest smoke path now exercises both direct engine export and
the NativeInferenceRuntime API, checking non-empty text, a non-empty vector,
shape consistency, and finite values.

The simulator CI result is not a substitute for measuring memory, latency, or
Metal behavior on a physical iPhone. The current same-model affine int8 codec
is a separate TypeScript POC; this Swift export does not yet feed a native
on-device compressor or binary transport.
