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


## Bounded-read remediation coordination — 2026-11-18

- PR #198 remains open at its original feature head `17ac696687bfaaba3123eccb18c9f3d03bb1c13f`; no feature code was folded into it.
- A prior stacked remediation PR #199 was closed without merge during branch reconciliation. Its exact remediation snapshot (`fd1047b6931b8072f35239177416df0114f88171`) had a recorded green hosted Intelligence CI result in the #198 review-thread comments: 28 files / 336 tests passed, 2 skipped; LocalProjectInspector source and compiled suites each passed 11 tests. That result is not transferable to a different commit SHA as exact-head CI.
- Re-created the isolated remediation as draft PR #200: https://github.com/macksteward59-lgtm/pocket-ai-lab/pull/200
- PR #200 targets the unchanged #198 branch and adds descriptor-bound reads capped at `maxBytes + 1`, descriptor regular-file checks, final-component `O_NOFOLLOW`, guaranteed close, and deterministic growth/symlink regression tests.
- PR #200 explicitly records the residual limitation: this is not a portable `openat`/directory-descriptor guarantee against every parent-directory replacement race. Independent security review must decide whether the host platform needs stronger directory-handle confinement.
- PR #200 exact-head hosted CI and independent review are pending. Do not merge #198 or #200 yet; D-02 and D-04 remain gated.


## 2026-11-18 — PR #200 exact-head CI correction

