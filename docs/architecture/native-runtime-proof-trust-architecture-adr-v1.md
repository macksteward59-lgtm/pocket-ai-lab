# ADR: Trust Architecture for Native Runtime Session Proofs

- Status: Proposed; decision required before production integration
- Scope: iOS native runtime proof, device/app identity, offline readiness
- Depends on: Native Runtime Proof Verification v1, PR #58, PR #63, PR #65
- Security invariant: A runtime proof is not an APEX/East authorization decision and never creates evidence receipts.

## 1. Problem statement

The current implementation verifies an Ed25519 `RuntimeSessionProof` against host-provisioned public keys and persists replay state in a device-only Keychain item. The verifier is fail-closed and simulator-tested.

The production app is not yet wired to this verifier. `LocalChatModel` constructs `LlamaCppMetalBackend` directly. `RuntimeSession` currently contains only a session ID and model ID. The engine does not hash the model file, create a signed proof, or own a proof generation counter. There is no production trusted-key provisioning path or signer.

Therefore the current implementation can validate a proof supplied by a trusted source, but it cannot yet establish a trustworthy source for that proof. Do not report `RuntimeReadinessState.ready` in production until this gap is closed.

## 2. Trust claims must be separated

The design must distinguish:

1. **Inference availability:** the engine actually loaded a model and can generate.
2. **Measurement:** the host measured the model file hash, runtime build identity, session ID, and generation state.
3. **App/device identity:** a verifier can establish which app instance made the signed claim.
4. **Runtime integrity:** evidence supports that the measured runtime is the expected build and has not been substituted.
5. **Authorization:** APEX/East independently decides whether any proposed action is permitted.

A signature over self-reported fields proves only that the corresponding key signed those fields. It does not, by itself, prove that the model was loaded, that Metal was used, that the app binary is untampered, or that an action is authorized.

The UI must not collapse these states into one green "verified" indicator.

## 3. Options considered

### Option A — Static Ed25519 private key embedded in the app

Reject.

An embedded private key is extractable from the application and cannot establish a trustworthy device identity. A public key allowlist does not repair a compromised signing secret.

### Option B — Per-install software-generated Ed25519 key stored in Keychain

Useful only as a lower-assurance continuity mechanism.

A per-install key can bind successive claims to one installation and can be protected by Keychain access controls. It does not attest the app binary or prove the claimed runtime build. Ordinary Keychain storage is not equivalent to a hardware-backed attestation key. Do not treat this option alone as production runtime integrity or as sufficient for `ready`.

### Option C — Secure Enclave P-256 key with server challenge

Potentially useful, but requires careful platform and server design.

A Secure Enclave-backed signing key can provide stronger key protection than a software key. A signature from such a key still does not independently attest the app binary or the model actually loaded. The server must bind enrollment, challenge freshness, app identity, and key lifecycle. This option is not interchangeable with the current Ed25519 proof schema.

### Option D — Apple App Attest bootstrap plus server-signed offline lease

Recommended candidate for the higher-assurance online bootstrap path, subject to a separate implementation review against current Apple documentation and supported-device behavior.

Proposed flow:

1. The app establishes a fresh runtime session through the native engine. The engine, not the UI, owns session creation and invalidation.
2. The host computes the model file SHA-256 from the exact file opened by the engine and captures an immutable runtime build identifier. A probe result or health endpoint alone is not a loaded-session proof.
3. The app requests a one-time server challenge bound to the app instance, intended audience, session ID, model ID/hash, runtime build ID, and protocol version.
4. The app uses App Attest to produce an assertion over a domain-separated canonical challenge containing those fields and a server nonce.
5. The server validates the App Attest assertion, challenge freshness, app identity/environment, enrollment state, and replay state. The server must not infer GPU use or model correctness merely from the assertion.
6. The server issues a short-lived, server-signed runtime lease binding the accepted claim to the device/app instance, session, model hash, runtime build, protocol version, expiry, and monotonically increasing lease generation.
7. The app verifies the server signature using a pinned server public key and persists replay/lease state using a durable device-only store.
8. While offline, the app may verify the unexpired signed lease locally. Expiry, revocation knowledge becoming stale, session unload, model replacement, app restart without recoverable session binding, or runtime disconnect must invalidate readiness according to the lease policy.

Important limitation: App Attest establishes app-instance assertions under Apple's attestation system. It does not independently inspect llama.cpp memory, prove a specific tensor was loaded, or prove GPU offload. Those remain host measurements and engineering claims, not facts directly attested by Apple. The product must describe this accurately.

This option preserves offline-first inference after a successful online bootstrap, but a first-time offline installation cannot obtain a server-issued lease. It may still offer local inference with a clearly separate "unattested/unverified" state.

