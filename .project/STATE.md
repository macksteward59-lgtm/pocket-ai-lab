# Pocket AI Lab — live project state

> Last refreshed: 2026-11-15 17:33 UTC. This is a checkpoint, not a substitute for refreshing GitHub. Always verify live branch, PR, and CI state before acting.

## Project identity

- Repository: https://github.com/macksteward59-lgtm/pocket-ai-lab
- Default branch: `main`
- Latest verified main SHA: `818799eced634577c8f1760fa2bdd1f657bd8427`
- Mission: hybrid offline-first, model-independent multi-agent intelligence platform. Agents reason and propose; APEX/East authorization and evidence determine what may execute.

## Architecture invariants

Preserve APEX/Director governance, East/e3 durable workflows, ExploitGym isolation, Grok Workspace artifacts/context, BridgeGate trusted-origin/message authorization, RuntimeController lifecycle/readiness, LlamaEngine native inference abstraction, and signed Evidence verification. Model outputs are untrusted. Runtime leases, hashes, sessions, and evaluation results never grant action authority.

## Active work

### Primary: native inference composition

- PR #107: https://github.com/macksteward59-lgtm/pocket-ai-lab/pull/107
- Branch: `codex/ios-model-pool-composition-mainline`
- Latest head: `ed32fecef579dfd53c0263c3e73f00d95cc1af32`
- Base: `main`; compare: 31 ahead / 0 behind; open draft, mergeable.
- Previous iOS run `43731298841` built the device framework and app, then failed two importer assertions because the expected fixture remained 14 bytes while the minimum valid GGUF header is 24 bytes.
- Commit `ed32fecef579dfd53c0263c3e73f00d95cc1af32` fixes both stale expected values. Fresh iOS run `43740561987` remains in progress and has advanced to native app XCTest; simulator/macOS XCTest are still pending. Four companion workflows are either passed or still running; refresh before reporting final results.
- No PR reviews or inline review threads were returned at last check.

### Mainline aggregate: content-addressed artifact integrity + shared runtime

- PR #109: https://github.com/macksteward59-lgtm/pocket-ai-lab/pull/109
- Branch: `codex/ios-content-addressed-model-integrity-mainline`
- Latest head: `a6de5e5387a0f6745c61ba509678fae3811d0cf6`
- Base: `main`; compare: 41 ahead / 0 behind; 15 files changed; open draft and mergeable.
- Retargeted from #107's feature branch to `main` so the combined dependency chain receives iOS PR CI.
- Includes streaming SHA-256, content-addressed model IDs, pre/post-load fingerprint verification, and exact lease/session cleanup when file mutation is detected.
- Additional review found a lease-lifecycle bug: a failed file fingerprint read during reload could clear the only UI lease handle while ModelPool still retained the lease. Fixed by retaining the exact lease on preflight errors and when exact release unexpectedly fails. Added regression test `testUnreadableArtifactDoesNotOrphanExistingModelLease`.
- Fix commit: `613a1c4426babfe335f0d8d699be6ecd2f466417`; regression-test commit: `a6de5e5387a0f6745c61ba509678fae3811d0cf6`.
- Aggregate iOS LlamaEngine CI run `43740720673` remains in progress building pinned llama.cpp; do not treat it as passed until refreshed.
- No PR reviews were returned at last check.

#### Full mobile UI integration candidate

- PR #110: https://github.com/macksteward59-lgtm/pocket-ai-lab/pull/110
- Branch: `codex/ios-agent-team-workspace-mainline`
- Latest head: `5887883e40fe3298cec87653ab05ac235ba8b10f`; base `main`; open draft and mergeable.
- Carries the shared runtime, ModelPool/Scheduler, content-addressed GGUF integrity, bounded six-role Agent Team, and secure Workspace navigation integration.
- New hardening commit `5887883e40fe3298cec87653ab05ac235ba8b10f` requires an exact active ModelPool lease for public generation, adds an in-flight use pin that prevents unload through stream completion/cancellation drain, rejects stale/foreign leases, hides the raw engine from the public composition-root API, and makes the direct-engine coordinator initializer internal.
- Added regression tests for released leases, cross-pool leases, and releasing a lease while generation remains in flight. Existing runtime/app paths now pass the lease instead of a bare RuntimeSession.
- CI on the new exact head:
  - Pocket AI Lab CI `43741621091` — success.
  - Consumer prototype CI `43741621024` — success.
  - Cursor collaboration plugin CI `43741621050` — success.
  - Governance sidecar CI `43741621040` — success.
  - iOS LlamaEngine CI `43741621034` — in progress, currently building pinned llama.cpp for simulator/macOS; app build and XCTest have not started.
