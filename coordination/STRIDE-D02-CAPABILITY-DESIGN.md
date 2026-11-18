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


## 9. East task identity and persistence trace — 2026-11-18

A read-only trace of the current default-branch implementations establishes the following:

- `DirectorCommandRouter` already requires `DirectorCommandContext.taskId` for dispatch and uses it for task-bound mutations such as memory changes, tool activation/retirement, and device actions.
- The current `analyze-project` command dispatches only the command object to `DirectorCapabilities.analyzeProject`. The `taskId` is not forwarded to that capability or to `ProjectInspector.inspect`. A Director-facing source-verification entry point therefore needs explicit task-context propagation; it must not infer task identity from model output.
- `src/east/platform.ts` creates task IDs through `createAgentTask` and stores `EastTaskRecord` values in a process-local `Map<string, EastTaskRecord>`. `getTask(taskId)` returns a defensive snapshot. The current task record includes objective, assignments, synthesis, evidenceRefs, evidenceGate, apexDecision, and `authorized: false`; it has no source-reference catalog or general artifact-store port.
- East's current `commitTaskEvidence` path writes matching deliberation text to `MemoryManager` as episodic memory with `verified: false` and sourceRefs copied from existing deliberation references. This is not a source-reference artifact API, and it must not be repurposed to persist verified source-reference records or imply verification/authorization.
- The inspected East platform runtime itself is in-memory. The inspected interface exposes no general durable artifact store. Other task-lifecycle/PostgreSQL work exists elsewhere in the repository, but no source-reference artifact contract was established by this trace; do not assume it is interchangeable with this East runtime or add a second store.

### Design consequence

The smallest safe first integration is a task-context-aware Director capability plus a host-owned, immutable, task-scoped catalog whose lifecycle is explicit. The task ID must come from the existing trusted Director dispatch context. The host adapter must own workspace identity and source snapshot reads. Model proposals cannot choose task IDs, workspace IDs, reference IDs, or persistence scope.

For the initial integration, treat the catalog as ephemeral and process-local unless a separately reviewed, existing durable artifact contract is identified and explicitly adopted. Do not write source-reference records through `MemoryManager` or overload `EastTaskRecord.evidenceRefs`: those fields have existing deliberation/evidence semantics. If later persistence is required, define a narrow artifact interface and restart/revalidation behavior in a separate design review before implementation.

This trace does not approve shared-interface changes. It narrows the open design decision: task identity is already available at the Director router, but the current project-analysis path drops it; current East task storage is in-memory and has no source-reference artifact store. D-04 remains blocked until the capability contract, task/workspace scoping, catalog lifecycle, and independent D-02 review are accepted.


## 10. Proposed minimum typed port (review draft)

The code trace suggests separating the Director-facing capability from the host-owned catalog. The following is a contract sketch for review, not approved code:

```ts
export interface SourceReferenceProposal {
  path: string;
  quote: string;
  startLine?: number;
  endLine?: number;
}

export interface VerifiedSourceReference {
  status: "verified" | "unverified";
  referenceId?: string;       // host-issued; verified only
  path: string;               // normalized relative path
  sourceSha256?: string;      // exact bytes of the checked snapshot
  startLine?: number;
  endLine?: number;
  occurrenceCount: number;
  reason?: string;            // stable, bounded reason code
}

export interface SourceReferenceVerifier {
  verify(input: {
    taskId: string;           // from DirectorCommandContext, never model data
    proposal: SourceReferenceProposal;
  }): Promise<VerifiedSourceReference>;
  resolve(input: {
    taskId: string;           // from current trusted task context
    referenceId: string;      // untrusted selector; catalog lookup only
  }): Promise<VerifiedSourceReference | undefined>;
}
```

Contract implications:

- Inject `SourceReferenceVerifier` as a distinct host port in `DirectorCapabilityOptions`; do not widen `ProjectInspector` into a generic filesystem API. The implementation may delegate to the same `LocalProjectInspector` instance so confinement and bounded reads are shared.
- Pass `context.taskId` explicitly from the router into `DirectorCapabilities.verifySourceReference`. The command payload contains only the source proposal. The router's strict field allowlist must reject `taskId`, `workspaceId`, `referenceId`, `sourceSha256`, and authority-like fields in model proposals.
- The host port, not the shared capability layer, owns opaque workspace identity and the task-scoped catalog. A catalog entry is immutable and contains the exact source digest, normalized relative path, exact line range, quote digest, and opaque workspace scope.
- `resolve` is a lookup plus freshness check, not proof by possession. It must re-read the current file through the same confined adapter and reject if the content digest or exact quote/line binding changed. It must reject cross-task and cross-workspace references even if an ID is copied.
- IDs should be derived from a versioned, unambiguous canonical encoding (for example, length-prefixed UTF-8 fields) and SHA-256. Do not use delimiter-joined strings unless escaping/canonicalization is formally specified. Reuse the repository's Node `createHash("sha256")` convention where the host runtime supports it; add fixed test vectors before implementation.
- A reference ID is a scoped lookup key only. It is not a signature, evidence receipt, authorization grant, or durable identifier across process restarts. With the proposed ephemeral catalog, restart naturally invalidates prior IDs and requires re-verification.

