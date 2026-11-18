# STRIDE-GPT Donor Review — Engineering Handoff

**Date:** 2026-11-17  
**Coordinator:** ChatGPT  
**Coordination branch:** `agent-coordination`  
**Status:** Documentation handoff complete; implementation not started  
**Donor register:** [STRIDE-GPT donor register](STRIDE-GPT-DONOR-REGISTER.md)  
**Architecture decision note:** [STRIDE-GPT integration decision](../docs/architecture/stride-gpt-donor-integration.md)

## Purpose

Transfer the completed read-only comparison of `mrwadams/stride-gpt` and `macksteward59-lgtm/pocket-ai-lab` into an actionable, non-overlapping engineering plan. This handoff is not approval to copy donor code, execute repository tools, or change APEX/East trust contracts.

## Audit baseline and limits

- Donor inspected: `mrwadams/stride-gpt`, branch `master`.
- Target inspected: `macksteward59-lgtm/pocket-ai-lab`, branch `main`.
- Audit date: 2026-11-17.
- The donor register records the specific source files and Pocket components inspected.
- This was a source-level compatibility review. No donor code was copied, no tests were run for the donor comparison, and no application implementation was changed as part of that audit.
- Some paths queried during inspection were not available; do not describe this as a complete repository or dependency audit.
- STRIDE-GPT's observed license is MIT. Recheck the license file and retain required notices before copying substantial code.

## Decisions already made

1. STRIDE-GPT is a donor of targeted algorithms, schemas-as-reference, and test ideas—not a replacement for Pocket's agent architecture.
2. Keep Pocket's existing Orchestrator, AgentManager, MessageBus, DeliberationEngine, MemoryManager, ToolDirector, East lifecycle, and model-provider abstractions authoritative.
3. Prefer small TypeScript adaptations over importing the donor's Python/LiteLLM runtime into the TypeScript/Swift product.
4. Keep analysis findings untrusted. A source quote verifier is not signed Evidence, attestation, APEX approval, East authorization, or a trusted receipt.
5. Repository analysis is read-only by default. Tool execution, writes, generated-code execution, scanners, and network activity remain subject to existing scope, sandbox, and approval controls.
6. Do not change APEX, Evidence.swift, BridgeGate, RuntimeController, LlamaEngine, or East authorization contracts in the donor prototypes.

## Recommended implementation sequence

| Order | Donor | Proposed slice | Why first / dependency | Initial branch suggestion |
|---|---|---|---|---|
| 1 | D-02 | TypeScript source-reference verifier | Small, deterministic, testable; must reuse the existing approved repository path policy | `codex/stride-source-reference-verifier` |
| 2 | D-04 | Aggregation vs emergent cross-subsystem analysis | Builds on stable finding/evidence-reference IDs; should consume findings, not raw unbounded repository context | `codex/stride-cross-subsystem-synthesis` |
| 3 | D-07 | Filesystem and regex safety regression matrix | Can be developed alongside D-02 only if ownership and file scopes do not overlap | `codex/stride-repo-tool-safety-tests` |
| 4 | D-01 | Fair repository/subsystem planner | Requires explicit subsystem boundaries and sampling/completeness reporting | `codex/stride-repo-planner` |
| 5 | D-08 | Research run manifest mapping to East artifacts | Requires agreed run/finding schema and East persistence contract | `codex/stride-run-manifest` |
| 6 | D-06 | Progressive specialist knowledge loading | Requires reconciliation with current knowledge catalog and provenance/version rules | `codex/stride-progressive-knowledge` |
| 7 | D-05 / D-09 / D-10 / D-11 | Context, report, progress, schema adaptations | Lower priority; inspect current equivalents before opening work | Separate claims only if justified |

Branch names are suggestions, not claims. Before implementation, refresh this branch, read the complete current board and latest log, check active-agent claims, and claim exact paths. Do not open overlapping work merely because a suggested branch name appears here.

## Prototype A — D-02 acceptance contract

- Provide a read-only TypeScript interface that accepts a repository root and a structured source quote reference.
- Resolve and normalize paths under the already-approved repository sandbox policy; do not create a parallel weaker path resolver.
- Return a bounded result containing verification status, normalized relative path, exact 1-based line range, occurrence count, and a stable reason when verification fails.
- Reject traversal, symlink escape, non-file/missing paths, malformed references, binary or oversized inputs, oversized snippets, and ambiguous matches.
- Test exact match, whitespace normalization, CRLF/LF, duplicate matches, paraphrase rejection, traversal, symlink escape, binary/oversized file, and line accuracy.
- No signer, receipt, APEX, authorization, runtime, or East mutation API may be called.

