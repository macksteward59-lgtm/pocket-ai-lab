# STRIDE-GPT Donor Integration Decision

**Status:** Accepted as a bounded donor-pattern review; no implementation authorization implied  
**Date:** 2026-11-17  
**Related coordination record:** `coordination/STRIDE-GPT-ENGINEERING-HANDOFF-2026-11-17.md`  
**Source inventory:** `coordination/STRIDE-GPT-DONOR-REGISTER.md`

## Decision

Pocket AI Lab may selectively adapt STRIDE-GPT's repository-analysis and security-review patterns. It must not adopt STRIDE-GPT as a second agent framework, model router, workflow engine, persistence authority, or trust authority.

The donor is Python-oriented (the inspected project declares Python >=3.12 and includes LiteLLM/Pydantic and CLI-oriented dependencies), while Pocket's core intelligence is TypeScript and its native inference/runtime work includes Swift. A wholesale dependency or runtime import would expand the product's execution and maintenance surface without solving a demonstrated gap.

## Capability mapping

| Donor capability | Pocket destination | Decision |
|---|---|---|
| Repository inventory, key-file selection, fair subsystem sampling (D-01) | Researcher / repository analysis planning | Adapt algorithm after documenting subsystem boundaries and sampling completeness |
| Source quote verification (D-02) | Untrusted finding-reference validation | Prototype first; read-only, exact path/line evidence only |
| Bounded per-subsystem loops and resume (D-03) | Existing Orchestrator + East lifecycle | Reuse only missing behavior; East remains durable workflow owner |
| Aggregation vs emergent synthesis (D-04) | Bounded Security Analyst/Critic/Validator stage | Prototype second; input findings must already have evidence references |
| Context compression (D-05) | Provider/context assembly | Measure current token/context support first; transient context is not durable memory |
| Progressive reference cards (D-06) | Existing knowledge catalog | Adapt after reconciling current catalog, provenance, versioning, and policy |
| Filesystem/path/regex controls (D-07) | Approved repository ToolSandbox and its tests | Security checklist and regression cases; not a production-sandbox certification |
| Run manifest (D-08) | East task/artifact persistence | Adapt fields into East; no parallel workflow store |
| Markdown/JSON/SARIF output (D-09) | ExploitGym/report adapter | Inspect existing exporters first; do not assume none exists |
| Progress callbacks (D-10) | Existing event/telemetry contracts | Adapt only if the current event surface has a real gap |
| Typed schemas (D-11) | Zod/TypeScript message and result contracts | Reference only; no Python/Pydantic import into core |

## Non-negotiable boundaries

### Findings and evidence

A source-reference verifier can establish only that a supplied excerpt matches content at a normalized path and line range in the inspected repository tree. It cannot establish exploitability, reachability, runtime behavior, source authenticity, or the absence of a mitigation.

Its result is untrusted analysis metadata. It cannot issue or substitute for signed `Evidence.swift`, cryptographic attestation, a trusted runtime receipt, APEX approval, East authorization, or host approval.

### Agents and deliberation

Pocket's `Orchestrator`, `AgentManager`, `MessageBus`, and `DeliberationEngine` remain the only authoritative agent coordination and deliberation path. The donor loop is not a parallel orchestrator. Cross-subsystem synthesis is a bounded analysis stage that returns claims and citations to existing findings; it does not silently rewrite agent messages or resolve authorization.

### Memory and workflow

Transient context compression must not replace Pocket's durable memory layers. Donor checkpointing must not introduce a second task state machine. East remains the workflow lifecycle and durable artifact integration point. Missing usage data must not be represented as zero; incomplete work must remain visibly partial.

### Tools and sandbox

Repository inspection defaults to read-only. Any tool execution, file mutation, generated-code execution, scanner, or network operation remains behind Pocket's approved scope, sandbox, permission, and human-approval gates.

A production-grade repository sandbox must address path traversal, symlink escapes, VCS metadata and credential exposure, file-size/output bounds, regex denial of service, deadlines, cancellation, and proof of actual worker termination. A timeout response alone is not evidence that underlying work stopped.

### Runtime and dependencies

Do not introduce LiteLLM, a required cloud inference path, a second model router, or a Python dependency into Pocket's TypeScript/Swift core as a consequence of this donor review. Keep the existing provider-independent inference abstraction and offline-first/native runtime direction.

## Acceptance gates for any future implementation

1. Exact ownership and feature branch recorded on `coordination/BOARD.md`.
2. Interface and data-flow review before implementation, including trust classification of every model-produced field.
3. Focused positive, negative, adversarial, and boundary tests.
4. Tests and CI reported against the exact commit SHA under review.
5. Security review confirms no new authority path, no bypass of East/APEX gates, and no unbounded repository/tool execution.
6. MIT notice and current donor license verified before any substantial code copy.
7. Documentation and coordination log updated with changed paths, exact head, validation, residual risks, and explicit non-claims.

## Explicit non-decisions

This note does not approve copying code, add a dependency, create an implementation branch, authorize a scan, change agent roles, change the six-layer/42-module inventory, redefine APEX or East contracts, or claim that any donor feature is production-ready in Pocket AI Lab.

## D-02 prototype status — 2026-11-17

Draft PR [#198](https://github.com/macksteward59-lgtm/pocket-ai-lab/pull/198) extends the existing `runtime/adapters/director/LocalProjectInspector` rather than introducing a parallel filesystem sandbox. The existing adapter already validates relative paths, resolves real paths within its workspace root, rejects symlink escapes, restricts text extensions, and bounds file/aggregate reads.

The prototype adds exact excerpt presence checks, normalized relative paths, CRLF normalization, 1-based line ranges, occurrence counts without retaining match arrays, ambiguity handling, and stable unverified reasons. Its result remains an untrusted source-location check only. Regression cases include dense duplicates, malformed input, and size bounds.

- Branch: `codex/stride-source-reference-verifier`
- Base: `main` at `e8f4dadc22c9814d68f881fb5151c9aca5ab29b8`
- Current head at handoff: `17ac696687bfaaba3123eccb18c9f3d03bb1c13f`
- Files: `runtime/adapters/director/LocalProjectInspector.ts`, `runtime/adapters/director/LocalProjectInspector.test.ts`
- Validation: Pocket AI Lab CI run #3025 completed successfully for PR head `17ac696687bfaaba3123eccb18c9f3d03bb1c13f` (PR merge ref `ac1ddbb71e40be9051a18cb4e56e644900f05c72`). TypeScript build and full `npm test` passed; the LocalProjectInspector suite passed 9/9. GitHub reports mergeable=true and compare is ahead 12 / behind 0. PR #198 remains draft pending independent review. The non-blocking audit step reported high-severity advisories through `picomatch`/`fdir`/`tinyglobby`/`vite`/`vitest`; track separately.

Do not proceed to D-04 until D-02's exact-head tests and independent review are complete. No Director command schema, evidence authority, APEX/East contract, or tool permission is changed by this prototype.