### Remaining decision narrowed

Prefer an explicit `verify-source-reference` Director command for the first increment because the router already provides a strict structured-command boundary and the Researcher/Validator workflow needs an auditable operation. Keep the command read-only and bounded; do not expose arbitrary file reads. An internal stage remains a valid alternative if the existing Researcher pipeline can invoke the same capability with identical task context and catalog guarantees. The implementation owner should select one path after independent review rather than shipping both.


## 11. Implementation-ready validation and identity specification (review draft)

### 11.1 Command boundary

The current router uses a finite `DIRECTOR_COMMAND_KINDS` list and a per-kind `DIRECTOR_COMMAND_FIELDS` allowlist. If the explicit-command option is accepted, add exactly one command shape:

```ts
| {
    kind: "verify-source-reference";
    path: string;
    quote: string;
    startLine?: number;
    endLine?: number;
  }
```

Add `"verify-source-reference"` to the command-kind tuple and map its exact fields in `DIRECTOR_COMMAND_FIELDS`. Do not put `taskId`, `workspaceId`, `referenceId`, `sourceSha256`, `verified`, `authority`, or `approvalRef` in the model command.

Validation requirements:
- Reject unknown keys using the existing strict field allowlist.
- `path`: string, 1–1024 UTF-16 code units before normalization; reject blank, NUL, absolute, drive-qualified, UNC, and any `..` segment after treating both slash styles as separators. Normalize to a repository-relative POSIX path; reject a result of `.`, empty segments where ambiguous, and paths that normalize outside the workspace.
- `quote`: string, 1–8192 UTF-16 code units; reject blank and NUL. Do not trim or Unicode-normalize the quote: exact source text must be preserved. Normalize only CRLF and lone CR to LF for comparison, matching the existing adapter behavior.
- `startLine` and `endLine`: optional safe integers in [1, 2^31-1]. If both exist, require startLine <= endLine. A supplied line pair must select exactly one occurrence; otherwise return a stable unverified reason.
- Reject unknown nested structures; the proposal is a flat object.
- Limit one verifier call to one file and one quote; no globbing, recursive scan, batching, or fallback search.
- Missing verifier configuration must fail closed with a capability-not-configured error; never fall back to model claims or generic `ProjectInspector.inspect`.

### 11.2 Canonical reference ID v1

Use SHA-256 over a binary encoding, not JSON serialization or delimiter-joined text. All integers are unsigned big-endian. All strings are UTF-8 without implicit trimming or Unicode normalization. The normalized relative path uses POSIX separators. Hash the exact raw file bytes before text decoding; compute quoteSha256 from the exact quote after CRLF/CR-to-LF normalization and UTF-8 encoding.

Canonical byte layout:

1. Domain separator: ASCII `PAL-SOURCE-REF\0v1\0`.
2. Workspace scope: uint32 big-endian byte length, then opaque host-issued workspace-scope bytes.
3. Task scope: uint32 big-endian byte length, then UTF-8 task ID.
4. Normalized relative path: uint32 big-endian byte length, then UTF-8 path.
5. Source digest: 32 raw bytes of SHA-256(exact file bytes).
6. Start line: uint64 big-endian.
7. End line: uint64 big-endian.
8. Quote digest: 32 raw bytes of SHA-256(normalized quote UTF-8 bytes).

The public ID is `sr1_` followed by lowercase hex SHA-256 of the complete canonical byte sequence. The prefix versions the encoding; changing any field or encoding requires a new version. The opaque workspace scope must be stable only for the lifetime of the host workspace registration and must not be an absolute path or model-visible secret. The catalog key must additionally enforce exact task/workspace equality; hash collision resistance is not a substitute for scope checks.

