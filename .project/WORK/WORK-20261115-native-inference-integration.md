# WORK-20261115 — Native inference composition and artifact integrity

## Status

`in_progress` — shared native inference composition and content-addressed artifact integrity are implemented on separate current-mainline drafts. #104 is now a validated predecessor. #107's corrected importer fixture is under fresh iOS CI. #109 is the mainline aggregate and is under its first complete native iOS CI run, including a newly added lease-retention regression test.

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
- [ ] Complete fresh iOS LlamaEngine CI and inspect XCTest logs on #107 latest head.
- [ ] Complete aggregate iOS LlamaEngine CI and all companion workflows on #109 latest head.
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
- #109 iOS run `43740720673` was pending at last check; Pocket AI Lab, Consumer prototype, Cursor collaboration plugin, and Governance sidecar workflows were in progress.
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

## Risks / limitations

- The 24-byte GGUF check is a minimum header guard, not full metadata/tensor parsing; llama.cpp performs authoritative parsing.
- SHA-256 binds local bytes but does not prove publisher identity, provenance, safety, runtime attestation, or authorization.
- Memory admission uses a file-size heuristic and advisory app-allocatable memory; physical-device calibration is outstanding.
- Runtime trust remains Unverified.
- A lease, digest, session, scheduler permit, model output, or evaluation cannot authorize an action.
- No local Xcode tests were run outside hosted GitHub Actions; no physical-device tests were run.

## Next action

Refresh runs `43740561987` (#107) and `43740720673` (#109), inspect XCTest logs and all workflow conclusions, and fix only concrete failures. Then inspect the combined #109 diff and review threads. Do not merge. Continue with runtime-proof key lifecycle and durable skill-approval services only after preserving the above trust boundaries.
