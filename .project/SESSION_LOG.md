# Continuity session log

Append a dated entry for each meaningful session. Include branch, commits, tests, PRs, and next action. Do not rewrite prior entries.

## 2026-11-15 — Continuity system initialized

- Repository: `macksteward59-lgtm/pocket-ai-lab`
- Main SHA verified: `818799eced634577c8f1760fa2bdd1f657bd8427`
- PR #107 verified open/draft, base `main`, head `4d22c66c497ea0562259b665435a15efde93ca0b`; mergeable according to GitHub metadata.
- PR #106 verified open/draft, stacked on `codex/ios-model-pool-rebased-mainline`.
- Created a continuity-system feature branch from the verified main SHA.
- Added repository-wide resume/checkpoint instructions and initial project/work state records.
- Tests: documentation-only change; no application tests run.
- Next: validate the continuity files, open a draft PR, then update the primary native-inference work record as new evidence is gathered.

## 2026-11-15 — Autonomous native inference and artifact integrity continuation

- Main SHA refreshed: `818799eced634577c8f1760fa2bdd1f657bd8427`.
- PR #107 refreshed: open draft, base main, 27 ahead / 0 behind, head `104389c5e85b47d09954a230c01fd57714b5ea78`.
- PR #107 current workflows: Pocket AI Lab CI, Consumer prototype CI, Governance sidecar CI, Cursor collaboration plugin CI succeeded; iOS LlamaEngine CI run `43731298841` still in progress compiling pinned llama.cpp.
- Inspected #107 NativeInferenceRuntime, ModelPool, InferenceScheduler, LocalChatModel, NativeAgentCoordinator, cancellation tests, importer and CI patch/logs.
- Strengthened the importer to require a 24-byte minimum GGUF v1-v3 header; added truncated/unsupported-version tests. Commits: `bbc47302e20a33e814882932776cc51d5192d2db`, `9c2bdcdfef2412cd654f4d01be18b6497d71a4b2`, `104389c5e85b47d09954a230c01fd57714b5ea78`.
- PR #109 created as a draft stacked on #107. Added streaming SHA-256, content-addressed model IDs, pre/post-load fingerprint verification, session unload on mutation, UI fingerprint summary, tests, and architecture documentation. Latest head `b37d78fdec64062e738cd076ed994861d90331e6`. Pocket AI Lab CI run `43731687148` succeeded; this did not execute Swift/XCTest.
- PR #104 refreshed: 29 ahead / 10 behind main. Fixed two XCTest assertions on its latest head `bf7a61c9732c23a6e7b23ad43ff0e415b6d745b4`; iOS run `43731823992` in progress. Previous run `43728039752` failed two XCTest assertions.
- PR #100 runtime proof candidate has 8 ahead / 0 behind and all five workflows succeeded. Inspected verifier and Keychain replay store: production key provisioning, signer, rotation/revocation, app wiring, and cross-process atomic replay protection remain absent.
- PR #101 skill lifecycle aggregate has 11 ahead / 0 behind and all four workflows succeeded. Exact rubric digest binding is implemented, but authenticated human identity, durable approval/revocation, restart-safe authorization, and transactional replay prevention remain missing.
- Reviews: no submitted reviews were returned for the inspected PRs at time of check.
- Tests executed directly in this session: none (no local Xcode environment). CI results are reported separately above.
- No merges, main changes, permission changes, or visibility changes.
- Next: complete latest iOS CI inspection, then integrate #109 onto a main-targeting candidate for native XCTest validation.


## 2026-11-15 — Native CI repair and aggregate lease-lifecycle hardening

