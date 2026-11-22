# Pocket AI Lab — Screenshot-aware red-team research and evidence contract v1

**Research checkpoint:** 2026-11-22 UTC  
**Purpose:** Extend the owner's red-team/bug-bounty investigation using concrete public GitHub and Hugging Face sources, while strengthening the existing Pocket AI Lab foundation.  
**Status:** Research proposal plus an executable **offline synthetic evidence-consistency probe**. **No integration, model inference, container, browser session, target request, physical iPhone verification, exploit reproduction, or live screenshot redaction has been demonstrated.**

## 1. Source-of-truth and conflict resolution

Canonical repository: [`macksteward59-lgtm/pocket-ai-lab`](https://github.com/macksteward59-lgtm/pocket-ai-lab), default branch `main`; coordination branch `agent-coordination`. The [owner's issue #255](https://github.com/macksteward59-lgtm/pocket-ai-lab/issues/255), [`coordination/LEADERSHIP.md`](../../../coordination/LEADERSHIP.md), [`coordination/PROTOCOL.md`](../../../coordination/PROTOCOL.md), [`coordination/BOARD.md`](../../../coordination/BOARD.md), append-only [`coordination/LOG.md`](../../../coordination/LOG.md), [complete handoff](../../../coordination/POCKET_AI_LAB_COMPLETE_PRODUCT_HANDOFF_2026-11-17.md), [master requirements](../../requirements/POCKET_AI_LAB_MASTER_REQUIREMENTS_CHECKLIST.md), and [traceability](../../requirements/POCKET_AI_LAB_REQUIREMENTS_TRACEABILITY.md) take precedence over a generic agent-framework recipe. Reconcile current branch heads/PRs on every new implementation cycle; a historical PR is not a merged feature.

At the source-check checkpoint, `main` was `fb59f76ea8bbb496ba9b40c2d54f7252a4dc9873` (2026-11-19). `agent-coordination` was advancing during research; pin its actual head when an implementation is claimed. The 344-row traceability ledger's last inspected inventory showed 0 individually verified production-path requirements; that is not proof that code is absent. Earlier source-donor experiments already include an EmbeddingGemma 2 cross-modal plan, a text-only BM25 5/6 top-1 baseline, a classifier failing its acceptance gate, and an LLMON round-trip with larger encoded bytes: [experimental donor record](../experimental-model-donors-20261121.md). **Do not duplicate these trials or treat model weights as deployed.**

## 2. Specific corrections to the generic Deep Research response

1. **Do not replace East/e3 with LangGraph, Temporal, or AutoGen.** Existing Director/APEX determines authorization; East owns durable task identity and recovery. Optional LangGraph/Temporal/other harnesses can be external adapters with immutable task receipts, not a second authority. [Microsoft archived AutoGen and recommends Microsoft Agent Framework](https://github.com/microsoft/autogen).
2. **Do not use Llama Guard as a vulnerability root-cause judge.** Meta documents prompt/output *safety-category classification*, not verification of authentication logic or business-rule violations. [Official Meta model card](https://dev.meta.ai/llama/docs/model-cards-and-prompt-formats/llama-guard-3).
3. **Do not trust screenshots as complete evidence.** For controlled test pages, pair visual images with accessibility snapshots, DOM/AST context, sanitized network summaries, fixture role/tenant state, exact task identity, and a deterministic oracle. Playwright MCP [acts by accessibility snapshots](https://github.com/microsoft/playwright/blob/main/docs/src/getting-started-mcp.md), has a [screenshot capture operation](https://github.com/microsoft/playwright.dev/blob/main/mcp/tools/screenshots.mdx), and [optional coordinate-based vision mode](https://github.com/microsoft/playwright.dev/blob/main/mcp/vision-mode.mdx). A screenshot alone cannot prove an unauthorized server-side action occurred.
4. **Do not store all raw proxy traffic by default or claim mitmproxy is a network boundary.** HARs/proxy records can contain session secrets. Real egress enforcement belongs to the trusted host/network environment with DNS/IP/IPv6/redirect/rebinding tests; tool-supplied request logs are evidence, not enforcement.
5. **Do not make Qdrant/Chroma an iPhone prerequisite.** First use existing cited memory and a bounded local index (e.g., SQLite FTS), then evaluate embedding or graph donors against retrieval baselines. External vector stores are optional opt-in host adapters.
6. **Do not infer iOS readiness or a competitive breakthrough from model cards.** Model download, hosted inference, Linux fixture tests, iOS simulator builds, actual unsigned phone kit, and fresh physical-iPhone model generation are distinct proof gates. Claims that one model beats CodeQL or elite human hunters need independently repeated, matched testing.
7. **Do not import third-party agent setup scripts with elevated permission flags.** The [Transilience communitytools README](https://github.com/transilienceai/communitytools) documents a `--dangerously-skip-permissions` development launch path; copying it into Pocket AI Lab would bypass the governed execution design. Reuse narrow, reviewed schemas/test concepts only.
8. **Do not download leaked proprietary screenshots as a source corpus.** Public exposure is not a legal or privacy grant. Use owner-controlled or synthetic images for replicable visual studies. Create redacted hashes and allowlisted source references; sensitive pixels/OCR text may carry secrets and prompt-injection text.

## 3. Ranked donor map — integration hypothesis, not adoption approval

| Priority | Source (official public repository/model card) | Observed capability / licensing lead | Narrow Pocket AI Lab experiment | Status or blocker |
|---|---|---|---|---|
| P0 | [Microsoft Playwright MCP](https://github.com/microsoft/playwright/blob/main/docs/src/getting-started-mcp.md) / [screenshots](https://github.com/microsoft/playwright.dev/blob/main/mcp/tools/screenshots.mdx) | A11y snapshots, element references, optional images; verify transitive packages/license before copying code | External **host-only** read-only BrowserEvidenceAdapter on a local fixture, record snap/image hash and role | Source-described; no app integration |
| P0 | [Schemathesis](https://github.com/schemathesis/schemathesis) | OpenAPI/GraphQL/gRPC adaptive chained API tests; MIT. It sends state-changing requests | Controlled local API fixture with deliberately seeded access invariant, never open Internet | Source-described; no fixture executed |
| P0 | [OWASP WSTG-ATHZ-02](https://wstg.owasp.org/latest/09-Authorization/02-Bypassing_Authorization_Schema/) / [MITRE CWE-639](https://cwe.mitre.org/data/definitions/639.html) / [CWE-841](https://cwe.mitre.org/data/definitions/841.html) | Authoritative horizontal/vertical authorization and workflow-order definitions, not software donors | Predeclare two-tenant allow/deny oracle and workflow-state invariants | Normative reference / tested concept |
| P1 | [Browser Use](https://github.com/browser-use/browser-use) | MIT Python CDP agent; some methods execute model-written Python and browser sessions can expose logged-in data | Study action trace and element-mapping as a **read-only donor**, never copy its unrestricted execution authority | High tool/secret risk; not installed |
| P1 | [Stagehand](https://github.com/browserbase/stagehand) / [license](https://github.com/browserbase/stagehand/blob/main/LICENSE) | MIT browser AI automation with TS/Python/Go interfaces | Compare deterministic selector replay vs agent-selected actions on lab fixture | Optional external adapter, not deployed |
| P1 | [PentAGI](https://github.com/vxcontrol/pentagi) | MIT-labeled Go/React autonomous security agent suite, containerized tools, graph context and reporting | Study structured finding/evidence event schema and evaluation; **do not transplant shell/tool authority** | License/NOTICE/EULA per component review still required |
| P1 | [PentestGPT](https://github.com/GreyDGL/PentestGPT) / [MIT license](https://github.com/GreyDGL/PentestGPT/blob/main/LICENSE.md) | Multi-stage security agent prototype and publicly described CTF benchmarks | Borrow *only* narrow stage separation and frozen benchmark design; compare on our own held-out fixtures | Benchmarks not proof of open bounty superiority |
| P1 | [Transilience communitytools](https://github.com/transilienceai/communitytools) | MIT-labeled security skills, Playwright flows and reporting; example setup disables permissions | Review prompt/tool taxonomy as untrusted data; port only scoped test fixtures | Permission-bypass instructions unsuitable |
| P1 | [HuggingFaceTB/SmolVLM2-2.2B-Instruct](https://huggingface.co/HuggingFaceTB/SmolVLM2-2.2B-Instruct) | Apache-2.0 vision-language image/video question answering | Blind screenshot vs screenshot+a11y: identify misleading UI states, calibrated abstention | Never an authorization/verifier role; no run yet |
| P1 | [lightonai/LightOnOCR-2-1B](https://huggingface.co/lightonai/LightOnOCR-2-1B) | Apache-2.0 image/document OCR | Detect known visible labels from synthetic screenshots; preserve pixel coordinates and omissions | OCR does not prove a defect; no run yet |
| P1 | [google/embeddinggemma-2](https://huggingface.co/google/embeddinggemma-2) / [project donor review](../experimental-model-donors-20261121.md) | Google Apache-2.0 740M multimodal retrieval; already ranked in Pocket AI Lab | Reuse prior proposed screenshot-to-source recall study and BM25 5/6 baseline | **Do not** repeat donor work or claim iOS execution |
| P2 | [Virtue-AI-HUB/VulnLLM-R-7B](https://huggingface.co/Virtue-AI-HUB/VulnLLM-R-7B) | Apache-2.0, publisher claims code-vulnerability superiority on selected benchmarks | Frozen C/C++/Java/Python paired patch tests vs CodeQL; report false positives | Publisher claim only; benchmark not independently verified here |
| P2 | [Skyvern](https://github.com/skyvern-ai/skyvern) | AGPL-3.0 browser workflow reference plus opt-out telemetry | Study UI evidence review and session cancellation **without copying AGPL code** | Counsel/license review before any use in distributed product |
| Reject as primary | [AutoGen](https://github.com/microsoft/autogen) | Archived/unmaintained in 2026; official successor is Microsoft Agent Framework | Historical reference only, no dependency | Archived |

Code licenses and model-weight licenses are separate. Every planned donor use needs a pinned revision, dependency review, SBOM/licensing notices, model family/template check and host-specific test. Published benchmarks and star counts do not establish project acceptance. External browser agents require their own sandbox and no access to users' Chrome profiles or real credentials.

## 4. Concrete architecture: visual evidence as one *proposed* adapter

```text
User-owned/synthetic visual fixture + explicit trusted scope
  -> existing Director/APEX authority (not model claims)
  -> East/e3 task + attempts + 70/30 budget reservation
  -> external hosted BrowserEvidenceAdapter (future, local-fixture only)
       captures: screenshot bytes + a11y snapshot + safe URL + bounded network summary
  -> artifact hash + quarantine + human/image privacy classification
  -> deterministic fixture-oracle and invariant evaluator
  -> ExploitGym isolated verification, if separately authorized
  -> independent Critic / Validator (can reject unsupported claims)
  -> existing Evidence / memory-citation store with task/attempt lineage
  -> iPhone owner review (redacted screen, evidence, uncertainty)
```

**Do not create a new Director, model router, MessageBus or East workflow engine.** The adapter is a *candidate interface*, not a confirmed implementation path; locate actual API call sites and overlapping ownership before coding it. The model may propose an issue and search relevant evidence. Only existing governance and trusted host controls authorize actions. Models/agent screenshots cannot fabricate a host action receipt.

### Proposed per-capture evidence envelope

- Version, task ID, attempt ID, capture ID, bounded trusted-scope reference, source version, capture timestamp.
- Screenshot content digest and independently checked redaction metadata; raw private screenshot stays local.
- Accessibility-snapshot and sanitized network-summary digests; trusted fixture user/tenant and expected state references.
- Trusted source/origin allowlist, validated redirect chain, network prohibition and explicit no-production rule.
- Host/runtime/model attribution and separate policy decision/evidence receipt references, when these are **actually produced**.
- Result type: `candidate`, `rejected`, `inconclusive`, or `verified-on-named-fixture`; never infer `verified` from a single screenshot.

The adjacent [`visual-evidence-contract-v1.mjs`](./visual-evidence-contract-v1.mjs) is a tiny offline research implementation for *consistency checking only*. It never loads a browser or model, never accesses the network, never redacts a photo, and never provides an APEX decision. Its tests are in [`visual-evidence-contract-v1.test.mjs`](./visual-evidence-contract-v1.test.mjs).

## 5. Exact synthetic evaluation and rejection cases

**Owned deterministic lab only:** create two fake users A/B with separate tenants, an owner-owned resource, and a consented read-only browser session. Hold screenshot and snapshot captured at identical workflow step and attach expected server-state oracle. The illustrative research test implements only the evidence *metadata* and *hypothesis* portion; the actual lab server and BrowserEvidenceAdapter are a follow-up PR.

| Case | Synthetic expected condition | Must happen |
|---|---|---|
| Happy path A | A reads owned record | Correct authorized response; no vulnerability claim |
| Negative B | B requests A's record | Denied; validator rejects any model-suggested finding |
| Seeded faulty B | B requests A's record in a deliberately vulnerable fixture | Candidate CWE-639 only when independent fixture oracle confirms deny and observed allow |
| Ordered workflow | Required approval/state transition cannot be skipped | Negative and seeded CWE-841 cases distinguished by server-state oracle |
| Misleading visual | UI says denied, API/fixture state differs, or vice versa | Inconclusive until correlated; do not treat OCR as server truth |
| Bad lineage | Correct image with wrong task/attempt/scope or changed bytes | Fail closed; no evidence promotion |
| Privacy | Real screenshot, pasted private content, unreviewed/secret-containing pixels | Reject from synthetic pipeline; no cloud upload |
| Scope | `localhost` typo, external origin, redirect, IP/IPv6 bypass, expired approval | Reject at host authorization/egress boundary (future integration); fixture checker only tests URL consistency |
| Interruption | Cancellation, crash and restart mid-capture | East reconciles previous attempt without duplicate external action (future integration) |
| Budget | Multiple child workers approaching 70% measured cap | Host-side atomic reservations and early 60% drain, never agent-reported quotas alone (future integration) |

**Predeclared acceptance for next implementation:** all seeded negative/positive fixture cases correct, zero permitted egress outside explicit lab namespace, zero cross-task image acceptance, 100% retained source/task/attempt hashes, all synthetic secrets deliberately marked and redacted before export, crash-resume with exactly-once *recording* (not blind exactly-once network side effects), independent adjudication, and no additional cloud spend/target requests. Record all disagreements and test host. Only claim external-source improvements after independent model/fixture evaluation against a frozen no-image baseline. For iPhone, physical execution/readiness remains a separate gate.

## 6. Engineering order and PR boundaries

1. **This PR — documentation + offline fixture checker only:** Record source corrections, candidate donor ranking, interface proposal, and ten `node:test` checks. No application integration or policy/authority changes. No browser, network, protected data or device test.
2. **Follow-up A — deterministic fixture + egress:** Obtain a non-overlapping board claim; create a loopback-only two-tenant business-rule fixture with an independent server-state oracle. Demonstrate actual enforced egress/network deny and no secrets with negative tests.
3. **Follow-up B — browser evidence adapter:** Only after A, add a host-side adapter through existing East task identity and APEX authorization, capturing screenshot and accessibility/DOM/sanitized trace with exact lineage. Compare Playwright MCP against a selector-only test. Never copy third-party elevated permission scripts.
4. **Follow-up C — independent ExploitGym adjudication:** Link fixture results, Critic/Validator, source-cited evidence and owner report. Integrate only after checking PR #139 and #183–184 overlaps, permission contracts, branch bases and tests; do not infer a preflight manifest grants authority.
5. **Follow-up D — optional VLM/OCR/model evaluation:** Blind SmolVLM2 vs LightOnOCR vs accessibility-only baseline; include hallucinated UI labels, occlusions, prompt-injection text embedded in images, screenshot privacy, wrong tenant and screenshot-source recall. Test model/version/runtime honestly. Reuse the existing EmbeddingGemma/BM25 study rather than duplicate it.
6. **Follow-up E — native review and recovery:** Consume sanitized, provider-attributed evidence through existing native app/BridgeGate/memory; physical iPhone Air tests for offline review, actual inference if chosen, cancellation, thermal/battery/peak RAM and app termination. Do not declare this complete based on simulator, web viewer or an unsigned kit.

### Existing project branches to reconcile before follow-up code

At the review checkpoint: [#139](https://github.com/macksteward59-lgtm/pocket-ai-lab/pull/139) ProofHunt scope/authorization; [#183](https://github.com/macksteward59-lgtm/pocket-ai-lab/pull/183) scope preflight; [#184](https://github.com/macksteward59-lgtm/pocket-ai-lab/pull/184) quarantine provenance; [#217](https://github.com/macksteward59-lgtm/pocket-ai-lab/pull/217) learning; [#227](https://github.com/macksteward59-lgtm/pocket-ai-lab/pull/227) provider-backed agent proof; [#249](https://github.com/macksteward59-lgtm/pocket-ai-lab/pull/249) owner review; [#253](https://github.com/macksteward59-lgtm/pocket-ai-lab/pull/253) citation; [#254](https://github.com/macksteward59-lgtm/pocket-ai-lab/pull/254) native recovery; [#266](https://github.com/macksteward59-lgtm/pocket-ai-lab/pull/266) source-answer/recovery review. At inspection these were **draft/open**, not mainline product acceptance. Recheck heads, diffs and active claims before follow-ups.

## 7. Observed local result and limitations

Run from this directory: `node --test visual-evidence-contract-v1.test.mjs`. On Linux host with Node **v22.16.0**, the ten synthetic/offline tests passed. Tested: content-digest agreement, forged but non-PNG bytes, changed image and a11y text, out-of-scope redirect, wrong origin port, wrong-task replay, unreviewed/external data, candidate-only tenant mismatch and inconclusive state. **This does not test** real PNG decodability, pixel redaction, screenshot production, actual actor privileges, production APEX authorization, real networking, browser instrumentation, models, iOS hardware or integration with East/ExploitGym. The byte check uses a PNG magic signature and digest only. The unit test image is a static 1x1 synthetic PNG, not a user or third-party screenshot.

This is the *first narrow evidence-data experiment*, not the completed red-team ecosystem. No human-hacker performance claim has been established. The next executable action is follow-up A after a reviewed non-overlapping code claim and source-level reconciliation. 
