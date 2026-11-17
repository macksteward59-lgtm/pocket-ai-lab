# STRIDE-GPT Donor Register for Pocket AI Lab

**Status:** Read-only comparative audit; donor candidates only  
**Prepared:** 2026-11-17  
**Target repository:** `macksteward59-lgtm/pocket-ai-lab`  
**Donor repository:** `mrwadams/stride-gpt`  
**Donor license observed:** MIT (retain copyright and license notice for any copied substantial code)  
**Integration status:** No donor code copied; no application code changed; no pull request opened.

## 1. Executive decision

STRIDE-GPT contains useful engineering patterns for repository analysis, source-backed findings, subsystem-level execution, cross-subsystem synthesis, context compression, progressive knowledge loading, and auditable report artifacts.

Pocket AI Lab already has its own agent manager, typed immutable message bus, bounded deliberation engine, memory manager, injected inference provider, Director Tool Workshop, tool registry, East workflow integration, and separate APEX/evidence trust boundaries. Therefore, the donor should be treated as a source of **targeted algorithms and test cases**, not as a replacement agent framework.

**Highest-value candidates to prototype:**
1. Evidence-checked source excerpts for untrusted code-analysis findings.
2. Emergent cross-subsystem reasoning that distinguishes a real interaction chain from repeated independent observations.
3. Fair repository/subsystem discovery for large monorepos.
4. Run manifests that record completeness, provenance, model/config identity, and what was actually analyzed.
5. Progressive disclosure for specialist knowledge/reference cards.

## 2. Donor register

| ID | Donor source | Reusable capability | Pocket AI Lab destination | Disposition | Priority |
|---|---|---|---|---|---|
| D-01 | `stride_gpt/agent/planner.py` | Repository inventory, key-file discovery, subsystem partitioning, and recursive fair/round-robin sampling so one large directory cannot starve sibling subsystems | Researcher / ProjectInspector adapter; new repository-analysis planning service under `packages/intelligence/knowledge` or a separately scoped analysis package | **Adapt algorithm**, do not transplant Python planner or its LLM contract | P1 |
| D-02 | `stride_gpt/agent/evidence.py` | Independently verify that a model-quoted source snippet exists in a sandboxed file; return normalized path, exact line range, occurrence count, and a reason when unverified | Security Analyst / Researcher finding validation; source-reference verification service | **Prototype strongly** in TypeScript; never treat this as signed Evidence, attestation, APEX approval, or authorization | P1 |
| D-03 | `stride_gpt/agent/loop.py` | Per-subsystem work units, bounded LLM/tool budgets, preservation of completed findings, partial outcomes, resumable work, and synthesis across units | Research task orchestration layered over existing Orchestrator and East/e3 lifecycle | **Selective adaptation**; reuse only gaps not already covered by East and current orchestration | P1 |
| D-04 | `stride_gpt/agent/loop.py` — `SYNTHESIS_PROMPT` and cross-cutting synthesis | Distinguishes **aggregation** (same weakness repeated across subsystems) from **emergent** threats (a new interaction/attack chain spanning subsystems); requires source evidence for emergent claims | Security Analyst + Critic + Validator review stage; cross-subsystem analysis result schema | **High-value new capability**; implement as a bounded, evidence-referenced analysis stage | P1 |
| D-05 | `stride_gpt/agent/context.py` | Context-window accounting, compression threshold, keeping recent complete turns, preserving task/system instructions, and rolling forward a structured summary | Intelligence context assembly / provider adapter; do not place in MemoryManager as a substitute for durable memory | **Adapt selectively** after checking existing context assembly and native tokenizers | P2 |
| D-06 | `stride_gpt/core/prompts/variants.py` and `stride_gpt/core/prompts/threat_model/*.md` | Reference-card catalogue with lightweight metadata discovery and on-demand loading (progressive disclosure) | Knowledge catalog and specialist prompt/reference loading | **Adapt pattern**; reconcile with Pocket's existing knowledge catalog and provenance/version fields | P1 |
| D-07 | `stride_gpt/agent/tools.py` | Root-confined path resolution, symlink escape rejection, VCS metadata exclusion, bounded reads/results, regex length/complexity/deadline limits | Concrete implementation and test checklist for injected `ToolSandbox` / repository-inspection tools | **Security reference only initially**; do not assume the donor sandbox satisfies Pocket's host isolation contract | P1 |
| D-08 | `stride_gpt/agent/persistence.py` | Structured plan/findings/run manifests; completed vs partial status; per-subsystem outcomes; resumed/rerun lists; model identities; config hash; target Git SHA; token/tool usage; loaded references | East task artifact / research-run manifest and Archivist provenance | **Adapt schema concepts**; persistence must use Pocket's durable store and must not create a parallel workflow authority | P1 |
| D-09 | `stride_gpt/agent/report.py` | Markdown, JSON, and SARIF rendering from structured analysis results | ExploitGym findings/report adapters and export layer | **Reuse report mapping concepts**; verify whether an existing Pocket SARIF exporter exists before implementation | P2 |
| D-10 | `stride_gpt/agent/progress.py` | UI-neutral progress callback protocol for phase, subsystem, tool, error, budget, and completion events | Agent Team UI / telemetry event adapter | **Adapt interface only**; publish through Pocket's existing event/message contracts | P3 |
| D-11 | `stride_gpt/core/schemas.py` | Typed plan/finding/outcome/token-usage structures and explicit outcome taxonomy | Existing Zod/TypeScript message and task result schemas | **Schema reference only**; do not import Python/Pydantic models into the TypeScript core | P2 |