### Option E — Offline-only local signer

Reject as a high-assurance trust root.

A device-local signing key can provide continuity and tamper-evident local records, but without a trusted enrollment/attestation mechanism it cannot independently prove approved app identity or runtime build provenance. It may be considered for local audit integrity only, with an explicit weaker trust label.

## 4. Recommended trust model

Adopt a two-level state model:

- **Inference state:** unavailable, loading, loaded, generating, failed.
- **Trust state:** unverified, challenge-pending, verified-online, verified-offline-lease, expired, revoked, unavailable.

Do not map "loaded" directly to "verified". The UI can accurately say that local generation is available while trust remains unverified.

For higher-assurance readiness, require all of:
- actual engine-owned loaded session;
- model hash measured from the opened model file;
- immutable runtime build identity;
- fresh challenge and validated app-instance assertion during enrollment/renewal;
- server-issued, signed, audience-bound lease;
- locally verified lease signature and field bindings;
- durable monotonic replay state;
- unexpired lease and active session;
- explicit invalidation on unload, disconnect, model replacement, and failed generation lifecycle transitions.

The server's lease signature authenticates the server's decision to accept the attested app claim. It does not turn self-reported runtime measurements into hardware measurements.

## 5. Key and protocol implications

The current `RuntimeSessionProof` uses Ed25519. App Attest assertions use Apple's attestation/assertion protocol and must not be coerced into that Ed25519 field.

Keep distinct types and trust domains:
- App Attest enrollment/assertion payload and server verification result;
- server-signed runtime lease with its own versioned canonical format and pinned verification keys;
- local Keychain replay record;
- APEX/East evidence/approval contracts.

Do not reuse `packages/director/ios/Sources/ApexBridge/Evidence.swift` as a runtime lease signer or treat a `SignedRun` signature as permission. Its fields and purpose belong to a separate evidence handoff. No change to APEX/East trust, receipt, RLS, or approval semantics is authorized by this ADR.

Key rotation and revocation must be designed before release:
- pin a versioned server trust set;
- support overlap during rotation;
- reject unknown or revoked key IDs;
- define revocation freshness and offline behavior;
- bind leases to an audience and protocol version;
- prevent rollback to an older lease generation;
- fail closed on corrupt or unavailable persistence.

## 6. Replay, invalidation, and concurrency

The current Keychain replay store is single-process only. Its read/compare/update sequence is not a cross-process atomic compare-and-swap. Continue to inject one process-wide actor instance. Do not share it across extensions or processes.

Session IDs must be globally unique and never reused. On unload/disconnect, persist a terminal tombstone or advance a durable session epoch so that an old proof cannot become valid again. Deleting replay state is not a safe invalidation strategy.

The replay store must reject:
- repeated generation;
- lower generation;
- key or lease identity changes within a session;
- expired or revoked leases;
- unknown protocol versions;
- stale session epochs;
- storage errors and malformed records.

A future multi-process design requires a transactional store with atomic compare-and-swap semantics, not merely another actor wrapping the same Keychain sequence.

## 7. Implementation sequence

1. Keep PR #58 verifier and PR #63/#65 replay persistence as isolated, unmerged building blocks pending review.
2. Decide whether the product accepts an online App Attest bootstrap and short-lived offline lease, including the first-install offline limitation.
3. Specify the server API, nonce lifecycle, App Attest verification, lease format, server key rotation/revocation, and failure semantics.
4. Add engine-owned session lifecycle and exact model-file hashing. Never trust a hash supplied by the UI or model.
5. Implement the server lease verifier as a distinct protocol/version; do not silently change the existing Ed25519 contract.
6. Inject a single runtime trust service from the app composition root. Remove direct engine construction from `LocalChatModel`.
7. Bind lease invalidation to engine unload, cancellation, model replacement, app lifecycle, and runtime disconnect.
8. Add tests for challenge replay, stale lease, altered model hash, altered build ID, unknown/revoked signing key, offline expiry, Keychain corruption, session tombstones, and process restart.
9. Validate on simulator and then on a physical iPhone. Simulator success and generic device linking are not physical-device acceptance.
10. Only after all gates pass may the UI expose a verified runtime trust state.

## 8. Explicit non-goals

This work does not:
- authorize model-generated actions;
- approve tool execution or file changes;
- issue evidence receipts;
- modify APEX/East authorization or RLS;
- prove the model's answers are correct or safe;
- claim Metal offload solely from a probe;
- claim physical-device validation from CI simulator/device-link steps.

APEX/East remains the independent authorization boundary. The model and native inference engine remain proposal-producing components only.
