# Latent Agent Communication — Runtime v1

## Current status

The repository now contains a bounded TypeScript transfer runtime around the latent communication contract. It orchestrates an injected model-specific codec, host authorization, binary blob storage, SHA-256 verification, and an atomic replay guard. The runtime is not itself a hidden-state exporter, a trained cross-model alignment layer, or a production transport/storage adapter.

## Data path

1. The sender and recipient advertise explicit export/decode capabilities.
2. Negotiation requires an exact codec ID/version and shared dtype.
3. The codec must explicitly accept the bound encoder and decoder model identities and revisions. Similar model dimensions are not compatibility.
4. The sender encodes a bounded tensor, then asks the host policy to authorize the exact task, conversation, sender, recipient, codec, and byte count.
5. The host stores binary bytes outside the JSON MessageBus and returns a bounded blob reference plus SHA-256 digest.
6. The JSON control plane carries only the transfer envelope and blob reference.
7. The recipient validates route identity, expiry, model binding, capability, authorization, byte length, and digest before claiming the transfer ID and invoking the decoder.
8. A missing codec, capability, or send authorization returns null so the caller can use ordinary text. Receive-side integrity, authorization, or replay failures are hard errors and must not be silently retried as latent.

## Host obligations

Production hosts must provide durable or appropriately scoped blob storage, a cryptographic SHA-256 implementation, policy-backed authorization, and an atomic replay store. They must enforce quotas, cancellation, tenant isolation, retention/expiry, and access control on blob references. The in-memory test fixtures are not production adapters.

The host's authorization decision must remain under APEX/Director and the existing delegation/security gates. The model cannot grant itself permission. MessageBus v1 remains unchanged and does not carry tensor bytes.

## Codec and model limitations

A codec implementation is responsible for its numerical format and for preserving task-relevant information. The current runtime accepts codecs by injection; it does not include a trained quantizer or a cross-model latent alignment model. A generic int8 quantizer must not be assumed to make two different model latent spaces interoperable. Initially, codecs should be restricted to explicitly supported model pairs/revisions, with text fallback for every other pair.

Hidden-state extraction must be implemented by a native inference adapter that can expose the relevant layer/token activations without copying the full KV cache. This work must be separately validated for each backend (including llama.cpp/iOS); a model file being loaded does not prove activation export.

## Efficiency acceptance

Compare against a text-message baseline on the same tasks and hardware:
- serialized bytes including envelope/reference overhead;
- encode, storage, transfer, retrieval, and decode latency;
- task success and semantic distortion;
- peak resident memory and temporary buffer allocation;
- CPU/GPU/NPU compute and energy where measurable;
- KV-cache memory only if the implementation demonstrably changes KV-cache allocation or lifetime.

A lower payload size alone is not proof of lower hardware demand. Report median and p95 over repeated runs and include warm/cold behavior. Do not claim model-size or KV-cache reductions from communication compression.