## Prototype B — D-04 acceptance contract

- Consume only findings produced by bounded subsystem analyses.
- Each result is explicitly `aggregation` or `emergent`.
- Aggregation cites existing finding IDs and cannot create new evidence.
- Emergent claims cite the existing verified source-reference IDs for each link in the proposed cross-subsystem chain.
- Missing, paraphrased, ambiguous, or unverified references cause rejection or downgrade to a hypothesis.
- Cover duplicate systemic findings, true multi-subsystem chains, unrelated repeated findings, duplicate-chain suppression, and invented-evidence rejection.
- Preserve disagreement and uncertainty. Consensus never grants permission or authorization.

## Coordination and integration gates

Before any code work:
1. Refresh `agent-coordination`.
2. Read `coordination/LEADERSHIP.md`, `coordination/PROTOCOL.md`, the entire `coordination/BOARD.md`, and the latest `coordination/LOG.md` entries.
3. Confirm no active claim owns the proposed paths or shared interfaces.
4. Claim exact paths and a dedicated feature branch on the board before editing.
5. Keep implementation and tests off `agent-coordination`; use a reviewed PR into the appropriate base.
6. Record exact commit SHA, changed paths, commands/tests, results, and limitations. Never transfer CI evidence from a different head.

Integration order should be D-02 schema/interface review, D-02 implementation/tests, D-04 schema/interface review, D-04 implementation/tests, then planner/manifest/knowledge work as dependencies allow. A prototype is not complete until its focused tests pass on its exact PR head and a separate security review confirms it does not cross the trust boundaries above.

## Current disposition

- Donor register: recorded.
- Architecture decision note: recorded in this handoff.
- Coordination ownership board: existing ChatGPT coordination-audit claim remains the applicable documentation ownership; this handoff does not claim application files.
- Implementation branches: not created by this documentation task.
- Donor code copied: none.
- Application code/tests changed: none.
- CI/tests run for this handoff: none.
- PR opened/merged: none.

## Next action

The next engineering action is to refresh the live board/log and select D-02 as the first isolated TypeScript prototype only if its path policy and target interfaces are still unclaimed. If those interfaces are owned or have changed, update the plan before coding rather than forcing the donor design into the current architecture.

## D-02 prototype progress — 2026-11-17

