# Native Agent Protocol v1

## Purpose

Define one wire contract for TypeScript and native Swift agent coordination. The protocol transports tasks, untrusted agent messages, and runtime readiness claims. It does not grant permissions, approve actions, issue receipts, or change APEX/East state.

## Canonical contract files

- TypeScript: `packages/intelligence/contracts/AgentProtocol.ts`
- Swift: `runtime/ios/Sources/PocketLlamaEngine/AgentProtocol.swift`
- Cross-runtime tests: `packages/intelligence/__tests__/agent-protocol.test.ts` and `runtime/ios/Tests/LlamaEngineTests/AgentProtocolTests.swift`

## Protocol version

Every task, message envelope, and runtime proof carries `protocolVersion: 1`. Unknown versions must be rejected rather than guessed or silently downgraded. Version changes require paired TypeScript/Swift contract tests.

## Task request

`protocolVersion`, `id`, `objective`, and `requiredCapabilities` are required. Unknown task fields are rejected by the TypeScript schema. A task is a request for computation, not an authorization voucher.

## Message envelope

The existing TypeScript `MessageBus` now requires `protocolVersion: 1` and all current publishers provide it; it continues to apply its message-type-specific payload validation and deep-freeze behavior. The shared DTO and native Swift envelope carry the same version field.

The envelope fields are stable across runtimes: `messageId`, `taskId`, `conversationId`, `senderAgentId`, `recipientAgentId`, `messageType`, `payload`, `evidenceRefs`, optional `parentMessageId`, `createdAt`, and monotonic per-task `sequence`. Payload validation remains message-type-specific in the existing MessageBus. Model-generated content is untrusted proposal data.

## Runtime readiness proof

A runtime proof binds:

- runtime session ID;
- requested model ID;
- SHA-256 of the exact model file;
- runtime build identity;
- expiry;
- monotonically increasing generation counter;
- key ID and Ed25519 signature.

A proof is only a claim until a separately injected verifier authenticates it against the expected model ID and file hash. The native `Ed25519RuntimeProofVerifier` verifies the Ed25519 signature with a host-provisioned public-key registry, requires the key's runtime-build allowlist to contain the claimed build, and rejects unknown/ambiguous key IDs, malformed or expired proofs, model/hash substitution, invalid signatures, and non-increasing generation counters for a session. The verifier never accepts keys from a proof or model output.

TypeScript and Swift share a canonical signing representation: the UTF-8 values `pocket-ai-runtime-session-proof-v1`, protocol version, session ID, model ID, lowercase model SHA-256, runtime build ID, expiry string, generation counter, key ID, and algorithm, in that order. Every value is prefixed by a 4-byte unsigned big-endian byte length. Paired tests pin the canonical byte encoding.

Replay state is delegated to an injected `RuntimeProofReplayStore`. The iOS `KeychainRuntimeProofReplayStore` persists the accepted key ID and generation in a device-only Keychain item and survives verifier recreation and ordinary app restarts. It is designed for one process-wide writer: its read/compare/update sequence is not a cross-process compare-and-swap. Storage failures reject verification. Trusted key provisioning/rotation, cross-process atomicity, session lifecycle invalidation, a private-key signer, hardware-backed key attestation, device attestation, and a production runtime key source remain separate gates.

## Readiness states

- `unavailable`: no trustworthy session proof is available.
- `loading`: runtime work is in progress; not eligible for inference.
- `ready`: proof is current and independently verified for the expected model and file.
- `expired`: proof expiry has passed; a new generation check is required.

A disconnect or unload must return the runtime to unavailable. A model file may remain on disk without being considered loaded.

## Governance boundary

APEX/East remains the independent authorization boundary. Neither task DTOs, messages, model output, runtime readiness, nor this protocol can approve consequential actions, mutate approval state, issue evidence receipts, or bypass human confirmation.