- PR #200 remains open, draft, mergeable, and unmerged at exact head `947c1ac289f70779e336fde6dd9e6c687f191a07`, based on unchanged PR #198 head `17ac696687bfaaba3123eccb18c9f3d03bb1c13f`.
- Exact-head GitHub Actions Intelligence run [#44369945652](https://github.com/macksteward59-lgtm/pocket-ai-lab/actions/runs/44369945652) completed successfully. Dependency installation/advisory reporting, syntax checks, TypeScript type-check/build, and tests all completed successfully. This supersedes earlier notes that exact-head CI was pending; historical snapshot CI is not used as proof for this head.
- PR #200 has no submitted PR reviews and no inline review threads at this checkpoint. Exact-head CI is not independent security approval. Parent-directory replacement remains an explicitly disclosed residual limitation for independent review.
- PR #198 remains open and unmerged at its original feature head. The source-reference verifier is still adapter-only, without the Director command/capability/catalog integration; D-02 acceptance and D-04 remain blocked. No APEX/East/Evidence/BridgeGate/runtime authority contract changed and no merge was performed.


## 2026-11-18 — Parent-directory race decision tracked

- Created [issue #202](https://github.com/macksteward59-lgtm/pocket-ai-lab/issues/202) to obtain an explicit supported-platform/threat-model decision for parent-directory replacement during source-verifier path resolution.
- PR #200 now links issue #202 and remains draft/unmerged. Exact-head Intelligence CI run #44369945652 remains green for head `947c1ac289f70779e336fde6dd9e6c687f191a07`.
- Security review status remains unchanged: no independent PR review has been submitted. The issue requires a decision on directory-relative no-follow primitives, workspace identity pinning, adversarial replacement tests, and documented residual limitations.
- No source code or authorization boundary changed in this checkpoint. PR #198/#200 remain unmerged; D-02 acceptance and D-04 remain blocked.


## 12. Parent-directory containment platform assessment — 2026-11-18

### Repository/runtime facts

- The repository root `package.json` declares Node.js `>=22`; the consumer prototype documents Node.js 22+ and a portable desktop launcher for Windows and macOS. The source verifier is a Node filesystem adapter, not the Swift iOS inference runtime.
- The current PR #200 implementation calls `realpath(candidate)`, then `open(actual, O_RDONLY | O_NOFOLLOW)`. This pins the opened final file object and bounds reads, but does not pin each parent directory component from the workspace root.
- The documented Node `fsPromises.open(path, flags)` API accepts a pathname and returns a `FileHandle`; `fsPromises.opendir(path)` likewise opens a directory by pathname. The documented Node fs API does not expose a portable `openat(dirfd, relativePath, flags)` / directory-handle-relative child-open parameter. See [Node.js v22 fs documentation](https://nodejs.org/download/release/v22.23.3/docs/api/fs.html).
- Therefore, the existing Node-only adapter cannot claim portable descriptor-relative traversal merely by switching from `readFile` to `FileHandle`. `O_NOFOLLOW` remains final-component protection, not a root-confined walk across every parent component.

### Options for independent decision

| Option | Security property | Platform / operational cost | Disposition |
|---|---|---|---|
| A. Native host helper with directory-relative traversal | Can pin the root directory handle and open each path component relative to the prior handle, rejecting symlinks at every step; final file descriptor is read with the existing byte cap | Requires a small native helper per supported OS (e.g. POSIX `openat` + `O_DIRECTORY` + `O_NOFOLLOW`; Windows needs a separately reviewed handle-relative implementation). Must test macOS, Linux, Windows and packaging | Preferred if the threat model includes concurrent workspace mutation |
| B. Host-enforced immutable workspace snapshot | Verifier reads only a host-created snapshot whose directory tree is not writable by untrusted actors for the entire verification lifetime | Snapshot creation itself must be trusted and race-safe; same-user concurrent writers and ACL/ownership assumptions must be explicit. A mere advisory lock or repeated `realpath` is not enforcement | Acceptable only if the host can actually enforce and document the non-mutation assumption |
| C. Current pathname + final-component `O_NOFOLLOW` | Bounds reads and rejects final-component symlink substitution; does not prevent a parent-directory replacement race | Portable-ish Node implementation, but weaker containment | Not sufficient when concurrent workspace mutation is in scope |

### Review recommendation

Do not add an unverified Node path trick or a repeated `realpath`/ `lstat` check and call it race-free. Ask the independent reviewer to choose A or B based on the actual deployment threat model. If A is chosen, define a narrow host port such as `openWorkspaceFile(workspaceHandle, normalizedRelativePath, maxBytes)` returning a bounded byte snapshot and explicit cleanup; the native implementation owns all directory/file handles and fails closed on unsupported platforms. If B is chosen, make the trusted snapshot/lease an explicit host capability and test that callers cannot pass arbitrary roots or opt out of the immutability precondition.

No option is approved by this assessment. PR #200 remains a bounded-read improvement only; issue #202 is the decision gate. D-02 and D-04 remain blocked.
## 13. Host filesystem containment contract and adversarial test matrix — review draft

**Purpose:** specify the smallest host boundary needed if Issue #202 selects native directory-handle traversal. This is a contract for review, not approval to add a native dependency or claim a platform implementation exists.

### 13.1 Scope established by repository inspection

- The root package requires Node.js >=22.
- The README describes Windows and macOS desktop launcher scripts but explicitly says those scripts are untested. It does not establish a supported production OS matrix or native-helper packaging guarantees.
- The Director source verifier is a Node runtime adapter. The iOS Swift/LlamaEngine work is a separate runtime path and does not establish that a native filesystem helper is available to the desktop Node host.
- No existing openWorkspaceFile native host port or cross-platform directory-handle helper was identified in the inspected Director adapter/docs. Do not assume one exists.
- Accordingly, the first implementation decision is not which syscall should be called everywhere; it is to define which host platforms are actually supported for source verification. An unsupported host must return a stable unavailable result rather than silently falling back to the current weaker path walk.

### 13.1.1 Concrete composition and CI inventory (verified 2026-11-18)

The existing host integration point is now identified; the earlier wording should not be read as saying that Director has no project-inspection caller at all:

- `apps/web/directorRuntime.ts` constructs `LocalProjectInspector.open(options.workspaceRoot ?? process.cwd())` and injects that adapter as `projectInspector` when constructing `DirectorCapabilities`.
- `DirectorCapabilities.analyzeProject()` delegates to the injected `ProjectInspector.inspect()`; `DirectorCommandRouter` exposes the finite `analyze-project` command and dispatches it to that capability.
- The intelligence package therefore already has a host-injected `ProjectInspector` seam and a concrete web composition root. This is the preferred place to inject a future `ConfinedWorkspaceReader`-backed adapter; native filesystem details must remain outside `packages/intelligence`.
- The web composition currently accepts an optional caller-supplied `workspaceRoot` path and otherwise uses `process.cwd()`. That is a path-based bootstrap, not an opaque host-registered workspace identity or pinned directory session. The native design must replace/contain that trust boundary rather than forwarding this root path into a model-facing API.
- PR #198 adds excerpt verification to the concrete `LocalProjectInspector` adapter, but its new verifier operation is not yet part of the shared `ProjectInspector` interface or the `analyze-project` command contract. Existing project-inspection wiring must not be mistaken for end-to-end source-reference verification or D-04 identity binding.

**CI evidence and limits:**

- `.github/workflows/intelligence-ci.yml` runs the Node/TypeScript intelligence suite on `ubuntu-latest` with Node 22. This is Linux CI evidence only.
- The desktop launcher documentation says Linux is the archive build/smoke-test host and explicitly marks Windows/macOS entrypoints untested. No Windows filesystem-containment CI job was identified.
- `.github/workflows/ios-llamaengine-ci.yml` runs on `macos-15-intel` and builds/tests the Swift/iOS runtime, simulator, and macOS package. It does not exercise the Node `LocalProjectInspector` filesystem boundary on macOS, does not use a physical iPhone, and is not evidence of a desktop Node native-helper implementation.
- Accordingly, the current evidence does not establish a supported desktop OS matrix for confined source inspection. Do not infer macOS or Windows support from launcher scripts or the separate Swift workflow.

This inventory narrows the implementation seam but does not change the decision gate in section 13.6.

### 13.2 Proposed host-owned API

Keep native details outside packages/intelligence. A narrow host adapter may expose an opaque workspace session:

~~~ts
export interface WorkspaceReadSession {
  readonly workspaceHandle: string; // opaque host-issued selector; never a path
  close(): Promise<void>;
}

export interface WorkspaceFileSnapshot {
  readonly text: string;            // immutable decoded text from the one bounded read
  readonly byteLength: number;      // raw byte count, before decoding
  readonly sha256: string;          // SHA-256 of the exact raw bytes, before decoding
}

export interface ConfinedWorkspaceReader {
  openSession(input: { workspaceId: string }): Promise<WorkspaceReadSession>;
  readFile(input: {
    session: WorkspaceReadSession;
    relativePath: string;           // normalized POSIX relative path only
    maxBytes: number;
    rejectSymlinks: true;
    requireRegularFile: true;
  }): Promise<WorkspaceFileSnapshot>;
}
~~~

The public TypeScript shapes are illustrative. The host must not accept a caller-provided absolute root, file descriptor, native handle, or workspace path. The opaque session is created by the trusted host from its already-authorized workspace registration. The implementation must bind the session to that workspace identity and reject use after close, cross-workspace use, traversal, and unsupported object types.

**Resource lifecycle:**
1. Host opens/pins the workspace root and returns an opaque session.
2. Each path component is opened relative to the preceding pinned directory handle; reject . and .. after normalization, symlinks, and platform-specific reparse points. Never resolve the full attacker-influenced path and then reopen it from the process root.
3. Verify each opened intermediate object is a directory and the final object is a regular file.
4. Enforce the byte limit during the read, with a maximum of maxBytes + 1; reject overflow.
5. Hash and decode/match the same bytes. Do not perform a second path read for hashing or matching.
6. Close every intermediate and final handle on success, error, timeout, and cancellation. Session close invalidates future reads.
7. Return a completed snapshot containing an immutable string plus the raw byte count and digest. Compute SHA-256 over raw bytes before decoding; decode and match that same read. Do not expose a mutable Uint8Array or live descriptors/handles to model-facing code. The directory session, not the completed snapshot, owns the pinned directory handles and must close them deterministically.

### 13.3 Platform adapter requirements

- **POSIX hosts (macOS/Linux):** pin the root directory descriptor; walk each component with directory-relative opens and no-follow semantics; verify directory/file type using the opened descriptors. The implementation must account for filesystem-specific behavior and test the exact supported OS/filesystem combinations.
- **Windows hosts:** use a separately reviewed handle-relative traversal strategy that pins directory handles and rejects reparse-point traversal at each component. A final-component-only flag is not sufficient. The implementation must validate actual handle identity/type and document any filesystem or API limitations.
- **Other/unsupported hosts:** fail closed with a stable containment_unavailable reason. No fallback to realpath + open(path), lstat + open(path), or string-prefix checks.
- **iOS:** do not infer desktop helper support from the native inference target. If source inspection is ever hosted inside the iOS app, it must use a separate document-provider/security-scoped-resource contract and the OS-granted file scope; it must not attempt unrestricted app-container or filesystem traversal.

The native helper must define packaging/signing, ABI/version negotiation, supported OS versions, error-code mapping, cancellation behavior, descriptor/handle ownership, cleanup guarantees, and behavior when the helper cannot load. These are release gates, not optional diagnostics.

### 13.4 Deterministic adversarial tests

| Test | Adversarial action | Required outcome |
|---|---|---|
| Parent swap | Pause after opening/pinning a parent; replace a later path component with a symlink to an outside directory | Read remains bound to pinned workspace object or fails closed; outside bytes never returned |
| Intermediate symlink | Place a symlink/reparse point in each possible path component | Reject; never follow |
| Final symlink swap | Replace final entry immediately before open | Reject; never read target |
| Directory replacement | Rename/replace a directory after its handle is opened | Continue within the opened directory identity or fail; never follow replacement outside root |
| Hard link | Point an in-workspace regular file entry at an outside inode via hard link where supported | Apply documented policy: reject if identity-based workspace provenance is required; otherwise explicitly state that hard links cannot be distinguished by path confinement alone |
| File growth | Grow file during read beyond limit | Read no more than maxBytes + 1; reject overflow |
| File truncation/rewrite | Mutate content during read | Snapshot is one exact byte sequence; digest and quote match use same returned bytes; otherwise fail |
| Non-regular object | FIFO, socket, device, directory, reparse point | Reject without blocking |
| Cancellation | Cancel while opening/walking/reading | Close all acquired handles; no leaked descriptors |
| Handle/session misuse | Reuse after close or with another workspace | Reject |
| Resource exhaustion | Deep path, many concurrent reads, oversized limits | Bounded handles, memory, concurrency and time; fail predictably |
| Native helper failure | Missing library, ABI mismatch, unsupported OS, permission error | Stable unavailable/error result; no unsafe fallback |

Use barriers/hooks in the native test harness to make replacement timing deterministic; probabilistic stress loops alone do not prove race closure. Run tests on every supported OS in CI and retain the exact OS version, filesystem, Node version, native helper version, and test result.

### 13.5 Acceptance gates

- A reviewed supported-platform matrix exists; Windows/macOS scripts untested is not silently upgraded into production support.
- Every supported host has an implementation that pins the root identity and rejects symlink/reparse traversal at every component.
- Deterministic parent/intermediate/final replacement tests pass on each supported OS.
- Resource and cancellation tests show no descriptor/handle leaks and respect the configured byte/time/concurrency ceilings.
- The host adapter's failure paths are fail-closed; no path-based fallback.
- Source bytes are read once into a bounded immutable snapshot; SHA-256, text decoding, matching, and returned line ranges all refer to that same snapshot.
- Independent security review signs off on the implementation and its platform claims.
- Existing workspace authorization, APEX/East/Evidence, BridgeGate, RuntimeController, LlamaEngine, and ToolSandbox contracts remain unchanged.

### 13.6 Decision requested

Before implementation, obtain explicit answers from the independent reviewer and host owner:
1. Is concurrent modification by another process/user in scope for the workspace source verifier?
2. Which desktop operating systems and versions are release-supported for source verification, distinct from merely having launcher scripts?
3. Is a native helper acceptable for packaging and signing on each supported OS?
4. If not, can the host enforce an immutable snapshot for the entire verifier session, including against same-user concurrent writers?
5. Should iOS source inspection be out of scope for this increment?

Until these are answered, keep PR #200 as bounded-read remediation only, leave #198/#200 unmerged, and do not wire source-reference IDs into D-04.


### 13.1.2 Current PR #200 diff: bounded-read hardening versus confinement

A fresh review of the actual PR #200 patch (not only its CI result) confirms the following implemented properties:

- `openNoFollowFile(filePath)` uses `O_RDONLY | O_NOFOLLOW` when the platform exposes the flag and fails closed when it does not.
- The opened descriptor is checked with `fileHandle.stat()` and rejected unless it is a regular file.
- `readBoundedFileHandle` allocates at most `maxBytes + 1`, reads from the already-open descriptor, and returns overflow when the extra byte is observed.
- The descriptor is closed in a `finally` block.
- Added tests exercise growth after opening and a final-component symlink.

These are bounded-read and final-component protections only. The surrounding implementation still resolves the candidate to a full path and then opens that path. No pinned root directory handle or component-relative walk is present. Therefore intermediate parent components remain replaceable between resolution and open; final-component `O_NOFOLLOW` does not close that race. The added tests do not deterministically replace an intermediate parent after a parent handle is pinned, because no such handle-walk implementation exists yet.

**Disposition:** PR #200 may be evaluated only as a bounded-read remediation. It does not satisfy root confinement, issue #202, D-02 acceptance, or D-04 prerequisites. A coordination finding was posted to the PR discussion (comment ID `6989272622`); it explicitly is not independent security approval. Keep #200 draft/unmerged until the host-owned root-pinned reader, platform-specific adversarial tests, supported-host matrix, and independent review are complete.


### 13.1.3 PR #198 source-reference patch review — 2026-11-18

A complete diff review of PR #198 confirms that it adds `LocalProjectInspector.verifySourceReference()` and tests for exact excerpt matching, optional 1-based line ranges, duplicate/ambiguous matches, paraphrase rejection, invalid/traversal input, unsupported file types, symlink escape, dense duplicates, malformed input, and oversized quote/file cases. Its method-level documentation correctly limits the result to source presence; it does not claim exploitability, reachability, authenticity, or authorization.

The patch does **not** add this operation to the shared `ProjectInspector` interface, `DirectorCommandRouter`, or the command schema. The existing host composition remains `analyze-project`; therefore #198 alone is not an end-to-end source-reference workflow and does not bind source references into D-04.

The new method calls the same `readEligibleTextFile()` in #198, which still performs `realpath(candidate)`, then `stat(actual)`, then `readFile(actual)`. It therefore retains the parent-directory TOCTOU exposure and reads the whole file before checking the byte length. The oversized-file test covers a static oversized file, not a concurrent growth/read-time bound. PR #200's descriptor-bounded read is a separate change and is not included in #198's diff; even #200 does not pin the root or traverse relative to pinned parent handles.

**Disposition:** keep #198 unmerged and do not connect its result to D-04. Resolve issue #202's containment decision, implement and independently review the host-owned reader, then make excerpt verification consume the reader's single bounded immutable snapshot. The source-reference API and authority boundary require their own review after the filesystem contract is settled. A coordination finding was posted to issue #202; it is not independent security approval.