- Refreshed live repository state. Main remains `818799eced634577c8f1760fa2bdd1f657bd8427`; no main changes or merges.
- PR #107 latest head before repair `104389c5e85b47d09954a230c01fd57714b5ea78` failed only two app XCTest assertions in the staged-importer test: it expected 14 bytes although the minimum valid GGUF fixture is 24 bytes. Device framework linking and app build succeeded.
- Fixed both stale expected values on #107. Commit: `ed32fecef579dfd53c0263c3e73f00d95cc1af32`. New iOS run `43740561987` was still building pinned llama.cpp at checkpoint; companion workflows were still running.
- PR #104 iOS run `43731823992` completed successfully, including native app XCTest, simulator XCTest, smoke GGUF download, and macOS XCTest. Updated its PR description to reflect the actual pass.
- Retargeted #109 from the #107 feature branch to `main`, creating a 38-commit/15-file mainline aggregate at that point. After follow-up hardening, its latest head is `a6de5e5387a0f6745c61ba509678fae3811d0cf6`, 41 commits ahead / 0 behind main.
- Reviewed the content-integrity reload path and found a lease leak: if the artifact became unreadable while reloading an already-loaded model, the outer catch cleared the only UI lease reference while ModelPool retained the lease. Fixed by preserving existing lease state on preflight errors and retaining an acquired lease if exact release unexpectedly fails. Commits: `613a1c4426babfe335f0d8d699be6ecd2f466417` and regression test `a6de5e5387a0f6745c61ba509678fae3811d0cf6`.
- Added an explicit comment to the 24-byte fixture helper. The aggregate #109 iOS run `43740720673` was pending at checkpoint; Pocket AI Lab, Consumer prototype, Cursor collaboration plugin, and Governance sidecar workflows were in progress. No aggregate CI pass is claimed.
- Updated PR #107 and #109 descriptions with accurate current heads, CI state, limitations, and safety boundaries. Both remain draft; no submitted review threads were returned for #107/#109/#104 at last check.
- Updated `.project/STATE.md` and the native-inference work record to preserve current heads, run IDs, known failure, fixes, and next actions.
- No local Xcode execution or physical iPhone testing. No merge, main-branch write, permission change, or visibility change.
- Next: refresh #107 run `43740561987` and #109 run `43740720673`; inspect all jobs and XCTest logs; fix concrete failures only; inspect combined diff and review threads; keep all PRs draft.


## 2026-11-15 — Older native dependency-chain reconciliation and full UI aggregate

- Audited PRs #84, #85, #86, and #88 against current main `818799eced634577c8f1760fa2bdd1f657bd8427`, fetched exact PR metadata/diffs, and checked reviews, inline threads, ancestry, and CI.
- #84 is 7 ahead / 10 behind, open non-draft; historical iOS run `43653686561` and companion workflows passed. Its Workspace restore/navigation and URL policy were worth carrying forward; its older magic-only importer is superseded by the newer staged 24-byte GGUF + SHA-256 path.
- #85 is 19 ahead / 10 behind, open draft stacked on #84, with no independent CI run found. Its six-role native Agent Team UI and coordinator bounds were missing from #109's app view; these have now been ported to the shared runtime.
- #86 is 26 ahead / 14 behind, open draft; iOS run `43654228679` was cancelled. Its ModelPool/Scheduler primitives are superseded by #107's app-wired NativeInferenceRuntime composition.
- #88 is 29 ahead / 10 behind, open draft stacked on #85; historical iOS run `43728039752` failed. Its content hash path is superseded by #109's stronger content-addressed implementation.
- PR #104's iOS run `43731823992` is now confirmed successful through app XCTest, iOS Simulator XCTest, smoke GGUF download, and macOS XCTest.
- Created draft PR #110: https://github.com/macksteward59-lgtm/pocket-ai-lab/pull/110. Branch `codex/ios-agent-team-workspace-mainline`, head `c2e15444395d4536081a0e52cdb83e6b4afb5710`, 49 ahead / 0 behind main, 18 files changed.
- #110 carries #107/#109 shared runtime and content identity, adds #85's bounded six-role Agent Team UI using the shared lease/scheduler, and ports #84's Workspace navigation/URL policy.
- Coordinator limits added: 4k-byte objective, up to 16 capabilities, 1–8 unique roles, 64-byte IDs, 1k-byte instructions, 12k-byte prompts, last four prior outputs truncated to 1.2k bytes, 8k-byte response cap, and 512 tokens per role.
- Added tests for workspace URL policy/restore/reload, Agent Team six-role flow, oversized tasks/plans/responses, prior-context truncation, and retained lease on unreadable artifact.
- Updated native coordinator architecture documentation and README status.
- #110 CI started: iOS run `43741079412`; Pocket AI Lab `43741079416`; Consumer prototype `43741079393`; Cursor collaboration plugin `43741079479`; Governance sidecar `43741079363`. All were in progress at checkpoint; no pass claimed.
- #107 corrected-importer iOS run `43740561987` and #109 aggregate iOS run `43740720673` remained in progress, each compiling pinned llama.cpp. Their companion workflows were successful.
- Updated continuity state and work record on `codex/project-continuity-system`.
- No merges, main changes, visibility changes, permission changes, or physical-device tests.



## 2026-11-15 — Full aggregate CI checkpoint

- PR #110 exact-head companion workflows now all pass: Pocket AI Lab `43741079416`, Consumer prototype `43741079393`, Cursor collaboration plugin `43741079479`, and Governance sidecar `43741079363`.
- PR #110 iOS LlamaEngine run `43741079412` remains in progress on step 5, building pinned llama.cpp for simulator/macOS. App build, XCTest, simulator XCTest, and macOS XCTest have not started; no native XCTest pass is claimed.
- PR #107 iOS run `43740561987` and PR #109 aggregate iOS run `43740720673` are also still on the pinned llama.cpp build step.
- PR #110 has no submitted reviews or inline review threads at last check.
- Refreshed the continuity state/work record to reflect companion CI successes and remaining native CI gate.

