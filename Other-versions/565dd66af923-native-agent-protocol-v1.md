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

A proof is only a claim until a separately injected verifier authenticates it against the expected model ID and file hash. The native `Ed25519RuntimeProofVerifier` verifies signatures using a host-provisioned public-key registry, requires the key's runtime-build allowlist to contain the claimed build, and rejects unknown or duplicate key IDs, malformed/expired proofs, model/hash substitution, invalid signatures, and non-increasing generation counters for a session. The proof cannot add or rotate trust keys.

TypeScript and Swift share a canonical signing representation: ten UTF-8 fields in a fixed order, each prefixed by a 4-byte unsigned big-endian byte length. Paired tests pin the same Base64 fixture. Replay state is delegated to an injected `RuntimeProofReplayStore`; the iOS `KeychainRuntimeProofReplayStore` persists accepted key IDs and generation counters using device-only Keychain accessibility.

This is a verifier and replay-store primitive, not a production trust deployment. The app does not yet provision trusted public keys, a production runtime signer or key-rotation service does not exist, and the verifier is not wired into the app composition root. The replay store requires one process-wide writer; its read/compare/update sequence is not a cross-process compare-and-swap. Until those integration gates are complete, runtime trust remains Unverified.

## Readiness states

- `unavailable`: no trustworthy session proof is available.
- `loading`: runtime work is in progress; not eligible for inference.
- `ready`: proof is current and independently verified for the expected model and file.
- `expired`: proof expiry has passed; a new generation check is required.

A disconnect or unload must return the runtime to unavailable. A model file may remain on disk without being considered loaded.

## Governance boundary

APEX/East remains the independent authorization boundary. Neither task DTOs, messages, model output, runtime readiness, nor this protocol can approve consequential actions, mutate approval state, issue evidence receipts, or bypass human confirmation.
