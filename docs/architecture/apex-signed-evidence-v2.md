# APEX signed evidence verification v2

## Scope and status

This is a candidate-verification primitive, not an APEX authorization service. It replaces the placeholder trust.ts source with an injected Ed25519 verifier for device/runtime evidence. A successful result is named verified_candidate; it is not approval, permission, a receipt, or an authorized flag.

The verifier is deliberately not wired into East action dispatch. Existing validateDeviceEvidenceCandidate remains a shape/binding helper and does not call this verifier. Integration requires an independently reviewed persistent replay store, key provisioning/revocation, receipt schema, RLS, and APEX policy contract.

## v2 signed payload

The signed payload contains these fields in exact order:

1. Domain: pocket-ai-apex-signed-evidence-v2
2. Protocol version (2)
3. Key ID
4. Conversation request ID
5. Attempt ID
6. Model ID
7. Model-file SHA-256 (lowercase)
8. Runtime session ID
9. Runtime version
10. Device ID
11. Runtime identity
12. Challenge nonce
13. Generation-result SHA-256 (lowercase)
14. Attested-at timestamp
15. Health-check ID
16. Algorithm (Ed25519)

Each UTF-8 field is prefixed by a 4-byte unsigned big-endian byte length. This avoids the newline-delimiter ambiguity in the older Swift SignedRun.canonical representation and explicitly binds health-check and runtime identity values.

## Trusted-key contract

The host injects an immutable list of ApexTrustedEvidenceKey entries. Each key contains:
- key ID and Base64 DER SubjectPublicKeyInfo Ed25519 public key;
- allowlists of runtime identities and runtime versions;
- validity start/end timestamps and optional revocation time.

Duplicate key IDs are excluded. Invalid keys, malformed dates, unknown IDs, expired/revoked keys, and runtime identities or versions outside the allowlists fail closed. The proof cannot add or rotate a trusted key. No private key is accepted by the verifier.

No production trusted-key registry, key provisioning, rotation, or revocation service is included. Until the host supplies approved keys, no evidence can verify.

## Attempt binding and replay

Verification requires exact equality with a caller-supplied attempt binding for conversation request, attempt, model ID, model-file hash, runtime session, device ID, runtime identity, challenge nonce, and health-check ID. The model-file hash and generation-result hash must be 64-character SHA-256 values.

Evidence freshness defaults to 30 seconds with a 1-second future clock-skew allowance. The injected replay store must atomically accept the key/attempt/nonce tuple. A replay or replay-store exception rejects the candidate. The included tests use an in-memory store only; production requires a durable transactional store with concurrency guarantees.

## What success does not mean

- It does not approve an action or satisfy an APEX rule/patch/release gate.
- It does not issue or persist an evidence receipt.
- It does not create tenant isolation or RLS.
- It does not prove the device is uncompromised or provide hardware-backed attestation.
- It does not make a model output trusted or verified.
- It does not change East's constant authorized: false behavior.

## Validation

Focused tests use generated Ed25519 keys and cover valid signatures, tampering, binding mismatch, duplicate/unknown keys, key expiry/revocation, runtime allowlists, freshness, replay, replay-store failure, malformed shapes, and length-prefix ambiguity. Production integration must add paired Swift/TypeScript canonicalization fixtures and tests using the approved runtime signer and a durable replay store.