### Donor source links

- Planner: https://github.com/mrwadams/stride-gpt/blob/master/stride_gpt/agent/planner.py
- Agent loop and cross-subsystem synthesis: https://github.com/mrwadams/stride-gpt/blob/master/stride_gpt/agent/loop.py
- Source evidence verification: https://github.com/mrwadams/stride-gpt/blob/master/stride_gpt/agent/evidence.py
- Filesystem tools and path sandboxing: https://github.com/mrwadams/stride-gpt/blob/master/stride_gpt/agent/tools.py
- Context compression: https://github.com/mrwadams/stride-gpt/blob/master/stride_gpt/agent/context.py
- Progressive reference cards: https://github.com/mrwadams/stride-gpt/blob/master/stride_gpt/core/prompts/variants.py
- Run manifest and persistence: https://github.com/mrwadams/stride-gpt/blob/master/stride_gpt/agent/persistence.py
- Report/SARIF renderer: https://github.com/mrwadams/stride-gpt/blob/master/stride_gpt/agent/report.py
- Progress protocol: https://github.com/mrwadams/stride-gpt/blob/master/stride_gpt/agent/progress.py
- Schemas: https://github.com/mrwadams/stride-gpt/blob/master/stride_gpt/core/schemas.py
- License: https://github.com/mrwadams/stride-gpt/blob/master/LICENSE

## 3. Pocket AI Lab overlap and reuse boundaries

The following Pocket AI Lab implementations were inspected on `main`:

| Existing Pocket AI Lab component | Observed responsibility | Donor decision |
|---|---|---|
| `packages/intelligence/orchestrator/Orchestrator.ts` | Injected `InferenceProvider`; agent/model/router/deliberation/memory assembly; model output is untrusted proposal data | Do not replace with STRIDE agent loop |
| `packages/intelligence/agents/AgentManager.ts` | Permanent core roles and task-scoped specialist lifecycle | Do not import donor agent registry |
| `packages/intelligence/message-bus/MessageBus.ts` | Zod-validated typed messages, immutable publication, task threads | Reuse Pocket protocol; adapt donor result schemas into it |
| `packages/intelligence/deliberation/DeliberationEngine.ts` | Bounded independent, cross-review, challenge, revision, verification, synthesis; consensus requires Validator affirmation and no unresolved objections | Add emergent/aggregation analysis as a specialist stage, not a second deliberation engine |
| `packages/intelligence/memory/MemoryManager.ts` | Four memory layers, provenance, unverified-by-default entries, serialized persistence mutations | Do not substitute donor context compression for durable memory |
| `packages/intelligence/tooling/ToolDirector.ts` | Generated code is untrusted; testing requires injected isolated sandbox; activation requires independent approval bound to exact digest | Donor path/regex controls are test ideas, not a replacement sandbox |
| `packages/intelligence/security/tools.ts` | Tool metadata only; availability is separate from permission; no execution authority | Keep current boundary |
| `src/east/index.ts` and East lifecycle work | Durable task/workflow execution and evidence references; current bridge explicitly returns `authorized: false` | Checkpointing must integrate with East, not create a parallel state machine |
| `docs/architecture/Pocket-AI-Lab-Multi-Agent-Intelligence-Architecture-v1.0.md` | Model independence, on-device-first design, permanent + dynamic agents, APEX/East governance boundaries | Governing architecture remains authoritative |

