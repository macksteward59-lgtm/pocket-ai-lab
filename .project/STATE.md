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

### Primary: shared native inference composition

- Work record: `.project/WORK/WORK-20261115-native-inference-integration.md`
- PR #107: https://github.com/macksteward59-lgtm/pocket-ai-lab/pull/107
- Branch: `codex/ios-model-pool-composition-mainline`
- Latest verified head: `104389c5e85b47d09954a230c01fd57714b5ea78`
- Base: `main`; compare: 27 ahead / 0 behind; open draft, GitHub reports mergeable.
- Latest iOS LlamaEngine CI run #132 / run ID `43731298841`: still building pinned llama.cpp at last check. Other four PR workflows on this head succeeded.
- PR #106 remains open/draft, stacked on PR #99's branch. PR #99 remains open/draft against main.

### Next: content-addressed artifact identity

- PR #109: https://github.com/macksteward59-lgtm/pocket-ai-lab/pull/109
- Branch: `codex/ios-content-addressed-model-integrity-mainline`
- Head: `b37d78fdec64062e738cd076ed994861d90331e6`
- Base: PR #107 branch; compare: 8 ahead / 0 behind.
- Streaming SHA-256, byte count, content-addressed model IDs, pre/post-load rehash, staged import, and mutation tests added.
- Pocket AI Lab CI run `43731687148` succeeded. iOS LlamaEngine workflow is configured only for PRs targeting main, so this stacked PR has not yet received its own iOS/XCTest run. Do not mark native tests passed.

### Artifact predecessor

- PR #104: https://github.com/macksteward59-lgtm/pocket-ai-lab/pull/104
- Branch: `codex/ios-import-agent-team-integrity-mainline`
- Latest head: `bf7a61c9732c23a6e7b23ad43ff0e415b6d745b4`; base main; compare 29 ahead / 10 behind.
- Fixed two observed XCTest assertions: Agent Team status wording and bracketed IPv6 loopback handling.
- Fresh iOS LlamaEngine CI is running on this latest head; prior head failed those two XCTest assertions.
- PR #88 is a separate older stacked branch; avoid treating it as current-mainline.

## Runtime proof and skill governance

- PR #100 is the cleaner current-mainline runtime proof verifier: 8 ahead / 0 behind; all five workflows succeeded on head `d5705a287fd126074e617644d77cc491bccda2a9`.
- PR #83 is older: 21 ahead / 14 behind current main; all workflows succeeded on its historical head. Prefer #100 for follow-up.
- Runtime verifier has host-provisioned immutable public-key inputs and Keychain-backed monotonic replay state, but no production key provisioning, signer, rotation/revocation service, app composition wiring, or cross-process atomic replay update. Runtime trust remains Unverified.
- PR #101 is current-mainline skill lifecycle/rubric aggregate: 11 ahead / 0 behind; all four workflows succeeded on head `3799fe3118787f3187981166dd0cb7de506b6601`.
- PR #91/#92 are stacked predecessors. Rubric digest is now compared to the artifact's exact rubric, but authenticated approver identity, durable approval/revocation ledger, restart-safe authorization, and transactional replay prevention remain host-service gaps. Candidate lifecycle is not wired to Director/operational SkillRegistry.

## Global status

- Repository continuity system: PR #108 open/draft, branch `codex/project-continuity-system`; not merged.
- PR #107 and #109 remain drafts. No merge to main is authorized.
- Repository visibility and permissions remain unchanged.
- No physical-device test is claimed.
- Current active task selection must be re-evaluated against the requested task and live GitHub state on every resume.