The first isolated D-02 implementation slice has been opened as draft PR [#198](https://github.com/macksteward59-lgtm/pocket-ai-lab/pull/198), branch `codex/stride-source-reference-verifier`, based on main commit `e8f4dadc22c9814d68f881fb5151c9aca5ab29b8`.

- Existing implementation discovery: `runtime/adapters/director/LocalProjectInspector.ts` already provides bounded read-only workspace inspection, relative-path validation, realpath confinement, symlink-escape rejection, text-extension allowlisting, and per-file/aggregate byte limits.
- Design adjustment: extend that inspector rather than create a second sandbox or independent path resolver.
- Changed paths are limited to `runtime/adapters/director/LocalProjectInspector.ts` and `runtime/adapters/director/LocalProjectInspector.test.ts`.
- Added exact excerpt verification, 1-based line reporting, normalized paths, CRLF normalization, occurrence counting without retaining match arrays, duplicate ambiguity handling, stable unverified reasons, and tests for exact matches, paraphrase rejection, duplicate excerpts, line selection, dense repeated matches, malformed runtime input, traversal, unsupported files, symlink escape, oversized files, and oversized excerpts.
- Current feature-branch head: `17ac696687bfaaba3123eccb18c9f3d03bb1c13f`.
- Validation: exact-head-associated Pocket AI Lab CI run #3025 completed successfully. It checked out PR merge ref `ac1ddbb71e40be9051a18cb4e56e644900f05c72` for head `17ac696687bfaaba3123eccb18c9f3d03bb1c13f`; TypeScript build and full `npm test` passed; `LocalProjectInspector.test.ts` passed 9/9. PR #198 remains draft pending independent review. CI's non-blocking `npm audit` report surfaced high-severity dependency advisories involving `picomatch`, `fdir`, `tinyglobby`, `vite`, and `vitest`; this is a separate repository follow-up.
- Trust boundary unchanged: source presence is not exploitability, reachability, runtime behavior, authenticity, mitigation analysis, signed Evidence, attestation, APEX approval, East authorization, or trusted receipt.

Latest PR #198 review confirms exactly two changed files, 12 commits ahead of main, zero commits behind, and GitHub reports mergeable=true. Exact-head-associated Pocket AI Lab CI run #3025 passed the TypeScript build and full `npm test`; LocalProjectInspector tests passed 9/9. The PR description records the merge-ref tested and the high-severity non-blocking npm audit finding. The draft has been advanced to ready-for-review; it remains open and unmerged. Next: independent code/security review. Do not start D-04 until D-02 review accepts the source-reference result shape and trust boundary.


## 2026-11-18 — D-07 ownership and implementation reconciliation

A live GitHub refresh confirms PR [#46](https://github.com/macksteward59-lgtm/pocket-ai-lab/pull/46) is **merged** (2026-11-13), not draft or unmerged as the older board row stated. Its merged implementation already owns the Director tool lifecycle and repository-inspection foundations: ToolDirector requires a host-injected ToolSandbox, quarantines candidates on missing/failed/incomplete test execution, binds activation/retirement approval to the exact artifact digest, and registers metadata only (actual execution remains behind SecurityDivision/DelegationGate/APEX/East). The merged LocalProjectInspector supplies the root-confined, bounded, read-only file access reused by D-02.

**D-07 disposition:** partially implemented by #46; no new D-07 implementation branch should be created. The concrete production sandbox remains a host responsibility. The donor VCS metadata exclusion and regex complexity/deadline controls are not proven by the inspected #46 code, so add those to the concrete sandbox adapter security acceptance matrix when that adapter is selected. Do not mistake the interface contract for proof of an operational isolated sandbox.

**D-02 review note:** PR #198 still changes only the two inspector files and has no submitted reviews or inline review threads. Its feature branch was created from main SHA e8f4dadc22c9814d68f881fb5151c9aca5ab29b8; re-check its current base/head comparison before merging because main may have advanced since branch creation. Exact-head CI #3025 passed as recorded above. No merge or reviewer assignment performed.


## 2026-11-18 — D-02 integration and reference-identity gap

A code-path trace found that PR #198 adds verifySourceReference only to the concrete LocalProjectInspector. The shared ProjectInspector contract exposes only inspect, DirectorCapabilities exposes only analyzeProject, and apps/web/directorRuntime.ts injects the adapter through that narrow interface. A default-branch repository search found no consumer of the new method. The verifier is therefore adapter-level and test-covered, but not yet reachable through the normal Director capability path.

There is a second dependency for D-04: the current verification result contains path, occurrence count, and line range, but no stable source-reference ID. D-04's acceptance contract explicitly requires emergent claims to cite verified source-reference IDs. Before implementing D-04, perform a separate schema/data-flow design review covering the Director entry point, stable reference ID semantics/binding to content snapshot, stale-reference invalidation, and treatment of model-proposed references as untrusted input. Only after agreement should the shared interface/capability be extended and tests added. Keep D-02's present narrow PR independently reviewable; do not imply end-to-end capability integration or let this metadata become Evidence.swift, attestation, APEX/East authorization, or a trusted receipt.


## D-02 capability design proposal — 2026-11-18

Added [STRIDE-D02-CAPABILITY-DESIGN.md](STRIDE-D02-CAPABILITY-DESIGN.md), a design-only proposal for the Director-facing verifier entry point, content-bound reference identity, task/workspace scoping, stale-reference invalidation, and adversarial tests. It reuses the digest-binding pattern from the existing SourceEvidenceAdapter without treating the reference ID as signed evidence or authorization. No shared interface or application code changed. Owner/reviewer acceptance is still required before implementation; D-04 remains blocked.


## 2026-11-18 — D-02 East task identity and catalog lifecycle follow-up

A read-only trace of the current Director and East code resolves part of the D-02 open design question:

- `DirectorCommandRouter` already receives a trusted `DirectorCommandContext.taskId`, but the `analyze-project` dispatch path currently forwards only the command object. The task identity is dropped before `DirectorCapabilities.analyzeProject` and `ProjectInspector.inspect`. Any verifier capability must receive the task ID from this existing dispatch context; it must never accept a model-proposed task ID.
- `src/east/platform.ts` generates task IDs and keeps `EastTaskRecord` values in a process-local Map. The record has no source-reference catalog or general artifact-store port.
- East's `commitTaskEvidence` stores deliberation text in `MemoryManager` as episodic memory with `verified: false`. This is not a durable source-reference artifact interface. Do not repurpose it for verified source-reference records or overload `EastTaskRecord.evidenceRefs`.
- Initial D-02 catalog recommendation: immutable, host-owned, task-scoped, and ephemeral/process-local. The host owns workspace identity and snapshot reads. A separate design review is required before persistence, including identification of an existing durable artifact contract and restart/revalidation semantics.

This is a design finding only. No shared interfaces, East task records, MemoryManager behavior, application code, tests, or authorization contracts were changed. PR #198 remains an adapter-level verifier pending independent review; D-04 remains blocked.