Useful Pocket source links:
- https://github.com/macksteward59-lgtm/pocket-ai-lab/blob/main/packages/intelligence/orchestrator/Orchestrator.ts
- https://github.com/macksteward59-lgtm/pocket-ai-lab/blob/main/packages/intelligence/agents/AgentManager.ts
- https://github.com/macksteward59-lgtm/pocket-ai-lab/blob/main/packages/intelligence/message-bus/MessageBus.ts
- https://github.com/macksteward59-lgtm/pocket-ai-lab/blob/main/packages/intelligence/deliberation/DeliberationEngine.ts
- https://github.com/macksteward59-lgtm/pocket-ai-lab/blob/main/packages/intelligence/memory/MemoryManager.ts
- https://github.com/macksteward59-lgtm/pocket-ai-lab/blob/main/packages/intelligence/tooling/ToolDirector.ts
- https://github.com/macksteward59-lgtm/pocket-ai-lab/blob/main/packages/intelligence/security/tools.ts
- https://github.com/macksteward59-lgtm/pocket-ai-lab/blob/main/src/east/index.ts
- https://github.com/macksteward59-lgtm/pocket-ai-lab/blob/main/docs/architecture/Pocket-AI-Lab-Multi-Agent-Intelligence-Architecture-v1.0.md

## 4. Critical trust and implementation rules

1. A verified source snippet means only that the quoted text was found at a path/line range in the inspected tree. It does **not** prove exploitability, reachability, runtime behavior, source authenticity, or absence of a mitigating control.
2. Donor verification output must remain an untrusted analysis result. It must never mint or stand in for `Evidence.swift`, signed generation evidence, cryptographic attestation, APEX approval, East authorization, or a trusted receipt.
3. Repository inspection is read-only by default. Any proposed write, test execution, scanner, network operation, or generated-code execution must pass Pocket's existing scope, tool, sandbox, and authorization gates.
4. Filesystem safety must cover path traversal, symlink escape, VCS metadata/credential exposure, file-size limits, output limits, regex denial of service, timeouts, and cancellation. A timeout in one layer is not proof that underlying work stopped.
5. Keep the donor implementation model/provider independent. Do not import LiteLLM or make Pocket's native iOS path depend on Python.
6. Preserve the existing offline-first/native runtime direction. Donor code must not introduce a required cloud API, a second model router, or an alternate agent authority.
7. Preserve MIT notices for any copied code. Prefer a clean TypeScript reimplementation of small algorithms with attribution and source references when that produces a better fit.

## 5. Recommended prototype order and acceptance gates

### Prototype A — Source quote verifier (D-02)
- Implement a TypeScript verifier behind a read-only repository-analysis interface.
- Reuse the same root/path policy as the approved Pocket repository-inspection sandbox; do not create a weaker parallel resolver.
- Return `verified`, normalized relative path, exact 1-based line range, occurrence count, and bounded failure reason.
- Reject out-of-root paths, symlink escapes, missing/non-file paths, oversized files/snippets, malformed evidence objects, and ambiguous matches.
- Test exact match, whitespace normalization, CRLF/LF, duplicate occurrences, paraphrase rejection, path traversal, symlink escape, binary/oversized file, and line-number accuracy.
- Output remains an untrusted finding reference; no Evidence/receipt/authorization APIs are called.

