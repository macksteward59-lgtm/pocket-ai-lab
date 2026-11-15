# Pocket AI Lab — live project state

> Last initialized: 2026-11-15. This is a checkpoint, not a substitute for refreshing GitHub. Always verify live branch, PR, and CI state before acting.

## Project identity

- Repository: https://github.com/macksteward59-lgtm/pocket-ai-lab
- Default branch: `main`
- Last verified main SHA at initialization: `818799eced634577c8f1760fa2bdd1f657bd8427`
- Mission: hybrid offline-first, model-independent multi-agent intelligence platform. Agents reason and propose; APEX/East authorization and evidence determine what may execute.

## Architecture invariants

Preserve APEX/Director governance, East/e3 durable workflows, ExploitGym isolation, Grok Workspace artifacts/context, BridgeGate trusted-origin/message authorization, RuntimeController lifecycle/readiness, LlamaEngine native inference abstraction, and signed Evidence verification. Model outputs are untrusted. Runtime leases, hashes, sessions, and evaluation results never grant action authority.

## Active work

### Primary: shared native inference integration

- Work record: `.project/WORK/WORK-20261115-native-inference-integration.md`
- PR #107: https://github.com/macksteward59-lgtm/pocket-ai-lab/pull/107
- Branch: `codex/ios-model-pool-composition-mainline`
- Last verified PR head at initialization: `4d22c66c497ea0562259b665435a15efde93ca0b`
- PR state at initialization: open, draft, base `main`, GitHub reported mergeable.
- Component PR #106: https://github.com/macksteward59-lgtm/pocket-ai-lab/pull/106
- PR #106 branch: `codex/ios-model-pool-composition-root`, stacked on `codex/ios-model-pool-rebased-mainline`; open and draft at initialization.
- CI status: MUST BE REFRESHED. Do not carry forward earlier pending/running results.

## Next priorities

1. Refresh #107 and #106 heads, PR metadata, reviews, and all current CI runs; finish actual validation and repair only confirmed failures.
2. Reconcile #104/#88 content-addressed artifact integrity into a clean current-mainline successor.
3. Inspect #83/#100 runtime proof key provisioning, rotation, revocation, and durable replay protection.
4. Inspect #91/#92/#101 skill approval identity, revocation, and exact rubric digest binding.
5. Validate on a physical iPhone; simulator/host tests are not device validation.

## Global status

- Repository continuity system: initialized on feature branch `codex/project-continuity-system`; not yet merged.
- No merge to main is authorized by this record.
- Repository visibility and permissions must remain unchanged.
- Current active task selection must be re-evaluated against the requested task and live GitHub state on every resume.
