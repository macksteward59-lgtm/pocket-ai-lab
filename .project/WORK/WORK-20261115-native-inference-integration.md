# WORK-20261115 — Native inference composition and validation

## Status

`in_progress` — validation and integration remain incomplete.

## Objective

Complete and validate the shared native inference composition root that routes native chat and Agent Team inference through one ModelPool and FIFO scheduler, preserving model lease lifetime until inference has actually stopped.

## Acceptance criteria

- [ ] Refresh main, PR #107/#106, their branch heads and ancestry.
- [ ] Verify NativeInferenceRuntime is the shared composition root for engine, ModelPool, and scheduler.
- [ ] Verify chat and Agent Team use the shared runtime rather than independent model ownership.
- [ ] Verify scheduler permits cover the full inference stream.
- [ ] Verify cancellation awaits exact-request drain before releasing permits or leases.
- [ ] Verify GGUF import stages and validates before replacement, preserves last known-good content on failure, and rejects unsafe replacement while loaded/busy.
- [ ] Run the relevant native Swift tests and inspect full iOS CI logs.
- [ ] Record exact run IDs, job results, test evidence, and unresolved physical-device gaps.
- [ ] Keep PR draft; do not merge.

## Last known GitHub coordinates (refresh before use)

- Repository: `macksteward59-lgtm/pocket-ai-lab`
- Base: `main`
- PR: #107 — https://github.com/macksteward59-lgtm/pocket-ai-lab/pull/107
- Branch: `codex/ios-model-pool-composition-mainline`
- Head at checkpoint initialization: `4d22c66c497ea0562259b665435a15efde93ca0b`
- Component PR: #106 — https://github.com/macksteward59-lgtm/pocket-ai-lab/pull/106
- Component branch: `codex/ios-model-pool-composition-root`
- PR #106 base branch: `codex/ios-model-pool-rebased-mainline`

## Completed according to previous session report

- Shared NativeInferenceRuntime composition-root implementation.
- ModelPool and FIFO InferenceScheduler integration.
- Native chat and Agent Team runtime integration.
- Exact-request cancellation/drain work.
- Staged GGUF import and header validation.
- Regression tests added for importer behavior and runtime scheduling/cancellation.

These are inherited claims and must be verified against the current diff and CI before being marked accepted.

## Validation evidence

No latest-head CI result is accepted in this checkpoint. Refresh all checks and inspect logs. Previous session reported CI still running/pending after latest changes; this is stale until rechecked.

## Risks / limitations

- Admission memory sizing is heuristic; host memory signals are advisory.
- Physical-device memory, thermal, battery, performance, and inference behavior remain unverified.
- Artifact SHA-256 identity integration from #88/#104 is not yet reconciled into this aggregate.
- A lease, digest, session, scheduler permit, or model response cannot authorize an action.

## Next action

Refresh `main`, PR #107 and #106 metadata, branch heads, ancestry, reviews, and PR-triggered workflow runs. Then inspect the current #107 diff and latest iOS workflow logs; continue from the first concrete unverified acceptance criterion. Update this record with exact evidence before pausing.