## 2026-11-15 — Lease-bound native generation hardening

- Refreshed live repository state: main remains `818799eced634577c8f1760fa2bdd1f657bd8427`; no merge or main-branch write.
- Confirmed PR #104 iOS run `43731823992` completed successfully: native app XCTest, iOS Simulator XCTest, pinned smoke GGUF, and macOS XCTest all passed. This validates the predecessor branch only; it does not validate later #110 changes or physical iPhone behavior.
- Refreshed PR #110 and inspected its changed-file list, native inference composition, ModelPool, coordinator, LocalChatModel, Workspace, tests, and iOS CI workflow.
- Found a resource-ownership gap: public runtime generation accepted a bare `RuntimeSession`, the raw engine was publicly exposed, and direct-engine coordinator construction remained public. Callers could bypass exact active lease ownership and attempt generation after release.
- Implemented commit `5887883e40fe3298cec87653ab05ac235ba8b10f` on PR #110 branch `codex/ios-agent-team-workspace-mainline`:
  - public generation now requires an exact active `ModelPoolLease`;
  - ModelPool tracks exact in-flight use pins and blocks unload/idle eviction until generation and cancellation drain finish;
  - stale/foreign leases are rejected;
  - raw engine exposure is internal and direct-engine coordinator initialization is internal;
  - app chat and runtime-backed Agent Team use the lease API;
  - regression tests cover released leases, foreign leases, and release while generation is active.
- PR #110 remains open/draft and targets main. No review submissions or inline review threads returned at last check.
- Exact-head companion workflows on #110 commit `5887883e40fe3298cec87653ab05ac235ba8b10f` passed: Pocket AI Lab `43741621091`, Consumer prototype `43741621024`, Cursor collaboration plugin `43741621050`, and Governance sidecar `43741621040`.
- Exact-head iOS LlamaEngine run `43741621034` is in progress building pinned llama.cpp for simulator/macOS. Native app build and XCTest have not started. Previous #110 iOS run `43741079412` was cancelled after the branch head changed; this is expected branch concurrency behavior.
- PR #107 iOS run `43740561987` advanced to native app XCTest; simulator/macOS XCTest remain pending. PR #109 iOS run `43740720673` remains in the pinned llama.cpp build step.
- No physical iPhone validation. Hosted device-slice linking is compile/link validation only. Runtime trust remains Unverified; APEX/Director and East/e3 authorization boundaries remain unchanged.
- Next: refresh #107/#109/#110 iOS runs; inspect app, simulator, and macOS XCTest outcomes; fix only concrete failures; update the #110 architecture doc to describe lease-use pins; then address multi-turn native chat context and persistence as separate gated work. Keep all PRs draft and do not merge.


## 2026-11-15 17:39 UTC — Bounded chat context and cancellation lifetime tests

- Continued PR #110 on safe feature branch `codex/ios-agent-team-workspace-mainline`; main remains unchanged.
- Updated `native-ios-inference-composition-root-v1.md` to define exact active lease requirements, ModelPool in-flight use pins acquired before scheduler admission, unload protection through stream/cancellation drain, and rejection of stale/foreign leases.
- Added `testCancelledQueuedGenerationReleasesItsUsePin`: while one request owns the scheduler permit, a second request obtains a use pin while queued; cancellation must remove its waiter and release only its pin, leaving the active request intact.
- Implemented bounded multi-turn chat in `LocalChatView.swift`: carries up to eight recent `You`/`Pocket AI` messages, caps prompt at 6,000 UTF-8 bytes, drops oldest history first, truncates oversized newest input at Unicode-scalar boundaries, and excludes Agent Team/runtime diagnostics.
- Added iOS app tests for follow-up context and oversized prompt bounds; `FingerprintTestEngine` records prompts for assertions.
- Updated architecture docs: context is ephemeral, not persistent memory, and prompt framing is not a security boundary.
- Added `testOutputLimitFailureKeepsUsePinUntilCancellationDrainCompletes` to verify response-size rejection waits for engine drain before releasing the scheduler permit and ModelPool pin.
- Latest #110 head `b865b519084e0287f8680e7610bdc69b852fdaf1`; exact-head CI must be refreshed. Do not infer native XCTest success from companion workflows.
- No physical iPhone validation; runtime trust remains Unverified. APEX/Director and East/e3 remain authorization authorities; model outputs remain untrusted.
