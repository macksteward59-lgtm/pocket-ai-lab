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
- Added exact excerpt verification, 1-based line reporting, occurrence counting, duplicate ambiguity handling, stable unverified reasons, and tests for exact match, paraphrase rejection, duplicate excerpts, line selection, traversal, unsupported files, and symlink escape.
- Current feature-branch head: `a315a91fa745415dd3572d433044c16b8016dd80`.
- Validation: no test command was executed in this environment. The available workflow-run lookup (which reports PR-triggered runs only) returned no PR-triggered runs, and combined status returned no checks for this exact head at the time of inspection. The mainline Intelligence CI workflow is configured for both `codex/**` pushes and pull requests targeting `main`; push-triggered run details are not exposed by that lookup. PR #198 remains draft and unvalidated.
- Trust boundary unchanged: source presence is not exploitability, reachability, runtime behavior, authenticity, mitigation analysis, signed Evidence, attestation, APEX approval, East authorization, or trusted receipt.

Next: inspect PR #198's exact diff and workflow trigger configuration, obtain exact-head CI, fix any findings, then request independent review. Do not start D-04 until the source-reference result shape is stable and this slice has passed its focused checks.