- Previous iOS run `43741079412` was cancelled by branch concurrency after the new commit superseded its head. No native XCTest pass is claimed for #110.
- No submitted PR reviews or inline review threads were returned at last check.
### Older dependency-chain reconciliation

- PR #84: 7 ahead / 10 behind current main, open non-draft; historical iOS run `43653686561` and all four companion workflows succeeded. Workspace lifecycle and URL-policy work carried to #110; importer superseded.
- PR #85: 19 ahead / 10 behind, open draft, stacked on #84; no independent workflow run found. Agent Team UI and bounds carried to #110, wired through shared runtime.
- PR #86: 26 ahead / 14 behind, open draft, old standalone ModelPool/Scheduler; iOS run `43654228679` was cancelled. Superseded by #107 composition.
- PR #88: 29 ahead / 10 behind, open draft, stacked on #85; iOS run `43728039752` failed. Superseded by #109 content-addressed integrity.
- PR #104: validated older aggregate; iOS run `43731823992` passed app, simulator, smoke-model and macOS XCTest. Keep as predecessor, not primary integration branch.

## Validated predecessor

- PR #104: https://github.com/macksteward59-lgtm/pocket-ai-lab/pull/104
- Branch: `codex/ios-import-agent-team-integrity-mainline`
- Head: `bf7a61c9732c23a6e7b23ad43ff0e415b6d745b4`; base main; 29 ahead / 10 behind.
- iOS LlamaEngine CI run `43731823992` completed successfully: app build, app XCTest, iOS Simulator XCTest, pinned smoke-model download, and macOS XCTest all passed.
- Fixes resolved earlier Agent Team wording and bracketed IPv6 loopback assertions.
- Retain as a validated predecessor; #107/#109 are the preferred shared-runtime path. PR #88 remains a separate older stacked branch.

## Runtime proof and skill governance

- PR #100 runtime-proof verifier previously passed all five workflows on head `d5705a287fd126074e617644d77cc491bccda2a9`. Remaining production gaps: key provisioning, signer, rotation/revocation, app composition wiring, and cross-process atomic replay updates. Runtime trust remains Unverified.
- PR #101's latest inspected description reports a newer head `88eb8294feab8cb3b01eaa16e8c1299cdd4a3c42`; prior four-workflow success was on an older head. Refresh CI before treating the new head as validated.
- Skill lifecycle still lacks authenticated human approver identity, durable approval/revocation ledger, restart-safe authorization, transactional replay prevention, and operational Director/SkillRegistry wiring. Candidate lifecycle status is not a permission grant.

## Global status

- Repository continuity system: PR #108 open/draft, branch `codex/project-continuity-system`; not merged.
- PRs #104, #107, #109, and #110 remain open drafts; #84 is open non-draft and #85/#86/#88 remain open drafts. #110 is the current consolidated native UI/runtime integration candidate. No merge to main is authorized.
- Repository visibility and permissions remain unchanged.
- No physical-device test is claimed. Hosted device-slice linking and simulator tests do not prove behavior on the user's iPhone.
- Current active task selection must be re-evaluated against the requested task and live GitHub state on every resume.


## 2026-11-15 17:39 UTC — Current continuation checkpoint

