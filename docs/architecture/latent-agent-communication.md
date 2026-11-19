# Latent Agent Communication — Contract Prototype

## Status

This is a contract-only prototype. It does not implement hidden-state extraction,
compression, binary transport, decoding, or a production authorization adapter.
It must not be described as a working latent communication runtime or as a
measured efficiency improvement.

## Architecture boundary

- Keep Agent Message Protocol v1 and MessageBus as the JSON control plane.
- Keep latent tensors out of JSON message payloads. The control plane should carry
  only a bounded, integrity-addressed blob reference and transfer metadata.
- Use this separate, versioned latent channel for binary payloads. Do not add a
  new MessageBus message type until a deliberate cross-runtime protocol migration
  is designed; existing strict schemas reject unknown message types.
- APEX/Director remains the authority for whether a sender may transfer a
  representation to a particular recipient for a particular task.
- Missing runtime capability, codec compatibility, or authorization means
  fallback to ordinary text.

## Contract

The TypeScript prototype defines:
- Capability declarations, including explicit hidden-state-export support.
- Exact codec ID/version and dtype negotiation between encoder and decoder.
- Model identity/revision binding on both ends.
- Bounded tensor rank, element count, payload bytes, transfer identity, and TTL.
- A blob-store interface and model-specific codec interface.
- Validation that binds task, sender, and recipient before payload use.

No implementation may infer that two models share a compatible latent space
merely because they have similar dimensions or architecture names.

## Security and integrity gates before transport

A production adapter must:
1. Obtain authorization from the host policy layer for the exact task, sender,
   recipient, codec, and payload size.
2. Store bytes outside the JSON message bus and return a content-addressed or
   otherwise immutable blob reference with SHA-256.
3. Recheck byte length and digest after retrieval and before decoding.
4. Enforce expiry, replay protection, per-agent quotas, and cancellation.
5. Refuse decode when the negotiated codec/model revisions differ.
6. Fall back to text if the native runtime cannot export hidden states.

The current interfaces do not themselves enforce these host obligations.

## Efficiency measurement

Do not equate reduced message tokens with reduced KV-cache use, model weights,
compute, or latency. Benchmark separately:
- bytes transferred versus text baseline;
- end-to-end latency, including encode/decode;
- task success and semantic/reconstruction distortion;
- peak memory and compute cost;
- KV-cache use only when the inference runtime actually changes it.

No performance claim is made by this prototype. Cross-model codecs require
training/alignment and evaluation on the actual model pair and target device.
