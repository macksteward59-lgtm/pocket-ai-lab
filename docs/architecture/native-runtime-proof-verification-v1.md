# Native Runtime Proof Verification v1

## Scope

This slice adds cryptographic verification for the runtime-session proof contract. It authenticates a runtime claim; it does not authorize an agent action, issue an evidence receipt, or establish device attestation.

## Trust inputs

The host constructs `Ed25519RuntimeProofVerifier` with `RuntimeProofTrustedKey` entries. Each entry contains a key ID, raw Ed25519 public-key bytes, and an explicit allowlist of runtime build IDs accepted for that key.

- The registry is immutable after verifier construction.
- Duplicate key IDs are excluded from the usable registry.
- Unknown IDs, malformed public keys, empty build allowlists, and builds outside the allowlist fail closed.
- The proof cannot introduce, rotate, or replace a trust key.
- No private key is accepted by the verifier. No model response, task payload, UI label, or loopback health response is a trust input.

## Signed canonical payload

The signature covers these UTF-8 fields in exact order:

1. `pocket-ai-runtime-session-proof-v1`
2. protocol version as a decimal integer
3. session ID
4. model ID
5. lowercase model-file SHA-256
6. runtime build ID
7. expiry string exactly as carried in the proof
8. generation counter as a decimal integer
9. key ID
10. algorithm

Each field is prefixed by its byte length encoded as an unsigned 32-bit big-endian integer. Paired TypeScript/Swift tests pin the same Base64 representation for a fixture.

## Verification sequence

1. Reject unsupported protocol/algorithm, malformed SHA-256, empty session, non-positive generation, or malformed/expired timestamp.
2. Require exact expected model ID and model-file hash binding.
3. Resolve the key ID only in the host-provisioned registry and require the runtime build ID allowlist.
4. Decode a canonical 64-byte Base64 Ed25519 signature.
5. Verify the signature over the canonical payload.
6. Ask the replay store to accept the session/key/generation tuple. Any replay or storage error returns false.

The Keychain replay store uses device-only, when-unlocked accessibility and is intended to be injected as one shared process-wide writer. Its read/compare/update sequence is not a cross-process compare-and-swap. A host must not create multiple concurrent writers for the same service.

## Integration status and limitations

This is a verifier and replay-store primitive, not a production trust deployment:

- The app does not yet provision a trusted public-key registry.
- There is no production runtime signer or secure key-provisioning/rotation/revocation service.
- The verifier is not wired into the app composition root or used to mark a model ready.
- A successful local model load or generation is still inference availability only.
- No hardware-backed app/device attestation is established.
- Runtime session invalidation and reconnect lifecycle still require integration.

Until those gates are independently implemented and tested, app-level runtime trust must remain `Unverified`. A proof never grants action authorization, changes APEX/East approvals, or creates signed evidence receipts.


## Keychain integration test environment

The Keychain replay store is intentionally fail-closed: a Keychain API error is not interpreted as a successful replay check. GitHub's unsigned iOS simulator test host currently returns `errSecMissingEntitlement` (`-34018`) when attempting Keychain access. The XCTest integration test skips only for that exact OSStatus; it does not suppress other Keychain errors. The deterministic verifier tests continue to cover monotonic replay rejection and storage failure.

This skip is not evidence that durable Keychain replay protection works on a physical device. Before release, run the persistence test in a correctly signed iOS host with the intended Keychain entitlement and verify persistence across verifier/store recreation and app relaunch. Do not weaken the runtime verifier to accommodate an unsigned test host.
