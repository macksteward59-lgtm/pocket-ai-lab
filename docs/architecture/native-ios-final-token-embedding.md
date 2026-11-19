# Native iOS Final-Token Embedding Export

## What is exported

The pinned llama.cpp API exposes `llama_get_embeddings_ith(ctx, -1)` when
context embedding extraction is enabled. Pocket AI Lab copies the final
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

The embedding carries the exact runtime session model ID. The native channel
also requires a host-supplied immutable model revision (normally a verified
model artifact digest) and binds both to the transfer. The embedding is model
output data. It is not evidence, an approval, an authorization token, or proof
that two agents can decode each other's vector. APEX/Director policy must still
authorize any transfer. The channel uses injected authorization, binary-store,
and replay-guard interfaces; its static authorization and in-memory adapters
are demonstration/test utilities, not production security controls.

## Validation and limitations

The pinned-GGUF XCTest smoke path now exercises both direct engine export and
the NativeInferenceRuntime API, checking non-empty text, a non-empty vector,
shape consistency, and finite values.

## Native same-model channel proof of concept

`NativeLatentChannel.swift` now connects the final-token embedding to a native
same-model affine int8 codec and out-of-band blob reference. It uses CryptoKit
SHA-256, checks task/conversation/sender/recipient/model-revision binding,
expiry, payload size, digest, and replay sequence before returning a decoded
vector. The Codable envelope contains metadata and a blob reference, not the
embedding bytes.

The native XCTest suite covers quantization error, payload size, model identity,
route mismatch, authorization denial, digest tampering, replay rejection, and
numeric edge cases. The pinned-GGUF smoke test also runs a real llama.cpp
embedding through encode/store/verify/decode using in-memory demonstration
adapters. This is a same-model proof of concept, not heterogeneous-model
alignment or production transport.

The simulator CI result is not a substitute for measuring memory, latency, or
Metal behavior on a physical iPhone. Durable storage, persistent replay
protection, a real APEX/Director authorization adapter, native app UI/agent
orchestration integration, and physical-device acceptance remain open gates.
