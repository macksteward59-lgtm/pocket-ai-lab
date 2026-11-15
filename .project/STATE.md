# Pocket AI Lab — live project state

> Last refreshed: 2026-11-15. This is a checkpoint, not a substitute for refreshing GitHub. Always verify live branch, PR, and CI state before acting.

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
- Commit `ed32fecef579dfd53c0263c3e73f00d95cc1af32` fixes both stale expected values. Fresh iOS run `43740561987` is in progress; it was still building pinned llama.cpp at last check. Four companion workflows are either passed or still running; refresh before reporting final results.
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
- Aggregate iOS LlamaEngine CI run `43740720673` was pending at last check; Pocket AI Lab, Consumer prototype, Cursor collaboration plugin, and Governance sidecar workflows were in progress. Do not treat any as passed until refreshed.
- No PR reviews were returned at last check.

### Validated predecessor

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
- PRs #104, #107, #109 remain open drafts. No merge to main is authorized.
- Repository visibility and permissions remain unchanged.
- No physical-device test is claimed. Hosted device-slice linking and simulator tests do not prove behavior on the user's iPhone.
- Current active task selection must be re-evaluated against the requested task and live GitHub state on every resume.
