# Parallel engineering execution model v1

## Objective

Increase Pocket AI Lab delivery throughput by running independent engineering lanes concurrently while preserving one architecture authority, explicit dependency contracts, and fail-closed trust boundaries. Speed is measured by validated, integrated capability—not branch count or lines changed.

## Baseline verified for this plan

- Native iOS catalog and local history work is under draft PR #115, based on the native inference integration chain.
- On PR #115 exact head `3a9fb36cbfe24187ca06906a76ffc657b9605e64`, Pocket AI Lab, Consumer prototype, Governance sidecar, and Cursor collaboration workflows passed.
- Its iOS LlamaEngine workflow was still building pinned llama.cpp; later app build and XCTest stages had not started at the last check.
- A separate corrected Agent Team history run had reached native app XCTest after successfully completing pinned llama.cpp, fail-closed typecheck, physical-device-slice linking, simulator selection, and native app build. Its final XCTest result was not yet known.
- The existing integration audit documents a major gap: native Swift local chat and the TypeScript agent orchestrator are separate execution paths. No end-to-end iOS native-orchestrator bridge is demonstrated.
- The pinned llama.cpp revision is tag `b12233`, commit `5f490d7bfe78844e6390c869454c149fd7e003a8`.

## Operating model

One integration authority owns architecture decisions, cross-lane interfaces, branch dependencies, and final validation. Each implementation lane owns a bounded scope and its own feature branch. No lane changes another lane's owned files without coordination.

### Lane A — Native runtime and model metadata

**Goal:** make the local runtime report grounded model metadata and measurable resource facts.

- Verify the exact APIs in the pinned llama.cpp headers before binding metadata calls.
- Extract only metadata that the pinned library actually reports: architecture, training context, tokenizer family/metadata, and quantization when available.
- Keep unknown or unavailable fields explicitly unknown; never infer capabilities from filenames.
- Separate model-declared metadata from runtime-observed facts and evaluation-derived capabilities.
- Add bounded DTOs, malformed/missing metadata tests, and compatibility tests against the pinned build.

**Acceptance:** metadata is sourced from the pinned native library, bounded, testable, and cannot grant runtime readiness or authorization.

### Lane B — Native agent orchestration integration

**Goal:** connect the existing agent workflow to the actual iOS native inference runtime.

- Resolve the architecture decision first: native-first Swift coordinator versus embedded TypeScript runtime. Do not create a hybrid accidentally.
- Define a language-neutral request/result contract and typed failure states.
- Require a live native runtime lease/session for inference; registry selection is not readiness.
- Map one agent inference request to one exact native generation request and preserve request-scoped cancellation/drain.
- Treat every model response as untrusted proposal data.
- Add parity tests for fake and native providers and end-to-end tests through the chosen composition root.

**Acceptance:** a native iOS agent task can be traced through the real runtime, with session/hash/request identity and typed failures; no agent can authorize tools or bypass APEX/Director or East/e3.

### Lane C — Governance and adversarial validation

**Goal:** independently test the security invariants across all parallel changes.

- Verify model outputs, agent consensus, model metadata, registry entries, session IDs, leases, and successful inference never become action authority.
- Test stale/foreign leases, hash changes, expired sessions, cancellation races, malformed agent messages, replay, and fail-closed storage.
- Preserve BridgeGate trusted-origin authorization, RuntimeController lifecycle, ExploitGym isolation, and signed Evidence authority.
- Review every lane's diff and threat model before integration.

**Acceptance:** security regression suite passes on the combined candidate; no new trust root, permission path, or evidence authority is introduced.

### Lane D — Durable memory and knowledge

**Goal:** evolve bounded transcript persistence into explicitly typed, user-controllable memory/knowledge without conflating it with evidence.

- Inventory current transcript and task journal stores.
- Define separate schemas and retention/deletion behavior for conversation history, task journal, derived memory, and verified knowledge.
- Add provenance, source references, freshness, and conflict handling for derived facts.
- Ensure retrieved memory is untrusted context, not instructions or authority.
- Require explicit controls for retention, export, and deletion.

