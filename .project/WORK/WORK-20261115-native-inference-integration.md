# WORK-20261115 — Native inference composition and artifact integrity

## Status

`in_progress` — shared inference composition is implemented on a current-mainline branch; iOS CI is still running. Content-addressed integrity is implemented in a stacked draft PR but has not yet received iOS XCTest validation.

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
- [ ] Complete iOS LlamaEngine CI and inspect XCTest logs on latest #107 head.
- [x] Add streaming SHA-256 artifact identity on a branch stacked on #107.
- [x] Bind ModelDescriptor.id to the artifact digest and recheck before/after native load.
- [x] Add tests for mutation before/during load and exact session cleanup.
- [ ] Obtain iOS/XCTest validation for #109 after it is rebased/retargeted onto a main-based integration branch.
- [ ] Physical iPhone validation of memory, thermal, battery, Metal, and inference behavior.
- [ ] Keep PRs draft; do not merge.

## Current GitHub coordinates

- Main SHA: `818799eced634577c8f1760fa2bdd1f657bd8427`
- PR #107: https://github.com/macksteward59-lgtm/pocket-ai-lab/pull/107
- #107 head: `104389c5e85b47d09954a230c01fd57714b5ea78`; branch `codex/ios-model-pool-composition-mainline`; 27 ahead / 0 behind main.
- PR #109: https://github.com/macksteward59-lgtm/pocket-ai-lab/pull/109
- #109 head: `b37d78fdec64062e738cd076ed994861d90331e6`; branch `codex/ios-content-addressed-model-integrity-mainline`; base #107 branch; 8 ahead / 0 behind.
- PR #104: https://github.com/macksteward59-lgtm/pocket-ai-lab/pull/104
- #104 head: `bf7a61c9732c23a6e7b23ad43ff0e415b6d745b4`; 29 ahead / 10 behind main.
- PR #106/#99 remain open drafts and are not the active top-level integration branch.

## Completed implementation evidence

### PR #107

- `NativeInferenceRuntime.swift`: shared engine, ModelPool, and scheduler composition.
- `ModelPool.swift`: actor-isolated session ownership, coalesced loads, exact leases, memory admission, safe unload accounting.
- `InferenceScheduler.swift`: FIFO bounded concurrency and permit release.
- `LocalChatView.swift`: native chat uses the shared runtime.
- `NativeAgentCoordinator.swift`: runtime-backed coordinator path.
- Tests cover scheduler stream duration, cancellation-drain lease retention, FIFO ordering, cancelled waiters, model pool accounting, and importer behavior.
- Latest CI run IDs: #107 iOS `43731298841` (in progress); other four PR workflows on the latest head succeeded.
- The iOS job had only completed setup/build preparation and was compiling pinned llama.cpp at last check. No XCTest result yet.

### PR #107 importer hardening commits

- `bbc47302e20a33e814882932776cc51d5192d2db`: minimum 24-byte GGUF header validation.
- `9c2bdcdfef2412cd654f4d01be18b6497d71a4b2`: truncated/unsupported-version regression tests.
- `104389c5e85b47d09954a230c01fd57714b5ea78`: documentation boundary update and latest PR head.

### PR #109 artifact-integrity commits

- `38c3f89a67582321a5bc1ab60ea13db8dc4c2ea1`: streaming fingerprint primitive.
- `712de6c326d86cdc92843b417fd967bea6f1df2e`: pooled session content identity and pre/post-load checks.
- `98dc97cbadc0cc310beae75acaabe3d4140c11d2`: avoid capturing the main-actor model in detached import task.
- `351e0c2d76fe8eb76ca54ffc3f78005d099a56cf`, `9607087be8e4f5dfd073f6601c13879c318488f7`, `73de23fec412e97fe7e1f5905915e1b6fa6f04eb`: fingerprint and mutation regression tests plus test corrections.
- `273af18dc845f26e789b43aa41188ab88625d6d8`: integrity contract documentation.
- `b37d78fdec64062e738cd076ed994861d90331e6`: display fingerprint summary in native UI.
- Pocket AI Lab CI run `43731687148` succeeded (syntax, type-check/build, JS tests). This workflow does not execute Swift/XCTest.

## Artifact predecessor PR #104

- Prior iOS run `43728039752` failed in XCTest after app build/link succeeded.
- Failure 1: assertion expected the word "six" while UI emitted "6".
- Failure 2: bracketed IPv6 loopback `[::1]` was not accepted by host validation.
- Fixed on latest #104 head `bf7a61c9732c23a6e7b23ad43ff0e415b6d745b4`.
- Latest iOS run `43731823992` is in progress. No passing result yet.

## Risks / limitations

- The 24-byte GGUF check is a minimum header guard, not full metadata/tensor parsing; llama.cpp performs authoritative parsing.
- SHA-256 binds bytes locally but does not prove publisher identity, provenance, safety, runtime attestation, or authorization.
- Memory admission uses a file-size heuristic and advisory app-allocatable memory; physical-device calibration is outstanding.
- Runtime trust remains Unverified.
- A lease, digest, session, scheduler permit, model output, or evaluation cannot authorize an action.
- #109's base is #107's feature branch. The iOS workflow is configured only for pull requests targeting main, so #109 has no iOS CI result until it is integrated/rebased into a main-targeting branch.
- No local Xcode tests were run in this session; no physical-device tests were run.

## Next action

Refresh the latest #107 and #104 iOS workflow runs. When they complete, inspect job steps and full XCTest logs, repair only concrete failures, and record exact evidence. Then rebase/integrate #109 onto a main-targeting candidate so the native iOS workflow can validate the combined shared-runtime + content-integrity implementation. Continue with runtime-proof key lifecycle and durable skill-approval services only after preserving the above trust boundaries.