Fixed test vector (all input bytes shown as UTF-8 unless marked raw):
- workspace scope: `ws-test`
- task ID: `task-1`
- normalized path: `src/a.ts`
- exact source bytes: `const x = 1;\n`
- source SHA-256: `95befdd6e691d4d89031a2a2901cc74fc6242109980b060e08ddf87829924483`
- startLine: `1`; endLine: `1`
- normalized quote: `const x = 1;`
- quote SHA-256: `3f41cbb303012f33212c92326b27f6cc604fd414e20315cb10f2be7f1f6bb83c`
- canonical payload hex:
  `50414c2d534f555243452d524546007631000000000777732d74657374000000067461736b2d31000000087372632f612e747395befdd6e691d4d89031a2a2901cc74fc6242109980b060e08ddf87829924483000000000000000100000000000000013f41cbb303012f33212c92326b27f6cc604fd414e20315cb10f2be7f1f6bb83c`
- expected digest: `f12747d7815a377503670cfb3631c30729e101ebfd225673cb51c907817e3fed`
- expected ID: `sr1_f12747d7815a377503670cfb3631c30729e101ebfd225673cb51c907817e3fed`

Tests must assert the exact vector above and mutation sensitivity for each field independently (workspace scope, task ID, path, source bytes, start line, end line, quote). Include empty/non-ASCII path and quote vectors, plus line values at the accepted boundaries.

### 11.3 Snapshot and file-race requirements

The verifier must hash and match one and the same byte snapshot. Do not hash one read and match a second read. Avoid a realpath/stat/readFile-by-path sequence that permits a symlink or file replacement between checks. The implementation review must choose a platform-supported descriptor-based open/read strategy, verify the opened object is a regular file, enforce the byte limit while reading, and ensure the descriptor refers to the object whose bytes are hashed and decoded. Re-check workspace containment using the opened object's resolved identity where the platform supports it. If the host cannot establish a safe same-object snapshot, fail closed. This is a review requirement; it does not claim PR #198 currently closes this race.

For `resolve`, re-open through the same host confinement adapter, hash the current exact bytes, and repeat the quote/line check. If bytes or the unique match changed, return a stable stale/unverified result and do not return a verified catalog object. A file can change immediately after resolution; consumers must treat the returned object as a snapshot-bound result and must not cache it as permanently current.

### 11.4 Minimum tests by layer

**Parser/router**
- Known command accepted; unknown top-level and nested keys rejected.
- Task/workspace/reference/digest/authority fields rejected in model payload.
- Blank, NUL, absolute, drive, UNC, traversal, oversized path/quote rejected.
- Line zero, negative, fractional, unsafe integer, reversed range rejected.
- Task ID supplied only from `DirectorCommandContext`; empty task context fails before verifier invocation.
- Exactly one verifier call; no inspector/network/process fallback.

**Capability and host port**
- Missing port fails closed.
- Verified result only when host returns a complete valid result; capability rejects malformed adapter output.
- Unverified results never contain reference IDs.
- Catalog entries immutable; duplicate same-snapshot verification is idempotent.
- Cross-task/workspace resolution fails even with copied ID.
- Restart/eviction invalidates IDs; unknown ID is unverified, never re-derived from caller fields.
- Stale file, symlink swap, path replacement, truncation/growth during read, non-regular file, and read error fail closed.
- Exact bytes are hashed once and are the bytes used for matching.

**Trust regression**
- No change to Evidence.swift signing/receipt contracts, APEX approval, East authorization, BridgeGate, RuntimeController, LlamaEngine, or ToolSandbox.
- Existing Director, East, APEX, and evidence tests remain passing.
- D-04 cannot consume raw path/line strings as references; it must resolve host-issued IDs through the task catalog.


## PR #198 review-thread finding — 2026-11-18

A new COMMENTED review entry and one unresolved inline thread are now present on PR #198. The review author is the PR author account itself (`macksteward59-lgtm`), so this is a recorded self-review finding, **not independent review approval**.

The inline finding at `LocalProjectInspector.ts:182` identifies a concrete bounded-read race: `stat()` checks file size, then path-based `readFile()` buffers the entire file; a file that grows or is replaced between those operations can exceed the intended memory/read bound before the post-read byte-length check. It also asks for symlink-replacement protection at open time and a regression test for mutation between metadata validation and content read.

Disposition:
- Treat as a valid security hardening issue, not as an independent review.
- Required remediation: open the checked object with a no-follow strategy where supported; verify the opened descriptor is a regular file; enforce the byte ceiling during descriptor reads by reading at most `maxBytes + 1`; hash and match the same bytes; fail closed when safe containment cannot be established.
- Add deterministic regression coverage for growth/replacement between metadata check and read. Do not claim the existing oversized-file test covers this race.
- Keep PR #198 unmerged and D-02/D-04 gates unchanged until remediation, exact-head CI, and independent review are complete.