- Main remains `818799eced634577c8f1760fa2bdd1f657bd8427`; no main writes, merges, or repository setting changes.
- PR #110 remains open/draft against main, branch `codex/ios-agent-team-workspace-mainline`, current head `b865b519084e0287f8680e7610bdc69b852fdaf1`.
- Additional implementation commits since the prior checkpoint:
  - `5560375a6944fa07d9199451b96189c7206e1f37`: architecture docs for lease-bound generation pins.
  - `7850347b38313dcb3d6ef89057c4158df1123ce2`: regression test that cancelling a scheduler-queued generation releases only its use pin and does not disturb the active generation.
  - `91c6c10e652271bee3382c9b8b6b44a8025bea39`: bounded in-memory multi-turn chat context, up to eight prior user/assistant messages, 6,000 UTF-8 byte prompt cap; excludes Agent Team/runtime messages.
  - `7b4ceac25617c2c5b2c11fd85b6021410f25560f`: XCTest coverage for chat history carry-forward and oversized message truncation.
  - `e134c89e4317207ab0752ad71577a584c83f40e2`: architecture docs specify chat context limits, ephemeral scope, and non-security nature of prompt framing.
  - `b865b519084e0287f8680e7610bdc69b852fdaf1`: regression test that output-limit rejection keeps the session use pin and scheduler permit until cancellation drain completes.
- CI on #110 latest test commit is starting; earlier exact-head companion workflow runs for `e134c89e...` were in progress except Cursor collaboration plugin passed. iOS LlamaEngine run `43742213693` was in progress on `e134c89e...`; refresh exact latest-head run status before making claims.
- Earlier #110 iOS run `43741621034` and the interim run `43742194939` were cancelled as newer commits superseded them. Cancellation is concurrency behavior, not a test failure.
- #107 iOS run `43740561987` and #109 iOS run `43740720673` remained in progress on their respective older heads at last check; do not claim they validate #110.
- No native XCTest result yet for latest #110 changes. No physical iPhone validation. Runtime trust remains Unverified.

## 2026-11-15 17:40 UTC — Latest #110 checkpoint

- Main remains `818799eced634577c8f1760fa2bdd1f657bd8427`.
- PR #110 current head: `50b5adcd306c1079b5df137e7801894aae796a61`; open draft, base main, mergeable true at last metadata read; no submitted reviews or inline comments.
- Added bounded chat context and tests:
  - up to eight previous `You` / `Pocket AI` messages;
  - 1,500 UTF-8 byte maximum, newest-first retention and Unicode-scalar-safe truncation;
  - Agent Team task/role messages and runtime diagnostics excluded;
  - context is in-memory only, not persistent memory; byte count is not tokenizer output and is not a hard token guarantee.
- Added regression tests for multi-turn follow-up context, oversized message truncation, and Agent Team context isolation.
- Added lease-lifetime tests for scheduler-queued cancellation and output-limit rejection retaining the in-flight use pin and scheduler permit until cancellation drain.
- Latest #110 exact-head iOS LlamaEngine run `43742353789` is in progress at Show Xcode; pinned llama.cpp build, physical-device framework link, native app XCTest, simulator XCTest, and macOS XCTest are pending.
- Exact-head companion runs: Cursor plugin `43742353765` passed; Pocket AI Lab `43742353758`, Governance sidecar `43742353764`, and Consumer prototype `43742353766` are in progress.
- Earlier iOS runs on superseded heads were cancelled by branch concurrency; this is not a test failure. No latest-head XCTest result yet.
- PR #110 description has been refreshed with current architecture, safety limits, and test scope.
- No physical iPhone validation. Runtime trust remains Unverified; APEX/Director and East/e3 remain authorization authorities.

## 2026-11-15 17:41 UTC — Exact latest PR #110 state

- PR #110 head remains `50b5adcd306c1079b5df137e7801894aae796a61`, open draft, base main. Main remains `818799eced634577c8f1760fa2bdd1f657bd8427`.
- Chat prompt byte cap was tightened to 1,500 UTF-8 bytes; app and tests updated. Documentation explicitly says this is not tokenizer output or a hard token-count guarantee and requires future model-specific calibration.
- Added test that Agent Team objective and role messages do not enter ordinary chat context.
- PR #110 description refreshed to match the current implementation and limitations.
- Latest exact-head CI on `50b5adcd...`: iOS LlamaEngine run `43742353789` in progress; job reached pinned llama.cpp simulator/macOS build, with typecheck, device link, native app build, and app/simulator/macOS XCTest pending. Cursor plugin `43742353765` succeeded; Governance sidecar `43742353764` succeeded; Consumer prototype `43742353766` succeeded; Pocket AI Lab `43742353758` remained in progress.
- No latest-head native XCTest result. No physical iPhone validation. Runtime trust remains Unverified.
