# APEX trust and evidence integration — contract gap audit

**Baseline:** `main` at `9dde1ee16874b4b4802dd92e94605dd5fb92bc2d`  
**Branch:** `agent/apex-trust-contract-audit`  
**Status:** Read-only architecture audit; no authorization behavior changed.

## Purpose

Record the implementation boundary between device-generated evidence, Director/APEX trust, and East/e3. This document is a prerequisite for implementing a verifier or persistence layer without inventing trust policy.

## Verified baseline

The following statements were checked against the baseline commit:

- `packages/director/src/lib/apex/trust.ts` contains only `PLACEHOLDER_TRUST_CONTENT_WILL_BE_REPLACED`. It is not a usable TypeScript module.
- `packages/director/src/lib/apex/decisions.ts` exports `OPEN_DECISIONS`, with `rule`, `patch`, and `release` all set to `pending`.
- `packages/director/src/lib/compliance/evidence-submission.ts` validates candidate object shape, exact attempt binding, and nonce reuse. Its success state is `candidate_only`; it explicitly does not verify signatures, issue receipts, persist evidence, or authorize execution.
- `packages/director/ios/Sources/ApexBridge/Evidence.swift` defines a `SignedRun` payload and a CryptoKit signing helper. Its canonical string excludes `text`, `healthCheckId`, and `signature`; no TypeScript verifier or mapping to `DeviceEvidence` was found in the reviewed paths.
- `src/east/platform.ts` exposes a read-only APEX decision view, stores no submitted device-evidence candidate, and returns `false` for authorization. `src/east/index.ts` binds the compiled task's evidence commit to a constant `false`.
- The reviewed repository tree has no `packages/director/src/lib/apex/rls.ts` or `packages/director/src/lib/apex/schema.ts`, and no APEX receipt type was found in the reviewed paths.
- Root `tsconfig.json` excludes `packages/director`; therefore the placeholder's presence is not evidence that the root TypeScript build currently type-checks Director code.

## Security invariants to preserve

1. A model, agent, inference provider, or East task cannot grant itself authority.
2. A well-formed candidate is not a verified attestation and is never an authorization receipt.
3. Missing, unknown, expired, revoked, malformed, or unverifiable trust material fails closed.
4. Device identity, runtime identity, model-file identity, and server identity remain distinct claims. One must not be substituted for another.
5. A runtime signature proves possession of a key only under a separately established trust policy. It does not by itself prove that the runtime is uncompromised or that a model file is safe.
6. The exact request, attempt, model hash, runtime session, device binding, challenge nonce, and generation-result hash must remain bound through verification.
7. Nonce uniqueness must be enforced by durable, concurrency-safe storage at the point of acceptance; a caller-provided in-memory list is not a replay defense.
8. Evidence and attempts are append-only. Corrections or re-attestation create new attributable records; they do not rewrite prior evidence.
9. Authorization is a separate, exact-scope decision made by the existing governance authority. Verification success alone never means approval.
10. Repair and release continue to require their own independently scoped approvals.

## Decisions required before implementing trust verification

These are intentionally open; this audit does not select values or create keys.

| Contract area | Required decision |
|---|---|
| Trust roots | Who provisions the trusted public keys, and through what authenticated channel? |
| Key identity | Exact key-ID format, uniqueness scope, and collision behavior |
| Algorithms | Approved signature algorithm and encoding; reject algorithm negotiation from untrusted payloads |
| Key lifecycle | Activation, expiry, revocation, rotation, overlap, and emergency revocation semantics |
| Runtime identity | What constitutes an approved runtime build, and how is that identity attested independently? |
| Device identity | Which device binding is available on supported iOS versions, and what claim does it actually support? |
| Canonical payload | Versioned, unambiguous serialization; field ordering, encoding, domain separation, and compatibility rules |
| Challenge | Nonce generation, entropy, expiry, one-time consumption, and server-side ownership |
| Time | Trusted timestamp source, allowed clock skew, and whether time is informational or security-critical |
| Persistence | Canonical evidence, attempt, nonce, key, revocation, and audit schemas |
| Tenant isolation | RLS ownership model, transaction-local identity, privileged roles, and cross-tenant denial tests |
| Receipts | Exact receipt semantics, signer, scope, expiry, revocation, and distinction from an authorization decision |
| Authorization | Existing APEX policy entry point and exact-scope approval contract; no parallel policy engine |

## Required verification pipeline

The implementation should be split into independently testable stages:

1. **Parse:** validate a versioned wire format and reject unknown or duplicate fields.
2. **Bind:** compare all request/attempt/runtime/model/device bindings with server-owned records, not caller assertions alone.
3. **Challenge:** verify that the nonce was issued for this attempt, is unexpired, and has not already been consumed.
4. **Trust lookup:** resolve the key ID only from an authenticated, policy-controlled trust registry.
5. **Cryptographic verification:** verify the signature over a versioned canonical payload with a fixed approved algorithm and domain separation.
6. **Runtime policy:** evaluate key status, runtime identity, attestation freshness, and any required revocation state.
7. **Atomic persistence:** consume the nonce and append the verified evidence in one transaction with tenant isolation.
8. **Receipt:** if the approved governance contract requires a receipt, issue a narrowly scoped provenance receipt. Do not make it an approval.
9. **Authorization:** ask the existing APEX decision mechanism for a separate exact-scope decision. East must continue to deny unless that mechanism returns an authenticated, valid decision under its existing contract.

A failure at any stage returns a typed denial and leaves no partially accepted evidence or consumed nonce unless the transaction's documented failure semantics explicitly require a durable denial audit event.

## Minimum negative test matrix

- Unknown key ID; revoked key; expired key; malformed public key; invalid signature.
- Signature over altered payload; field-order ambiguity; unsupported canonicalization version.
- Wrong request, attempt, model hash, runtime session, device binding, or generation hash.
- Missing, expired, replayed, cross-attempt, and concurrently submitted nonce.
- Caller-supplied `authorized`, `approved`, receipt, trust status, or key material fields.
- Runtime identity mismatch and stale runtime attestation.
- Database transaction rollback between nonce consumption and evidence insertion.
- Cross-tenant read/write attempts under RLS, including pooled-connection transaction reuse.
- Valid evidence with no APEX approval: evidence may be verified, but execution remains denied.
- East timeout, malformed decision, stale decision, replayed decision, and unavailable trust service.

## Current implementation boundary

Until the open decisions above are resolved and the corresponding trust, schema, RLS, verifier, and receipt contracts are implemented and tested:

- Keep `validateDeviceEvidenceCandidate` as candidate validation only.
- Keep East's `authorized` value permanently false in the current integration.
- Do not treat `OPEN_DECISIONS` or `trust: unavailable` as approval.
- Do not persist unverified device claims as verified evidence.
- Do not generate, commit, or embed a private signing key.
- Do not add a second authorization mechanism alongside APEX.

## Next implementation sequence

1. Review the authoritative APEX/RLS specifications already present in the repository and reconcile their versions.
2. Record owner-approved trust-root, key lifecycle, canonicalization, nonce, receipt, and authorization decisions.
3. Define versioned TypeScript contracts and database schema from those decisions.
4. Implement a verifier against test-only public/private key fixtures; never commit production private keys.
5. Add atomic nonce/evidence persistence and RLS isolation tests.
6. Integrate the verified evidence result into the existing APEX flow without converting verification into approval.
7. Only then consider changing East's evidence handoff. Until then its fail-closed behavior is correct.
