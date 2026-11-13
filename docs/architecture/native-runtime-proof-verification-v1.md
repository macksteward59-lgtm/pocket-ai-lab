# Native Runtime Proof Verification v1

## Scope

This slice adds cryptographic verification for the runtime-session proof contract. It authenticates a runtime claim; it does not authorize an agent action, issue an evidence receipt, or establish device attestation.

## Trust inputs

The host constructs `Ed25519RuntimeProofVerifier` with `RuntimeProofTrustedKey` entries. Each entry contains:

- a key ID;
- the raw Ed25519 public key bytes;
- an explicit allowlist of runtime build IDs accepted for that key.

The registry is immutable after verifier construction. Duplicate key IDs are excluded from the usable registry. Unknown IDs, malformed public keys, empty build allowlists, and builds outside the allowlist fail closed. The proof cannot introduce, rotate, or replace a trust key.

No private key is accepted by the verifier. No model response, task payload, UI label, or loopback health response is a trust input.

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

Each field is prefixed by its byte length encoded as an unsigned 32-bit big-endian integer. This prevents delimiter ambiguity and makes the Swift and TypeScript encoders deterministic. Paired tests pin the same Base64 representation for a fixture.

## Verification sequence

1. Reject unsupported protocol/algorithm, malformed SHA-256, empty session, non-positive generation, or malformed/expired timestamp.
2. Require exact expected model ID and case-insensitive expected model hash binding.
3. Resolve the key ID only in the host-provisioned registry and require the runtime build ID allowlist.
4. Decode a canonical 64-byte Base64 Ed25519 signature.
5. Verify the signature over the canonical payload using CryptoKit.
6. Pass the authenticated session/key/generation tuple to the injected replay store only after signature verification.
7. The store rejects a reused/lower generation or a key change for the same session. Store errors fail closed.

`KeychainRuntimeProofReplayStore` persists the accepted key ID and generation in a device-only Keychain generic-password item using `kSecAttrAccessibleWhenUnlockedThisDeviceOnly`. Its actor serializes operations through one shared store instance, and the item survives verifier recreation and ordinary app process restarts.

**Concurrency boundary:** the Keychain implementation is designed for one process-wide writer. The Keychain read/compare/update sequence is not a cross-process compare-and-swap. Do not share this store across app extensions or multiple processes until a transactional cross-process store is implemented. The app composition root must inject one shared store instance into its verifier.

## Important production gaps

- Durable replay persistence is implemented for the single-process app model, but cross-process atomicity and session invalidation on unload/disconnect remain open. A storage failure rejects verification; there is no in-memory fallback.
- The host must provision trusted public keys and their runtime-build allowlists from a separately authenticated source. This PR does not implement provisioning, rotation, revocation, or a trusted root.
- No runtime private-key signer, Secure Enclave integration, hardware-backed key attestation, or device attestation is implemented.
- The verifier is not yet wired into the app's production runtime lifecycle. Until the host supplies real trusted keys and lifecycle state, readiness remains unavailable.
- Session invalidation on unload/disconnect and durable proof freshness remain integration gates.

## Governance boundary

A valid runtime proof means only that a trusted key signed a claim matching the verifier's configured expectations. It does not mean the model is safe, the generated content is correct, a tool is approved, or a user authorized an action. APEX/East remains the independent approval and evidence boundary. No receipts, approvals, RLS policy, or authorization state are modified by this verifier.