### Prototype B — Cross-subsystem emergent analysis (D-04)
- Input only findings already produced by independent subsystem analyses.
- Label each synthesis item as `aggregation` or `emergent`.
- Aggregation must cite the IDs of existing findings and must not invent new evidence.
- Emergent claims must cite the exact existing evidence items for every link in the cross-subsystem chain.
- Reject or downgrade any emergent claim with missing, paraphrased, or unverified evidence.
- Test duplicate systemic findings, genuine multi-subsystem chains, repeated-but-unconnected findings, duplicate chain suppression, and hallucinated evidence rejection.
- Report disagreement and uncertainty; do not convert consensus into permission.

### Prototype C — Fair repository planner (D-01)
- Inventory source/config/deployment files while excluding generated/vendor/VCS/secret directories.
- Partition by actual trust boundary/deployable subsystem; assign each source file to at most one subsystem unless an explicit shared dependency relation is recorded.
- Use recursive fair sampling so nested high-volume folders cannot starve sibling components.
- Persist discovered-vs-sampled counts and warn when the planner saw only a sample.
- Require plan inspection/approval before any broad or costly analysis; inspection remains read-only.

### Prototype D — Run manifest (D-08)
- Record target repository/ref/commit, plan version/hash, model/provider identifiers (never credentials), prompt/reference versions, files and subsystems planned/analyzed/skipped, per-stage tool/model-call counts, token usage when available, completion/partial outcome, resumed work, and evidence references.
- Distinguish missing usage metadata from zero usage.
- Record failures and incomplete coverage instead of presenting partial output as complete.
- Persist through East's durable task/artifact path; do not create a second workflow store.

### Prototype E — Progressive knowledge loading (D-06)
- Discover a small catalogue of specialist reference metadata first.
- Load full content only when the task/agent capability and policy require it.
- Version and hash reference content; record what was actually loaded in the run manifest.
- Integrate with Pocket's knowledge catalog rather than duplicating it.

### Prototype F — Context compression (D-05)
- First measure whether current providers expose trustworthy token counts/context limits.
- Preserve system/developer constraints, the original task, latest complete interaction/tool-call groups, and explicit pending work.
- Keep durable memory separate from transient context summaries.
- A failed summary must leave the original context intact; never silently discard unresolved objections, tool outputs, or provenance.

## 6. Explicit non-donors

Do **not** transplant:
- STRIDE-GPT's LiteLLM/provider orchestration or Python-specific LLM configuration into Pocket's model-independent inference contracts.
- Its standalone CLI/Streamlit application shell.
- Its own agent loop as a replacement for Pocket Orchestrator/Deliberation/East.
- Its filesystem tools as proof that Pocket has a production-grade sandbox.
- Its source-snippet verification as a replacement for signed generation evidence or trusted verification.
- Its persistence/checkpoint store as a replacement for East durable lifecycle state.
- Its threat-model schema as the canonical Pocket AgentMessage protocol.

## 7. Dependency and compatibility notes

The donor `pyproject.toml` declares Python `>=3.12`, LiteLLM, Pydantic, HTTPX, Typer, Rich, prompt-toolkit, defusedxml, and regex. Pocket's core intelligence implementation is TypeScript with Swift native runtime components. Therefore, importing the donor package wholesale would add a second runtime/dependency surface and is not recommended.

The MIT license is compatible with reuse subject to preserving its notice and license text. Recheck the donor's current license and dependency advisories at the time of any future code copy.

## 8. Audit limitations and next decision

This register is based on source files read from the donor's `master` branch and Pocket AI Lab's `main` branch on 2026-11-17, plus the Pocket architecture and coordination records available at audit time. It is a source-level compatibility assessment, not a full test-suite run, dependency audit, exploitability assessment, or proof that every referenced donor function is production-safe.

**Recommended next engineering slice:** Prototype A (D-02) and Prototype B (D-04) as isolated TypeScript analysis services, after checking the active feature-branch ownership board and selecting non-overlapping feature-branch paths. Do not edit APEX, Evidence, BridgeGate, RuntimeController, LlamaEngine, or East trust/authorization contracts as part of these prototypes.
