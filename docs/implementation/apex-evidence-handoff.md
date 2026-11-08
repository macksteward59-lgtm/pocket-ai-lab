# APEX evidence handoff

This note describes the evidence interface that exists on `main` at `698357a1fdd3cb510994deaab77b9078afdcab14`. It does not add an API, a trust policy, a row-level security policy, a storage schema, a signature verifier, or a receipt.

## Candidate validation is not authorization

`validateDeviceEvidenceCandidate` in `packages/director/src/lib/compliance/evidence-submission.ts` checks a candidate. Its own comment states that it does not verify signatures, issue receipts, persist evidence, or authorize execution.

Call:

```ts
validateDeviceEvidenceCandidate(input, attempt, existing)
```

`attempt` is `EvidenceAttemptBinding`:

| Field | Type |
|---|---|
| `conversation_request_id` | `string` |
| `attempt_id` | `string` |
| `model_file_hash` | `string \| null` |
| `runtime_session_id` | `string \| null` |
| `device_id` | `string \| null` |

`existing` is an array of `{ attempt_id: string; challenge_nonce: string }`. The helper does not store that array.

The result is one of:

- `{ ok: true, status: "candidate_only", evidence: DeviceEvidence }`
- `{ ok: false, reason: "invalid_shape" | "attempt_mismatch" | "nonce_reuse" }`

`candidate_only` means the object matched the existing shape, binding, and nonce rules. It is not permission to run, store, or repair anything.

## DeviceEvidence shape

`DeviceEvidence` is declared in `packages/director/src/lib/compliance/contract.ts`. The validator accepts only a non-array object whose keys are exactly these non-empty strings:

`conversation_request_id`, `attempt_id`, `model_id`, `model_file_hash`, `runtime_session_id`, `runtime_version`, `device_id`, `challenge_nonce`, `generation_result_hash`, `attested_at`.

`evidenceFits` returns true only when the five binding fields equal the attempt, including a null attempt binding, and the remaining evidence strings are non-empty. `reusedNonce` returns true when `challenge_nonce` already appears on a different `attempt_id`. The same attempt may repeat its own nonce.

The same file also has attempt lifecycle helpers (`nextPhase`, `lifecyclePath`) and `retryDecision`. Those helpers do not create evidence or grant authorization.

## East

`commitTaskEvidence` in `src/east/platform.ts` calls `validateDeviceEvidenceCandidate` when a submission is passed. A rejected candidate throws `evidence_rejected` and is not stored. A `candidate_only` candidate still makes the function return `false`. Task `authorized` stays `false`. The compiled East binding in `src/east/index.ts` returns the constant `false`.

The same commit reads `OPEN_DECISIONS` and stores the result on `apexDecision`. The only surfaced decision is the three gates still set to `pending`, a digest East calculated from the proposal, and `trust: "unavailable"`. East does not copy a response field onto `authorized`. A missing, malformed, forged, shape-mismatched, signature-bearing, stale, throwing, or timed-out response is `closed`. A closed read does not add the unverified synthesis write. No signature is checked. `trust.ts` is not imported.

## Swift SignedRun is not a server verifier

`packages/director/ios/Sources/ApexBridge/Evidence.swift` defines `SignedRun` with these stored fields:

`text`, `keyId`, `conversationRequestId`, `attemptId`, `modelId`, `modelFileHash`, `runtimeSessionId`, `runtimeVersion`, `deviceId`, `runtimeIdentity`, `challengeNonce`, `generationResultHash`, `attestedAt`, `healthCheckId`, `signature`.

`canonical` joins every field except `text`, `healthCheckId`, and `signature`, separated by newlines. `Evidence.sign` calls `Curve25519.Signing.PrivateKey.signature` only when `CryptoKit` can be imported, and it returns an empty string if that call throws. No TypeScript code verifies `signature` or maps `SignedRun` into `DeviceEvidence`. The extra Swift fields (`text`, `keyId`, `runtimeIdentity`, `healthCheckId`, `signature`) are not part of the candidate validator.

## What is not in the tree

`packages/director/src/lib/apex/trust.ts` contains only the literal text `PLACEHOLDER_TRUST_CONTENT_WILL_BE_REPLACED`. It is not valid TypeScript, and nothing imports it.

`packages/director/src/lib/apex/rls.ts` and `packages/director/src/lib/apex/schema.ts` are absent.

No receipt type is declared.

`packages/director/src/lib/apex/decisions.ts` exports `OPEN_DECISIONS`, with `rule`, `patch`, and `release` each set to `"pending"`. That constant is not an approval.

Full East/APEX submission still needs the real trust, RLS, and schema contracts. Until those exist, do not add signature verification, persistence, or an authorization grant.