**Acceptance:** memory retrieval is bounded, auditable, provenance-aware, and cannot silently alter policy or authorization.

### Lane E — Performance, packaging, and device acceptance

**Goal:** remove avoidable build and runtime bottlenecks and produce an honest iPhone acceptance result.

- Cache the pinned llama.cpp source/build artifacts using exact commit and checksum keys.
- Keep simulator, physical-device, and macOS slices distinct.
- Avoid duplicate full workflow runs where a targeted failed-job retry is sufficient.
- Measure model load time, first-token/complete-response latency, peak memory, KV-cache cost, thermal behavior, and battery use on supported physical devices.
- Maintain a reproducible iPhone acceptance checklist; hosted CI is not physical-device proof.

**Acceptance:** repeatable CI plus documented physical-device measurements; no performance claims from simulator-only evidence.

### Lane F — Integration, release evidence, and docs

**Goal:** keep integration moving without waiting for every lane to finish.

- Track dependencies and interface freeze dates.
- Integrate small compatible increments as stacked draft PRs.
- Run narrow tests on every change and full cross-project CI at integration checkpoints.
- Reconcile changed files, review comments, exact commit SHAs, CI, and known limitations.
- Keep a single current status record with completed, pending, blocked, and unverified work.

**Acceptance:** every reported capability maps to a commit, test evidence, and an explicit limitation.

## Dependency graph and concurrency

- Lanes A, C, D, and E can begin independently against the current integration candidate.
- Lane B can begin contract discovery immediately, but implementation depends on choosing native-first Swift or embedded TypeScript. Its first deliverable is a short decision record and DTO contract; implementation then proceeds in parallel with A.
- Lane F runs continuously and integrates only compatible changes.
- Changes to shared files require an owner and a short coordination note before editing.
- Each lane has one branch and one draft PR. Stacked PRs target their actual parent branch; no duplicate mainline aggregate is created merely to make a status look green.

## Efficiency rules

1. Prefer one small vertical slice with tests over broad scaffolding.
2. Reuse existing abstractions; do not create duplicate model registries, schedulers, stores, or agent managers.
3. Batch independent read operations and CI inspection; serialize writes to the same branch/path.
4. Run fast unit/static checks first, then platform builds, then full suites.
5. Retry only failed jobs when the source head is unchanged; any code change requires fresh exact-head CI.
6. Do not start expensive builds for a branch until its dependency and compile surface is understood.
7. Record blockers as explicit work items with an owner, next action, and acceptance criterion.
8. No merging, main-branch writes, visibility changes, or permission changes without explicit user approval.

## Schedule compression and realism

A few hours to one day can be a useful target for a focused, reviewable vertical slice or a coordinated prototype if CI capacity and interfaces cooperate. It is not a responsible promise for a production-ready, secure, fully integrated mobile intelligence platform with physical-device validation. The project should be time-boxed into:
- **Hours:** reconcile current CI, lock interfaces, complete independent low-risk slices, and expose integration blockers.
- **One day:** deliver a working end-to-end vertical slice plus tests and draft PRs if the dependency chain and CI cooperate.
- **Beyond one day:** harden, benchmark, validate on the actual iPhone, resolve security review findings, and complete broader platform integration.

Never skip security, tests, or physical-device validation to meet a calendar target.

## Authority and safety invariants

- APEX/Director remains the approval authority.
- East/e3 remains the durable workflow execution boundary.
- ExploitGym remains isolated evaluation.
- BridgeGate remains the trusted-origin/message authorization boundary.
- RuntimeController and LlamaEngine report runtime lifecycle/inference, not policy authority.
- Signed Evidence remains independently verified; no model, agent, catalog entry, session, lease, or consensus can issue or replace it.
- Model output, retrieved memory, and research content remain untrusted data.
