# WORK-20261115 — Native inference composition and artifact integrity

## Status

`in_progress` — #110 is the current consolidated native runtime/UI integration candidate. #104 is a validated predecessor. #107 and #109 remain separate drafts with native iOS CI still running. #110 has new lease-boundary hardening committed and companion workflows pass; its fresh iOS CI is still building pinned llama.cpp.

## Objective

Complete the shared native inference composition root and bind every native model session to the exact imported GGUF bytes without weakening APEX/East authorization boundaries.

## Acceptance criteria

- [x] Refresh main, relevant PR heads, ancestry, reviews, and workflows.
- [x] Verify NativeInferenceRuntime composes one engine, ModelPool, and InferenceScheduler.
- [x] Verify LocalChatModel and Agent Team coordinator can use the shared runtime and exact lease.
- [x] Verify scheduler permits cover the full generation stream.
- [x] Verify cancellation awaits exact-request drain before releasing scheduler capacity.
- [x] Add tests for stream-wide scheduling and lease retention during blocked cancellation drain.
- [x] Stage GGUF import and preserve the previous file on invalid input.
- [x] Reject magic-only/truncated GGUF files and unsupported v1-v3 version values; validate the minimum 24-byte header.
- [x] Fix the two stale 14-byte importer fixture expectations on #107; fresh iOS CI is running.
- [x] Add streaming SHA-256 artifact identity.
- [x] Bind ModelDescriptor.id to the artifact digest and recheck before/after native load.
- [x] Add tests for mutation before/during load and exact session cleanup.
- [x] Retarget #109 aggregate to main so the complete dependency chain can receive iOS CI.
- [x] Preserve active ModelPool lease handles when artifact preflight reads fail; retain the exact acquired lease if release unexpectedly fails.
- [x] Add regression test for an unreadable artifact after a successful load and verify the retained lease remains unloadable.
- [x] Require exact active ModelPool leases for public native generation; reject stale and foreign leases.
- [x] Pin in-flight generation use so lease release cannot permit premature native unload.
- [x] Add regression tests for released/foreign leases and release-during-generation.
- [ ] Complete fresh iOS LlamaEngine CI and inspect XCTest logs on #107 latest head.
- [ ] Complete aggregate iOS LlamaEngine CI and inspect XCTest logs on #109 latest head.
- [ ] Complete new #110 iOS LlamaEngine CI on commit `5887883e40fe3298cec87653ab05ac235ba8b10f` and inspect app/simulator/macOS XCTest.
- [ ] Review the final combined diff and resolve any concrete CI/review findings.
- [ ] Physical iPhone validation of memory, thermal, battery, Metal, and inference behavior.
- [ ] Keep PRs draft; do not merge.

## Current GitHub coordinates

- Main SHA: `818799eced634577c8f1760fa2bdd1f657bd8427`
- PR #107: https://github.com/macksteward59-lgtm/pocket-ai-lab/pull/107
- #107 head: `ed32fecef579dfd53c0263c3e73f00d95cc1af32`; branch `codex/ios-model-pool-composition-mainline`; 31 ahead / 0 behind main.
- #107 previous iOS run `43731298841` failed two expected-value assertions; corrected head run `43740561987` was in progress compiling pinned llama.cpp at last check.
- PR #109: https://github.com/macksteward59-lgtm/pocket-ai-lab/pull/109
- #109 head: `a6de5e5387a0f6745c61ba509678fae3811d0cf6`; branch `codex/ios-content-addressed-model-integrity-mainline`; base main; 41 ahead / 0 behind; 15 files changed.
- #109 iOS run `43740720673` remains in progress building pinned llama.cpp.
- PR #104: https://github.com/macksteward59-lgtm/pocket-ai-lab/pull/104
- #104 head: `bf7a61c9732c23a6e7b23ad43ff0e415b6d745b4`; base main; 29 ahead / 10 behind. iOS LlamaEngine run `43731823992` succeeded, including app XCTest, simulator XCTest, pinned smoke GGUF, and macOS XCTest.
- PR #106/#99 remain open drafts and are not the active top-level integration branch.

## Completed implementation evidence

### PR #107 — shared runtime and importer guard

- `NativeInferenceRuntime.swift`: shared engine, ModelPool, and scheduler composition.
- `ModelPool.swift`: actor-isolated session ownership, coalesced loads, exact leases, memory admission, safe unload accounting.
- `InferenceScheduler.swift`: FIFO bounded concurrency and permit release.
- `LocalChatView.swift`: native chat uses the shared runtime.
- `NativeAgentCoordinator.swift`: runtime-backed coordinator path.
- Tests cover scheduler stream duration, cancellation-drain lease retention, FIFO ordering, cancelled waiters, model pool accounting, and importer behavior.
- Commit `ed32fecef579dfd53c0263c3e73f00d95cc1af32` updates both stale expected fixture values to the exact valid 24-byte header.

### PR #109 — content identity and lease-lifecycle hardening

- `ModelArtifactFingerprint.swift`: streaming SHA-256 in 1 MiB chunks with byte count.
- `LocalChatView.swift`: staged artifact fingerprinting, content-addressed descriptor ID, pre/post-load file identity checks, and exact lease/session cleanup.
- `PocketAILabTests.swift`: tests for content IDs, mutation before/during load, unreadable artifact after load, truncated/unsupported headers, staged preservation, and same-path import.
- `docs/architecture/native-ios-model-artifact-integrity-v1.md`: explicit import/load integrity contract and limitations.
- Fix commit `613a1c4426babfe335f0d8d699be6ecd2f466417`: avoid clearing an existing lease on preflight errors and retain an acquired lease if exact release unexpectedly fails.
- Regression test commit `a6de5e5387a0f6745c61ba509678fae3811d0cf6`: removes the artifact after successful load, verifies the lease remains reachable, then unloads it successfully.
- The aggregate is now based directly on main and includes shared runtime + artifact integrity in one 41-commit, 15-file draft. No CI pass is claimed yet.

