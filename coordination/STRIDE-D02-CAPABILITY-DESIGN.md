# D-02 Director Capability and Source-Reference Identity Design

**Status:** Design proposal only; not an implementation approval  
**Date:** 2026-11-18  
**Related:** STRIDE-GPT D-02, D-04; PR #198

## 1. Current state

PR #198 adds `verifySourceReference` to the concrete `LocalProjectInspector` and tests the adapter behavior. The shared `ProjectInspector` interface currently exposes only `inspect`; `DirectorCapabilities` exposes `analyzeProject`; `DirectorCommandRouter` has no verification command; and the web runtime injects the inspector through the narrower interface. No current caller of `verifySourceReference` was found in the default-branch search.

The current result reports status, normalized relative path, occurrence count, and line range, but no stable reference identifier or source-content digest. D-04's current acceptance contract requires emergent claims to cite verified source-reference IDs. Consequently, D-02 is an adapter-level prototype and is not yet an end-to-end Director capability.

## 2. Existing pattern to reuse carefully

`packages/intelligence/research-science/SourceEvidenceAdapter.ts` already demonstrates a useful provenance pattern: bind a candidate to the SHA-256 of exact source bytes, a normalized filename, and a validated line; produce a stable source URI; retain an explicitly unverified classification; and state that no authorization or execution occurred.

Reuse the digest-binding concept, not its epistemic label or candidate semantics. A successful exact quote check can be marked `verified` only for the narrow proposition that the quote is present at the reported location in that exact content snapshot. It is not a confirmed vulnerability or trusted Evidence.

## 3. Proposed data flow

1. The model proposes a structured reference `{ path, quote, startLine?, endLine? }`. Treat every field as untrusted.
2. The Director command router validates the command shape and bounded strings, then calls a dedicated `DirectorCapabilities.verifySourceReference` method.
3. `DirectorCapabilities` delegates to the host-injected project inspector's verifier port. The host adapter retains workspace-root confinement, symlink rejection, extension allowlist, file-size limits, and read-only behavior.
4. The adapter reads one bounded file snapshot, computes SHA-256 over the exact bytes, normalizes line endings for matching, and returns the exact normalized relative path and 1-based line range.
5. Only a verified result receives a reference ID. The ID is derived from a canonical encoding of an opaque host-issued workspace reference, normalized relative path, source-content SHA-256, exact line range, and quote SHA-256. Do not expose the absolute workspace root.
6. A task-scoped immutable reference catalog records the verifier-produced result. Downstream synthesis resolves IDs through that catalog; it must not accept a model-supplied ID or path/line string as proof by itself.
7. Before reuse, the host re-reads/re-verifies the reference against the current file snapshot. A changed digest, path, line range, or quote yields stale/unverified and cannot be used as a verified link in an emergent chain.

## 4. Proposed result contract

A result should distinguish:

- `verified`: exact quote matched uniquely under the supplied line constraints in the inspected snapshot;
- `unverified`: missing, malformed, unsupported, oversized, ambiguous, mismatched, inaccessible, or stale reference;
- `referenceId`: present only for a verified result and resolvable only within its task/workspace scope;
- `sourceSha256`: digest of exact file bytes read by the adapter;
- `path`, `startLine`, `endLine`, and bounded `occurrenceCount`;
- a stable failure reason for unverified outcomes.

The reference ID is a content-addressed lookup key, not a signature, attestation, authorization token, or evidence receipt. It must not grant permissions or cause execution.

## 5. Trust and lifecycle requirements

- Model-produced paths, quotes, line numbers, and claimed IDs are untrusted proposals.
- Only the host adapter may create a catalog entry after re-reading and matching the source.
- Catalog entries are immutable and scoped to a task plus opaque workspace identity.
- Do not accept caller-supplied absolute paths, workspace roots, digests, reference IDs, or authority flags.
- Do not convert a verified source reference into signed `Evidence.swift`, attestation, APEX approval, East authorization, or a trusted receipt.
- Keep inspection read-only. No scanner, process execution, network access, or file mutation is introduced.
- Do not create a second sandbox or path resolver; reuse the approved `LocalProjectInspector` confinement boundary.

## 6. Required tests before D-04

- Router rejects unknown fields, malformed references, traversal, absolute paths, NULs, unsupported extensions, and oversized inputs.
- Exact and duplicate quotes, line-hint selection, CRLF/LF normalization, and line-range mismatch.
- Reference ID changes when source bytes, normalized path, line range, quote, workspace scope, or content snapshot changes.
- Same exact reference in the same snapshot produces the same ID.
- Model-invented IDs and IDs from another task/workspace cannot resolve in the task-scoped catalog.
- File modification after verification causes stale-reference rejection on reuse.
- Missing host verifier fails closed; no fallback to model claims or raw filesystem access.
- Existing APEX/East/Evidence/runtime authorization tests remain unchanged and passing.

## 7. Decisions still required

1. Should verification be a new Director command or a narrowly invoked internal stage of a source-analysis task? Prefer the smallest interface that supports the Researcher/Validator use case without turning source verification into a general-purpose file-reading API.
2. What existing task/run identity is authoritative for catalog scoping and persistence? Do not invent a parallel lifecycle or durable store; consult East/task contracts before choosing.
3. Should the catalog be ephemeral for a task or persisted as an East artifact? If persisted, define retention and revalidation semantics before implementation.
4. Confirm canonical reference-ID serialization and digest algorithm in one shared helper with test vectors.

## 8. Gate

This document is a design proposal, not approval to change shared interfaces. Keep PR #198 limited to the adapter-level verifier pending independent review. Do not start D-04 until the Director entry point, content-bound identity, task/workspace scoping, stale-reference behavior, and independent review of D-02 are accepted. No APEX/East/Evidence trust contract is changed by this proposal.