### Artifact predecessor PR #104

- Previous iOS run `43728039752` failed two assertions: Agent Team status wording and bracketed IPv6 loopback.
- Latest head `bf7a61c9732c23a6e7b23ad43ff0e415b6d745b4` contains both fixes.
- iOS run `43731823992` completed successfully through app XCTest, simulator XCTest, pinned smoke GGUF download, and macOS XCTest.
- Keep #104 as a validated predecessor, not the preferred integration base.

## PR #110 — consolidated native runtime/UI integration

- Branch: `codex/ios-agent-team-workspace-mainline`; base main; current head `5887883e40fe3298cec87653ab05ac235ba8b10f`; 18 files changed; open draft.
- Draft PR: https://github.com/macksteward59-lgtm/pocket-ai-lab/pull/110
- Carries #107/#109 shared runtime and content identity, #84 Workspace navigation/URL policy, and #85 bounded six-role Agent Team UI through the shared runtime.
- Coordinator limits: 4k-byte objective, up to 16 capabilities, 1–8 unique roles, 64-byte IDs, 1k-byte instructions, 12k-byte prompts, last four prior outputs truncated to 1.2k bytes, 8k-byte response cap, 512 tokens per role.
- Lease-boundary hardening commit: `5887883e40fe3298cec87653ab05ac235ba8b10f`.
  - Public `NativeInferenceRuntime.generate` now requires a `ModelPoolLease`, not a bare `RuntimeSession`.
  - ModelPool creates an exact in-flight use pin before scheduler admission and holds it through stream completion or cancellation drain.
  - Releasing a lease during generation cannot make its session unloadable until the use pin ends; unload and idle eviction reject/skip active uses.
  - Stale and foreign leases are rejected. The raw engine is internal, and direct-engine coordinator construction is internal for package tests.
  - App chat and Agent Team production paths pass the exact lease.
  - Added regression tests for released leases, foreign leases, and release during an active generation.
- Exact-head companion CI on commit `5887883e40fe3298cec87653ab05ac235ba8b10f`:
  - Pocket AI Lab `43741621091` — success.
  - Consumer prototype `43741621024` — success.
  - Cursor collaboration plugin `43741621050` — success.
  - Governance sidecar `43741621040` — success.
  - iOS LlamaEngine `43741621034` — in progress building pinned llama.cpp for simulator/macOS; app build and XCTest are pending.
- Previous iOS run `43741079412` was cancelled after the new commit moved the branch head. No XCTest result is yet available for the lease-boundary change.
- No submitted reviews or inline review threads returned for #110 at last check.
### Older dependency-chain reconciliation

- #84: 7 ahead / 10 behind current main, open non-draft; historical iOS run `43653686561` and four companion workflows succeeded. Workspace improvements are carried forward; older importer superseded.
- #85: 19 ahead / 10 behind, open draft stacked on #84; no independent workflow run found. Agent Team UI and bounded coordinator behavior are carried forward through the shared runtime.
- #86: 26 ahead / 14 behind, open draft; historical iOS run `43654228679` cancelled. Standalone ModelPool/Scheduler primitives are superseded by #107's app-wired composition.
- #88: 29 ahead / 10 behind, open draft stacked on #85; historical iOS run `43728039752` failed. Its content hashing/import path is superseded by #109.
- #104: older aggregate with the Agent Team/import stack; iOS run `43731823992` passed app, simulator, smoke-model and macOS XCTest. Keep as validated predecessor, not primary integration branch.

## Risks / limitations

- The 24-byte GGUF check is a minimum header guard, not full metadata/tensor parsing; llama.cpp performs authoritative parsing.
- SHA-256 binds local bytes but does not prove publisher identity, provenance, safety, runtime attestation, or authorization.
- Memory admission uses a file-size heuristic and advisory app-allocatable memory; physical-device calibration is outstanding.
- Runtime trust remains Unverified.
- A lease, digest, session, scheduler permit, model output, or evaluation cannot authorize an action.
- No local Xcode tests were run outside hosted GitHub Actions; no physical-device tests were run.

## Next action

Refresh runs `43740561987` (#107), `43740720673` (#109), and `43741621034` (#110), inspect XCTest logs and all workflow conclusions, and fix only concrete failures. Then inspect the combined #110 diff and review threads. Do not merge. Continue with runtime-proof key lifecycle and durable skill-approval services only after preserving the above trust boundaries.


## Current continuation status — 2026-11-15 17:39 UTC

- Current integration candidate is PR #110 at `b865b519084e0287f8680e7610bdc69b852fdaf1`.
- Lease-bound generation is hardened with exact active lease validation, pre-scheduler use pins, unload/idle eviction protection, and stale/foreign lease rejection.
- Added regression coverage for queued-request cancellation and output-limit failure retaining the pin until cancellation drain completes.
- Native chat now includes bounded in-memory prior turns (last 8 user/assistant messages, max 6,000 UTF-8 bytes), explicitly excluding Agent Team role output and runtime diagnostics. The prompt transcript is untrusted context; no persistent chat or long-term memory is implemented.
- XCTest additions cover chat follow-up context, oversized prompt truncation, queued-generation cancellation, and output-limit drain lifetime.
- Architecture documentation has been updated for lease pinning and bounded chat context.
- Next: inspect latest-head iOS CI and companion workflows; fix only concrete failures; verify all native app, simulator, and macOS XCTest steps. After native validation, add persistence only with a separate bounded storage and privacy design. Keep PRs draft; do not merge.
