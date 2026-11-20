# Pocket AI Lab — Complete Product Vision & Engineering Handoff

**Prepared:** 2026-11-17  
**Repository:** `macksteward59-lgtm/pocket-ai-lab`  
**Coordination branch:** `agent-coordination`  
**Document role:** Consolidated product vision, architecture contract, requirements handoff, integration map, current evidence, blockers, and execution sequence  
**Primary product target:** Native iOS Pocket AI Lab on the owner's iPhone Air (256 GB)  
**Status:** Authoritative coordination handoff; not a claim that the product is complete

> This handoff consolidates the durable product decisions and technical requirements available from prior project discussions and the repository's current coordination records. The master checklist remains the detailed requirement baseline; the traceability matrix remains the requirement-level audit ledger. This document connects those records into one implementation-ready plan. If an original source artifact is unavailable, its contents are explicitly marked as needing recovery rather than reconstructed by guesswork.

## 2026-11-20 native sequence-capture/GIE integration execution

**PR #226 — verified hosted native matrix:** [iOS CI #44657025676](https://github.com/macksteward59-lgtm/pocket-ai-lab/actions/runs/44657025676) attempt #2 completed **success** on exact head `4df8e74d9351605bea72bda3338a3c28cb4bf322`; native app build, app XCTest, simulator XCTest, pinned GGUF and macOS XCTest all passed. This supersedes its earlier cancelled-run checkpoint. PR #226 remains draft/unmerged; physical iPhone acceptance is separate.

**PR #229 — current integration candidate:** [Draft PR #229](https://github.com/macksteward59-lgtm/pocket-ai-lab/pull/229), head `d067e0506b2575f41c356a03f3e19bd324a8f3ed`, preserves the non-force merge of PR #222's bounded native capture and PR #228's canonical GCB1/GIE1 stack. The follow-up corrects byte-exact Unicode identity matching, rejects impossible payload budgets before inference, and tests pool/scheduler cleanup after an actual-size rejection. The existing real pinned-GGUF XCTest now calls `NativeGIECaptureEncoder.generate` through the live native lease using an explicitly **synthetic, untrained** codebook. The fixed whole-second test clock is retained. [Implementation and evidence limits](https://github.com/macksteward59-lgtm/pocket-ai-lab/blob/d067e0506b2575f41c356a03f3e19bd324a8f3ed/docs/implementation/native-gie-capture-integration.md).

**Passed on this revision:** focused [Swift source/fixture/adapter CI #44711246216](https://github.com/macksteward59-lgtm/pocket-ai-lab/actions/runs/44711246216) (also PR #44711255730) and [general Pocket CI #44711246262](https://github.com/macksteward59-lgtm/pocket-ai-lab/actions/runs/44711246262). Logs verify canonical 56-byte/two-segment payloads, zero preflight inference calls, four Unicode rejections and cleanup after oversized output. The fixture engine remains labeled `.other`. Internal source review found no blocker; no formal review approval is inferred.

**Full native gate — PASSED:** [iOS/macOS/GGUF CI #44711255715](https://github.com/macksteward59-lgtm/pocket-ai-lab/actions/runs/44711255715), attempt 1, completed **success** on this exact source revision at 2026-11-20T10:03:28Z. Native app XCTest: 60 tests, zero failures. Engine simulator: 113 tests, three skips, zero failures. macOS engine: 113 tests, one skip, zero failures. The real pinned-GGUF runtime smoke **executed and passed on macOS**; its new marker records actual llama.cpp capture of **8 tokens × 576 values, two segments, and a 1,206-byte GIE1 payload** using a **synthetic/untrained** codebook. Model hash was rechecked; the log confirms lease release/unload and the test asserts zero model-use pins and scheduler requests. This proves hosted native producer-to-codec execution, not trained representation quality, recipient consumption or physical iPhone acceptance. The current PR test-merge tree was verified identical to the feature-head tree. The earlier cancelled run remains historical and is not counted as this pass.

**Recipient gate confirmed from source:** native requests and the C bridge still accept text only. The GIE decoder returns pooled vectors, and the agent coordinator still forwards untrusted text proposals. The older affine-int8 latent channel does not implement a GIE route or model ingestion; its supplied storage/replay implementations are in-memory and its concrete authorization helper is a static test policy. Define and demonstrate supported recipient input semantics and vector-dependent inference, then evaluate task quality against the text path before enabling an authorized GIE route.

**Still required:** host-attested production model/codebook provenance, actual recipient-model consumption, APEX sender/recipient authorization, East task ownership/persistent replay, protected binary blob storage/expiry, tested route fallback, independent task-quality evaluation, physical iPhone Air offline/thermal/memory acceptance and production signed Evidence. No requirement is marked verified from this checkpoint.

## 2026-11-20 supplementary native GIE evidence — standalone Swift test

[Draft PR #228](https://github.com/macksteward59-lgtm/pocket-ai-lab/pull/228) adds a **test-only**, independently compiled macOS Swift source check stacked on PR #226. Exact-head [CI #44705759309](https://github.com/macksteward59-lgtm/pocket-ai-lab/actions/runs/44705759309) passed native production-source compilation and shared canonical GCB1/GIE1 fixture/tamper checks, without depending on pinned llama.cpp or the full iOS app build. This is useful codec-level evidence but neither a full iOS XCTest nor a physical iPhone, live model-generation, APEX/East, G.I.R.L. recipient consumption or release acceptance result. Do not mark master requirements verified from this isolated test.

The earlier full native PR #226 attempt #1 [#44657025676](https://github.com/macksteward59-lgtm/pocket-ai-lab/actions/runs/44657025676) was **cancelled** during native app build. A targeted rerun of the same exact head was accepted and is running as attempt #2; do not report success until the run concludes. Preserve the full native workflow and the test-only PR as independent evidence gates.

## 2026-11-20 latest verified integration checkpoint (supersedes older CI statuses below)

- **GIE integration:** [PR #226](https://github.com/macksteward59-lgtm/pocket-ai-lab/pull/226), current merge commit `4df8e74d9351605bea72bda3338a3c28cb4bf322`, now **6 commits ahead / 0 behind** current parent PR #224. Its diff is limited to the original five GCB1/GIE1 fixture/CI/resource files, and reconciliation used a non-force two-parent merge; no duplicate encoder implementation or rewritten branch. Exact-head [GCB1 CI #44657025607](https://github.com/macksteward59-lgtm/pocket-ai-lab/actions/runs/44657025607) passed. [Native CI #44657025676](https://github.com/macksteward59-lgtm/pocket-ai-lab/actions/runs/44657025676) was **pending runner** at last check.
- **Native parent acceptance:** [PR #224](https://github.com/macksteward59-lgtm/pocket-ai-lab/pull/224) test clock fix remains at `8154cbb0d005a7560adf1ec6e443aeee95221c60`. Its [native run #44656042729](https://github.com/macksteward59-lgtm/pocket-ai-lab/actions/runs/44656042729) finalized **cancelled** during native app build; downstream app/simulator/macOS XCTest were skipped. It is **not** a native pass. A targeted GitHub rerun was rejected with HTTP 403 "workflow run already running" despite the read-side cancelled conclusion; no rerun was initiated.
- **Host agent proof:** [PR #227](https://github.com/macksteward59-lgtm/pocket-ai-lab/pull/227) head `42665cb92bb303b56107d375b3779f9c11dc81cb` passed exact-head [focused CI #44657097407](https://github.com/macksteward59-lgtm/pocket-ai-lab/actions/runs/44657097407) with **seven** tests. A simulated loopback HTTP llama-server now exercises the real HTTP adapter and the seven-stage Orchestrator/MessageBus/MemoryManager path, while being labeled **test-double**, not actual GGUF inference. Its full Pocket CI is still red due main's pre-existing missing East lifecycle imports. No native iPhone, production APEX/East execution, or verified memory/evidence result.
- **Governance:** all these PRs remain draft/unmerged; no requirements checkbox was marked accepted from test doubles or incomplete CI. See the append-only coordination log and active board for exact evidence, scope and next work.

## 2026-11-20 engineering proof and CI reconciliation checkpoint

The owner delegated routine Pocket AI Lab engineering coordination and implementation decisions without per-step approval requests. This does **not** bypass Director/APEX task authorization or owner-controlled secrets, Apple signing, protected merges, releases or deployment. Work must remain on claimed feature branches with honest exact-head evidence.

**Integration probe:** [draft PR #227](https://github.com/macksteward59-lgtm/pocket-ai-lab/pull/227) adds a runnable, opt-in, loopback-only llama.cpp multi-agent proof using the **existing** Orchestrator, model router, six logical roles, MessageBus and MemoryManager. See [Unified Provider-Backed Agent Proof](../docs/implementation/unified-agent-provider-proof.md). It records seven provider calls, their ordered messages, model label and an unverified episodic memory. Six deterministic **test-double** regressions and JS syntax checking passed in exact-head [focused CI #44655459588](https://github.com/macksteward59-lgtm/pocket-ai-lab/actions/runs/44655459588). **No real GGUF/backend, native iOS, APEX/East durable task or signed evidence acceptance has yet been claimed.**

**Known repository-wide build blocker:** current `main` includes `autonomy.test.ts` imports referencing lifecycle types and modules from unmerged East integration [PR #157](https://github.com/macksteward59-lgtm/pocket-ai-lab/pull/157). The full TypeScript build fails, independently of PR #227 ([exact-head general run #44655459458](https://github.com/macksteward59-lgtm/pocket-ai-lab/actions/runs/44655459458)); the archive smoke test also fails at its embedded `npm run build`. Do not backfill missing East implementations into the probe or treat focused CI as global success. Reconcile the existing East stack through its own approved review path.

**Native GIE follow-up:** [draft PR #226](https://github.com/macksteward59-lgtm/pocket-ai-lab/pull/226) adds verified canonical GCB1/GIE1 shared fixtures. The first native run failed because SwiftPM test resources omitted the new fixture; commit `5d5cf22b32f3fa639b90e4b95fc4a0aa15988073` adds it. Exact-head TypeScript GCB1 CI passed; native CI #44655586452 remains in progress. PR #224 had a separate macOS XCTest `invalidExpiry` failure after pinned GGUF inference. A test-only whole-second frozen-clock correction was committed at `8154cbb0d005a7560adf1ec6e443aeee95221c60`; new [native CI #44656042729](https://github.com/macksteward59-lgtm/pocket-ai-lab/actions/runs/44656042729) is in progress. Do not describe either PR as native-green until its exact current head passes.

**Next bounded acceptance:** source-reviewed reconciliation of the current native runtime/East branches, live provider-backed agent task evidence, safe tool approval, durable task/memory/evidence linkage, and the physical iPhone Air user journey. No master requirement is newly marked verified by this limited fixture/host work.

## 2026-11-20 owner clarification — one product and one connected scope

**Authoritative clarification:** The owner's AI companion, **AI Integrator & Automator** concepts, permanent/dynamic multi-agent intelligence, six-layer/42-module security capabilities, temporal intelligence, cloud/distributed computing, research and bug-bounty division, original learning/problem-solving ideas, G.I.R.L./Neuralese/MSIR, and self-evaluation/improvement are **not separate competing applications or a menu of optional products**. They are intended capabilities and research directions of **one Pocket AI Lab system** sharing one user experience, trust model, execution lifecycle, knowledge/evidence plane, and model-independent runtime. Their integration is an end-to-end acceptance obligation, not an excuse to multiply disconnected prototypes.

This statement **does not mean** every historical prototype's files are already inside the repository or may be imported unreviewed. Migrate valuable implementations through source/donor review, tests, security boundaries, and the normal feature-branch/PR process. Preserve their intent without copying obsolete integrations, unauthorized cloud access, unvalidated models, or duplicate orchestrators.

### Unified functional ownership map

| Earlier conversation/workstream | Its place in Pocket AI Lab | Shared integration obligation |
|---|---|---|
| AI companion and AI Integrator & Automator | Native conversation, governed automation, tool adapters, self-managed AI task list **separate from the user's task list**, optional connectors/cloud workers | One task identity, user controls, policy approval, East durable operations, evidence and recoverable results; no parallel ungoverned automation engine |
| Director/APEX, six layers/M01–M42, agent team, dynamic specialists | One planner/policy-controlled delegation system with role-scoped skills | Selection ≠ authorization; T0–T4 controls; no autonomous permission or bypass via a module name |
| East/e3, Temporal Intelligence Engine, scheduling/simulation | Shared durable execution and chronological task engine | Wall/monotonic/computational/simulated time distinguished; checkpoints, cancellations, worker fencing, reauthorization after resume; simulations never become asserted real events |
| Native Pocket AI Lab / LlamaEngine / RuntimeController / BridgeGate / Workspace / Grok | One native iOS-first interface and model/runtime abstraction | Genuine on-device generation, readiness evidence, automatic/manual routing, actual model attribution, approved optional remote providers, exact session lifecycle |
| Memory, knowledge, learning, self-improvement | Working, episodic, semantic and procedural memory; evaluation-driven routing and procedural improvements | Provenance, encrypted persistence, verified vs proposed changes, rollback, no self-modifying permissions or model weights without explicit separate authorization |
| Security Analyst, ExploitGym, authorized vulnerability research | First-class specialty in the same agent system: source intelligence, scoped research, hypotheses, isolated experiments, independent validation, responsible reports | Approved program scope, policy version, human-controlled external/state-changing tests, sandboxed execution, repeatable evidence, no unapproved submission |
| G.I.R.L., Neuralese, GIE1/GCB1, Minimal Surface Information Representation | Experimental machine-native representation and communication adapter for the **same** agents and models | Model/codebook identity, recipient capability negotiation, authoritative route decisions, same-model proof first, text fallback, end-to-end task-quality measurements; no assumed cross-model latent semantics |
| Original string-theory/multidimensional comprehension, mind mapping, different perspectives and reasoning methods | Candidate **reasoning, education, and representation** methods in the Reasoner/Learning/Deliberation capability; historical conceptual inspiration, not established physics or guaranteed NLP effectiveness | Explicitly version any executable method, state hypotheses/limits, test learning/task outcomes against baselines, preserve user choice and independent criticism; do not fabricate original definitions |
| Private/edge/cloud compute, AWS/Google Cloud concepts, Cursor/GitHub collaboration | Provider-neutral, policy-approved execution adapters and developer coordination for the same system | Offline-first iPhone operation, cost/privacy/network/resource checks, secure authentication, worker provenance and task continuity; optional provider is not a mandatory product dependency |

The owner's separate dual-node workstation hardware project is **not automatically merged** as source code or a mandatory dependency; it may serve as an explicitly reviewed, authorized **compute provider** to this same Pocket AI Lab product. Personal matters unrelated to AI or engineering are not automatically development requirements.

### One executable product journey, not nine parallel demonstrations

1. User asks once in the native Pocket AI Lab conversation and selects Automatic or an exact available model; Director creates a traceable objective and identifies policy and privacy constraints.
2. Director chooses permanent agents, creates any needed temporary specialists, and selects relevant M01–M42 capabilities through the existing authorization gate. Actual local/private/remote model calls produce attributable independent agent attempts.
3. The message bus carries bounded control messages; optional G.I.R.L. carries separately authorized and negotiated representation blobs when supported. Otherwise use ordinary text without misrepresenting it as latent interoperation.
4. East/e3 owns durable task transitions, retries, cancellation, checkpoints, temporal ordering, delegated tool calls and recovery. AI-owned task planning and the user's task list remain distinguishable.
5. Research, engineering, learning, security and simulation use the **same** memory, source provenance, evaluation, artifact, and evidence interfaces; permissions are checked per consequential action.
6. Critic/Validator independently check quality, constraints, evidence and unexpected outcomes; Director synthesizes without converting consensus, simulation, generated text or codec parity into proof.
7. The user sees task/model/agent attribution, approvals, progress, failures/fallback, saved results and memory controls in the one app. Physical iPhone Air offline generation, restart, privacy, thermal/battery/resource and end-to-end workflow tests remain required.

**Accounting:** Continue using the existing master checklist and its 344-entry requirement ledger; this clarification is a **cross-cutting integration rule**, not 344 newly invented tasks or verification statuses. Where earlier requirement text lacks the exact name “AI Integrator & Automator” or the optional historical reasoning methods, map them to existing automation, task ownership, tool, deliberation, learning and evaluation requirements. Add stable new requirement IDs only when an acceptance obligation is genuinely absent. Retain unresolved historical source definitions as unresolved; do not guess.

**Engineering priority:** First prove one native user-visible, provider-backed, authorized, recoverable multi-agent task with genuine local inference and evidence; then extend that same production path to temporal processing, security workflows, memory and optional G.I.R.L. recipient consumption. Per-component CI passing is necessary but not evidence of that whole-product result.

## 2026-11-19–20 update — G.I.R.L. and unified product acceptance

The owner confirmed **G.I.R.L. = Geometric Intelligence Representation Layer** as a historical, experimental geometric/latent agent-communication direction. It now has explicit integration, compatibility, quality, security, user-interface, and device acceptance requirements in [G.I.R.L. Integration and End-to-End POC Gates](GIRL_GEOMETRIC_LATENT_INTEGRATION_2026-11-19.md). G.I.R.L. complements existing AgentProtocol/MessageBus, GIE1/GCB1, Director/APEX, East/e3, native inference, memory and Evidence; it does **not** replace them or establish cross-model latent alignment.

The canonical checklist now contains **343 unchecked requirements**. The traceability ledger contains **344 records**: the original 316 rows plus 28 previously untracked historical, security, and G.I.R.L. requirements. One of the 344 entries (PAL-05-001) is a separately retained original module-inventory recovery item, rather than a checkbox. The 316-row count refers only to the November 16 **historical snapshot**. No new requirement has been marked verified merely because it is now indexed.

The immediate functional gate is native GIE1 same-model cross-runtime parity (PR #224) followed by real recipient consumption, bounded provider-backed agent communication, documented text fallback, durable authorization/task evidence and physical iPhone testing. Hosted codec CI alone is not a product demonstration.

## 1. Product vision

Pocket AI Lab is intended to be a unified, personal, offline-first AI environment—not merely a chatbot, model launcher, web wrapper, or collection of disconnected agents.

The native iOS application is the primary product interface. It should bring together local model inference, a model-independent agent team, dynamic specialist creation, research and knowledge, persistent memory, durable task execution, governed tool use, evaluation, evidence, and understandable operational controls.

The system is hybrid in structure:
- **Permanent agents** provide stable roles and continuity.
- **Dynamic specialists** are instantiated for specific tasks and released when no longer needed.
- **Automatic collaboration** coordinates agents through bounded, typed messages, independent analysis, critique, revision, validation, and synthesis.
- **Offline-first execution** keeps eligible conversations, local models, memory, and local workflows usable without a network.
- **Optional network services** extend research or inference only when configured and authorized. Network availability must not silently become a requirement for local operation.
- **Model independence** prevents the architecture, agent identities, memory, policy, and workflow state from being tied to one model vendor.

The product must distinguish intelligence from authority: models and agents reason and propose; governance components decide whether actions may execute; execution systems perform authorized work; independent verification determines what actually happened.

## 2. Non-negotiable product decisions

1. Native iOS is the primary user experience. Web/PWA functionality is supplementary and must not be represented as native capability.
2. Offline-first is an architectural requirement, not a marketing label. Local inference, local memory, and eligible local workflows must have explicit offline acceptance tests.
3. Network and remote inference are optional, policy-controlled extensions.
4. The model picker supports **Automatic** and explicit manual selection. Automatic may select only a genuinely available and permitted provider. Manual selection must not silently substitute another model.
5. The UI must identify the actual responding model/provider and whether inference occurred locally or remotely.
6. Model output, agent consensus, retrieved documents, tool output, and pasted text are untrusted inputs. None is permission, approval, proof of execution, or an authorization receipt.
7. Preserve existing subsystem responsibilities and contracts. Integrate them; do not replace them with a simplified single-agent shortcut.
8. Every important state must be observable without exposing secrets. Planned, stubbed, implemented, tested, integrated, hosted-validated, and physically accepted are different states.
9. No agent self-approval, self-escalation, or unilateral final merge. The repository owner retains owner-consent decisions and final product authority.
10. Keep the separate dual-node Ryzen/Snapdragon/Linux workstation concept outside this product boundary unless it is deliberately authorized later as an external compute provider. It is not an assumed Pocket AI Lab dependency.
11. The iPhone's total RAM is not model-available RAM. The previously discussed roughly 12 GB-class mobile operating target is a budget to measure against, not an assumption about available memory.
12. Never claim physical iPhone Air acceptance from simulator, hosted macOS, CI, or code inspection.

## 3. User experience and operating modes

### 3.1 Five modes

- **Collaborative:** technical partner; independent reasoning, debate, challenge, revision, and an agreed recommendation where evidence supports one. Preserve disagreement when it cannot be resolved.
- **Security Analyst:** threat modeling, attack surfaces, vulnerabilities, defensive controls, abuse cases, and risk.
- **Engineering:** architecture, implementation, debugging, testing, and maintenance.
- **Learning:** guided explanations, examples, hints, practice, and checks for understanding.
- **Independent Review:** independent criticism, counterarguments, verification, and evidence-based conclusions.

Mode selection changes agent selection, modules, task planning, tool eligibility, review requirements, and output style. A mode is not a permission grant and cannot weaken policy.

### 3.2 Unified app experience

The app should provide:
- One primary conversation surface with streaming and conversation continuity.
- Automatic/manual model selection and honest local/remote attribution.
- Agent Team visibility: participating agents, role, model/provider, task assignments, messages, dependencies, status, and evidence.
- Task lifecycle controls: create, pause, resume, cancel, retry when safe, inspect, and recover.
- Approval/review queues for gated actions.
- Model catalog, runtime readiness, network, storage, memory, and resource status.
- Memory inspection, correction, provenance, export, retention, and deletion controls.
- Clear unavailable, offline, degraded, queued, running, waiting-for-approval, paused, interrupted, failed, cancelled, and completed states.
- Accessible native behavior: VoiceOver, Dynamic Type, keyboard support, and status announcements.
- User-configurable notifications for completion, failure, interruption, and approval requests.

The app must not show a model as usable merely because it appears in a list or a model file exists. A usable local model requires a real runtime session, verified artifact identity, readiness, and successful generation through the production inference path.

## 4. Agent system and collective intelligence

### 4.1 Permanent core agents

The stable core team consists of:
1. **Director** — task coordination, delegation, policy-aware synthesis; no self-granted authority.
2. **Reasoner** — decomposition, logic, assumptions, structured problem solving.
3. **Researcher** — source discovery, retrieval, provenance, comparison, synthesis.
4. **Engineer** — architecture, code, debugging, testing, maintenance.
5. **Security Analyst** — threat modeling, vulnerability analysis, defensive review.
6. **Critic** — challenges assumptions, finds omissions, tests counterarguments.
7. **Validator** — independent verification against criteria and evidence.
8. **Archivist** — project continuity, memory, provenance, and knowledge organization.

These are logical agent roles, not a requirement to keep eight separate models resident. Model allocation must follow measured device budgets.

### 4.2 Dynamic specialist agents

Create task-specific specialists when needed, including Python, Swift/iOS, frontend/backend, database, networking, cryptography, cloud, performance, mathematics, documentation, ML, reverse engineering, and authorized security research.

Every specialist needs a stable identity, purpose, scoped instructions, eligible model/provider, explicit capability metadata, resource budget, context boundary, lifecycle state, and audit trail. Required lifecycle: register, instantiate, activate, suspend, resume, evaluate, retire. Temporary leases and resources must be released on completion or retirement.

Capability labels are routing metadata only. They are not executable permissions. A specialist must not inherit another agent's permissions, secrets, or unrelated context.

### 4.3 Collaboration behavior

The intended collaboration is real provider-backed inference, not multiple labels around one model response. The standard deliberation pattern is:

1. Director decomposes the objective and identifies constraints.
2. Relevant agents independently analyze scoped task context.
3. Agents exchange typed, linked messages and evidence references.
4. Critic and specialist peers challenge assumptions and identify gaps.
5. Responsible agents revise or explicitly defend their positions.
6. Validator checks claims against tests, source evidence, and acceptance criteria.
7. Director synthesizes results, preserves unresolved disagreement, and proposes next actions.

Bound rounds, tokens, context, latency, tool calls, memory, concurrency, and total resource use. Handle timeout, refusal, malformed output, provider failure, and disagreement honestly. Majority vote is not truth. Do not report collaboration if the system did not execute distinct agent invocations.

### 4.4 Message bus and deliberation

Use typed, validated, immutable message envelopes with stable message IDs, sender/recipient, task ID, timestamp, content type, bounded payload, trust classification, and evidence references. Provide correlation and parent/child links, deduplication, ordering rules, cancellation propagation, and audit events. Message transport must not become an authorization channel.

## 5. Original six-layer / 42-module framework

The six layer names are recovered from the owner's original November 1, 2026 ChatGPT discussion. This is the original security capability framework, not a newly designed taxonomy and not a requirement for 42 separate agents.

### 5.1 Canonical layer names

1. **Layer 1 — Reconnaissance and Intelligence**
2. **Layer 2 — Threat Modeling and Risk Assessment**
3. **Layer 3 — Penetration Testing and Analysis**
4. **Layer 4 — Infrastructure and Application Security**
5. **Layer 5 — Detection and Response**
6. **Layer 6 — Engineering and Continuous Improvement**

### 5.2 Original governance and module-selection rules

- One central **Director** selects the relevant modules for a task; agents do not independently activate arbitrary modules.
- The separate **Authorization Engine** controls whether a selected module may actually be invoked. Selection is not authorization.
- Restricted skills remain unexecuted unless explicitly authorized by the applicable policy and approval path.
- **Critic** and **Validator** provide independent advisory assessments. Neither can authorize testing or override the Authorization Engine.
- Changes to a local stand-in or protected local implementation require explicit human approval.
- A change in scope or material alteration to an approved operation requires a new approval; approval does not automatically transfer to the changed operation.
- Agent consensus, model output, a module's presence in the registry, and a successful dry run do not grant permission.

### 5.3 Original tiered execution model

The original discussion identifies five tiers:

| Tier | Original label | Required interpretation |
|---|---|---|
| T0 | Observe | Observation only; no modification or active test is implied |
| T1 | Assess | Analysis and assessment; no modification is implied |
| T2 | Modify | Modification-capable work; requires the applicable authorization boundary |
| T3 | High-impact | High-impact operations; explicit elevated authorization and human approval are required |
| T4 | Prohibited | Prohibited operations; do not execute |

These are the recovered tier labels and governing distinctions. The exact per-module tier assignments, approval matrix, and detailed action definitions must be taken from the original registry/source conversation when recovered; do not infer them from module names.

### 5.4 Recovered original M01–M42 capability inventory

The original 42-module inventory has now been recovered from the owner's October 29, 2026 conversation. The table below preserves the recovered IDs and names in their original order. These are **capability modules**, not 42 mandatory permanent agents.

| ID | Original module name |
|---|---|
| M01 | Network Security |
| M02 | Penetration Testing |
| M03 | Vulnerability Assessment |
| M04 | Web Application Security |
| M05 | Operating System Security |
| M06 | Database Security |
| M07 | Firewall Management |
| M08 | Intrusion Detection Systems |
| M09 | Identity and Access Management |
| M10 | Security Information and Event Management (SIEM) |
| M11 | Secure Coding Practices |
| M12 | Security Auditing |
| M13 | Threat Modeling |
| M14 | Incident Response |
| M15 | Reverse Engineering |
| M16 | Digital Forensics |
| M17 | Advanced Malware Analysis |
| M18 | Threat Hunting |
| M19 | Cloud Security |
| M20 | Incident Response Automation |
| M21 | Cyber Threat Intelligence |
| M22 | IoT Security |
| M23 | DevSecOps |
| M24 | Cybersecurity Consulting |
| M25 | Social Engineering |
| M26 | Cryptography |
| M27 | Cybersecurity Research |
| M28 | Cybersecurity Education and Training |
| M29 | Cybersecurity Policy and Governance |
| M30 | AI and Machine Learning in Cybersecurity |
| M31 | Quantum Computing in Cybersecurity |
| M32 | Biometric Security |
| M33 | Blockchain Security |
| M34 | Cybersecurity Law and Ethics |
| M35 | Threat Intelligence Automation |
| M36 | Predictive Analytics for Cybersecurity |
| M37 | Cyber Physical Systems Security |
| M38 | Cloud Infrastructure Security |
| M39 | Red Team Operations |
| M40 | Blue Team Operations |
| M41 | Cybersecurity Risk Management |
| M42 | Secure Software Development Lifecycle (SSDLC) |

**Recovery precision:** the original module names and numbering are recovered. A prior assistant response in the October 29 conversation reportedly supplied one-sentence, original-style descriptions for M01–M42, but the exact text of that response was not returned by the current conversation-history retrieval. The available dossier summary does not contain the full original descriptions, subskills, functions, or inputs/outputs. Therefore this handoff does not reconstruct or fabricate them. The six canonical layer titles are preserved from the earlier November 1 discussion, but the exact M01–M42-to-six-layer mapping, per-module T0–T4 assignments, permission classes, action definitions, restrictions, and approval matrix were not present in the retrieved history. Do not infer those values from names or the four conceptual groups below.

### 5.5 Recovered four conceptual integration groups

The earlier dossier grouped the capabilities conceptually as follows. These groupings are preserved as a second organizational view; they are **not** substitutes for the canonical six-layer architecture or a definitive per-module mapping.

1. **Technical foundations:** Programming, Networks, Operating systems, Databases, Cryptography.
2. **Security analysis:** Vulnerability assessment, Threat modeling, Application security, Reverse engineering, Forensics.
3. **Operational capabilities:** Red team, Blue team, SIEM, Threat hunting, Incident response, Cloud defense.
4. **Advanced integration:** AI/ML, Automation, Intelligence, Risk governance, Quantum-resistant security, Cyber-physical resilience.

### 5.6 Registry implementation requirements and unresolved source recovery

- Preserve M01–M42 IDs and names exactly as listed; never silently renumber or merge similarly named capabilities.
- Keep the four conceptual groups and six canonical layers as distinct taxonomies until the original six-layer assignment table is recovered.
- Recover each original module description verbatim from the October 29 conversation where available. Mark missing description text as unrecovered rather than filling it with generated prose.
- Recover the November 1 per-layer assignment, tier/permission matrix, and detailed action definitions before assigning those values to individual modules.
- After source recovery, add implementation metadata separately: inputs, outputs, dependencies, permission class, execution tier, resource budget, owner, version, lifecycle, tests, and implementation mapping.
- Map modules to the five operating modes without allowing a mode to weaken authorization.
- A prior conversation referenced **“Director and the 42 checks”** at `src/lib/compliance/director.ts`. This remains a repository-history retrieval lead, not proof that the path exists on the current coordination branch; it was not found at that path on `agent-coordination` when checked.


## 6. Architecture and subsystem ownership

The existing architecture is a coordinated system of distinct authorities and responsibilities:

| Subsystem | Responsibility to preserve | Integration rule |
|---|---|---|
| Director / APEX | Governance, orchestration, policy, approval and authorization decisions | Agent consensus never replaces APEX; default deny for protected actions |
| East / e3 | Durable workflow execution, persistence, dependencies, checkpoints, worker ownership and recovery | Local chat/task history is not a substitute for durable execution |
| ExploitGym | Isolated agent evaluation and controlled workloads | Keep isolated; do not auto-run exploit/benchmark workloads without explicit authorization |
| Grok Workspace | Workspace artifacts, attachments, context and historical collaboration records | Historical metadata must not be presented as live service health |
| BridgeGate.swift | Trusted-origin and message/action authorization boundary | Validate origin, frame, schema, action and request context; reject untrusted callers |
| RuntimeController.swift | Native runtime lifecycle, readiness, generation, cancellation and session checks | Must use the same app-scoped runtime/session as the Local AI UI |
| LlamaEngine.swift | Native inference abstraction and engine integration | Runtime availability must be truthful; unavailable implementation is not local inference |
| Evidence.swift | Generation/evidence responsibilities | Candidate output, execution evidence, signed receipt, and authorization remain distinct |

### 6.1 Intelligence package

The logical `packages/intelligence` domain should own reusable model-independent intelligence primitives, with clearly separated modules for:
- agents and permanent/dynamic role catalogues;
- orchestration and plan validation;
- model registry and model routing;
- message bus and typed envelopes;
- deliberation and critique/revision;
- memory and knowledge;
- evaluation and policies;
- telemetry and audit events;
- research/source provenance and evidence references.

Expected conceptual areas include `agents`, `orchestrator`, `model-registry`, `model-router`, `message-bus`, `deliberation`, `memory`, `knowledge`, `evaluation`, `policies`, and `telemetry`. Keep stable public contracts and tests. Do not move APEX authority into this package.

### 6.2 Native iOS runtime

The native runtime must remain model-independent behind `InferenceProvider` and a native inference abstraction. The iOS execution layer includes the LlamaEngine adapter and app-scoped runtime composition, model pool/leases, and inference scheduler. The same app-scoped runtime must serve Local AI and any Director/Workspace consumer; do not create a second runtime or independent ModelPool as a shortcut.

Runtime readiness must be based on the actual active session, model identity/hash, runtime state, and a real readiness probe. Disconnect or lease loss means unavailable even if the model file remains on disk. A stored model is not a loaded model; a loaded model is not proof of successful generation.

### 6.3 Model registry and routing

Maintain a registry separate from agent definitions. Record exact model identity/version, format, source, checksum, license, capabilities, context limit, quantization, hardware needs, runtime compatibility, and actual availability. GGUF is a target format in the existing native work.

Candidate model/provider names discussed include LFM2 2.6B, Gemma 4 E2B, Qwen 3.5 4B, and Grok. These are candidates, not verified integrations merely because named. Remote providers must be isolated behind adapters and require configured credentials stored in secure storage.

Automatic routing considers task capability, availability, context, memory, latency, thermal state, privacy, network state, cost, and policy. Manual selection must fail clearly if unavailable rather than silently switch. Preserve conversation context and accurate attribution when switching providers.

## 7. Runtime and WebKit security contract

The native runtime and WebKit bridge are a high-priority integration path.

### 7.1 One app-scoped runtime

- One app-lifetime runtime composition owns the NativeInferenceRuntime, ModelPool, and scheduler.
- Local AI and Workspace/Director obtain consumer leases from the same pool.
- Releasing one consumer's lease must not unload a model still leased by another.
- Unload occurs only after the final lease is released.
- Initialization failure is fail-closed; do not silently create a second runtime.
- Director/Workspace must resolve to the exact same active RuntimeSession ID as the selected Local AI session before readiness or generation.

### 7.2 Trusted WebKit dispatch

The host must derive caller origin from WebKit frame security metadata, reject subframes and foreign origins, validate strict message schemas and payload sizes, and expose only explicitly allowed actions. Page-supplied origin strings are not proof of origin.

Generation requires a host-issued, one-use challenge bound to the trusted main-frame origin, request UUID, and exact active runtime session. Consume it before inference. Reject missing, fabricated, expired, wrong-binding, and replayed challenges. Navigation invalidates outstanding challenges and cancels/drains in-flight generation. Teardown disconnects the controller and releases its lease.

The controller must revalidate active session, lease, readiness, cancellation, duplicate request state, and model artifact integrity across asynchronous suspension points. Re-hash the model after challenge consumption and immediately before inference as required by the current TOCTOU hardening. Same-size mutation with restored timestamps must still fail.

Generation results are unsigned, untrusted candidates. They must never set an `authorized` flag. Model import/load/unload and other consequential runtime controls remain denied until a separate parameter-bound, host-owned native approval coordinator is implemented and reviewed.

### 7.3 Evidence and trust

Keep these concepts separate:
- model-generated response;
- unsigned generation candidate;
- execution attempt/result;
- independently verified evidence;
- cryptographically signed evidence receipt;
- device attestation;
- APEX authorization;
- human approval.

Ed25519 trusted runtime keys, receipt signing, replay protection, device verification, and APEX authorization require separate contracts and tests. A llama.cpp process or model cannot authoritatively issue receipts. Never claim signatures, attestation, or authorization before the corresponding trusted implementation and validation exist.

## 8. East/e3 durable workflow requirements

East/e3 is the durable execution engine, not an optional task-history feature. It must provide typed workflow/task/dependency/assignment/checkpoint/retry/timeout/cancellation/completion contracts; persisted state; dependency-aware graphs; bounded concurrency; worker leases and fencing; duplicate-delivery protection; idempotency; restart recovery; and audit history.

Persist checkpoints before relinquishing work or crossing reliability boundaries. Distinguish interrupted from failed and uncertain outcomes. A side-effecting task with an uncertain outcome must not be automatically replayed. Worker identity and ownership must be checked on completion; stale/foreign owners cannot complete work. Re-check authorization, expiry, scope, and resource budgets on resume.

The current repository notes identify outstanding live PostgreSQL/RLS validation, transaction/CAS behavior, tenant isolation, outbox/recovery, and integration of durable East task state with native task UI. A deterministic fake adapter test is not live PostgreSQL evidence. Existing East compile errors must be fixed in the East-owned branch without hiding them by weakening global checks.

## 9. Memory, knowledge, research, and learning

### 9.1 Memory model

Support four distinct memory classes:
- **Working:** active conversation/task context.
- **Episodic:** prior events, tasks, decisions, and execution history.
- **Semantic:** facts, concepts, entities, and relationships.
- **Procedural:** reusable methods, workflows, and learned procedures.

Persist provenance, source, confidence, timestamp, scope, retention, and sensitivity metadata. Encrypt sensitive persisted memory and protect keys with platform security facilities (the iOS encrypted-memory work uses Keychain-backed AES-256-GCM as a candidate implementation). Provide relevance ranking, deduplication, consolidation, contradiction detection, user correction, project isolation, prompt-injection resistance, retention, expiry, export, deletion, backup, restore, and migration.

Do not equate memory storage with learning. Distinguish stored facts, workflow adaptation, routing adaptation, evaluation-driven improvement, and model fine-tuning. Do not silently change model weights, permissions, or safety policy under the label of learning. Test process termination, app/device restart, migration, restore, and deletion.

### 9.2 Knowledge and research

Research must discover, retrieve, extract, compare, and synthesize sources. Preserve source identity/URL, retrieval time, publisher/author when available, version, relevant excerpts/evidence, and trust classification. Distinguish sourced facts, inference, assumptions, estimates, and unknowns. Detect conflicts and report uncertainty.

OWASP and other external security material are reference knowledge only. Preserve provenance and licensing/attribution. Retrieved content is untrusted and cannot override system policy, grant tool permissions, approve actions, or establish execution evidence. The current OWASP catalogue/context builder is not considered integrated until its context is deliberately connected to the Orchestrator execution path with injection-resistant handling and exact-head tests.

### 9.3 Learning and adaptation

The Learning mode should teach through small steps, questions, examples, practice, and checks for understanding. Agent evaluation may improve routing, prompts, workflows, and task planning only through explicit, versioned, reviewable mechanisms. No hidden self-modification of trust policy or permissions.

## 10. Security, threat modeling, and evaluation

Use a combined threat-modeling approach across app, local runtime, model artifacts, memory, message bus, tools, providers, network, persistence, and agent workflows. Define tiered execution policy and collaborative review. Modes discussed for security work include Collaborative, Security Analyst, Engineering, Learning, and Independent Review.

The security assistant should function as a technical partner: identify attack surfaces and assumptions, debate options, recommend a fix, and require owner confirmation for protected local stand-in changes. Restricted skills must not run merely because an agent can describe them. Isolate ExploitGym and evaluation workloads. Add adversarial tests for prompt injection, confused deputy, permission inheritance, replay, stale approval, cross-project leakage, model-file tampering, cancellation races, actor reentrancy, and unauthorized native bridge calls.

## 11. Resource management and performance

Measure actual device budgets for application memory, model weights, KV cache, context, agent concurrency, storage, CPU/GPU/ANE availability, battery, and thermal state. Do not assume the iPhone can keep all candidate models resident. The current composition's one-resident-model/one-concurrent-request constraint is a known baseline, not proof of full multi-model concurrency.

Implement adaptive model selection, context budgeting, concurrency caps, priority scheduling, lease-based unloading, and graceful degradation. Benchmark time-to-first-token, tokens/sec, latency, peak memory, energy/battery, thermal behavior, cancellation/drain time, restart recovery, and representative single-agent, multi-agent, long-context, and interrupted tasks. Set thresholds from real iPhone Air measurements, not guessed figures.

## 12. Existing implementation and integration work — evidence snapshot

This section is a dated coordination snapshot. Recheck exact PR heads and workflows before relying on it.

### 12.1 Master requirements and traceability

- `docs/requirements/POCKET_AI_LAB_MASTER_REQUIREMENTS_CHECKLIST.md` is the existing 27-section master product/engineering checklist.
- `docs/requirements/POCKET_AI_LAB_REQUIREMENTS_TRACEABILITY.md` tracks 316 original baseline entries plus 28 separately identified post-baseline requirements (344 ledger entries total); the master checklist has 343 unchecked checkboxes and a separately tracked module-inventory recovery entry.
- Last recorded matrix counts: 184 unassessed, 85 implemented-unverified, 37 partial, 10 blocked, 0 verified, 0 missing. These are historical baseline counts, not a new audit result. Do not alter counts without row-level evidence.
- Recover the original M01–M42 registry; do not invent identifiers.

### 12.2 Current native runtime stack

- PR #171 owns the app-scoped NativeRuntimeComposition, shared NativeModelSessionService, ModelPool, and InferenceScheduler composition.
- PR #174 is the challenge-gated WebKit runtime dispatcher follow-on. Its description records strict frame/origin/schema/size validation, shared-session matching, one-use host challenge, generation/cancellation routing, model re-hash and TOCTOU protections, and extensive regressions. The current PR description records Intelligence CI success for its exact head; the current iOS workflow was queued with no runner allocated at the time recorded. Re-poll exact-head iOS CI.
- PR #175 owns the web Workspace bridge client and ordinary chat path. Its recorded exact-head web CI passed syntax, TypeScript build, and web tests. Agent Team remains on the server-backed task endpoint until a separate native multi-agent bridge is explicitly designed.
- PR #171/#174/#175 are stacked/related ownership slices; do not merge or rebase blindly. PR #171 owns shared runtime; #174 owns native dispatcher; #175 owns web client.
- Physical iPhone Air acceptance is outstanding. Hosted CI is not device evidence.

### 12.3 Agent team, memory, and East

- Earlier candidate work established an eight-role catalogue, bounded native role plans, task-scoped messages, model routing metadata, shared runtime leases, and task history. Recorded limitations include sequential role execution, one resident model/one concurrent request, and local task history not being durable East execution.
- Encrypted native-memory work has a hosted test history, but full memory acceptance still requires integrated retrieval, provenance, correction, isolation, deletion/export, migration, restore, and device restart testing.
- East lifecycle work includes worker ownership/fencing and uncertain side-effect outcomes. Current exact-head CI and live PostgreSQL/RLS evidence must be checked before calling it verified.
- Historical candidate PRs #153–#159 and follow-ons remain subject to current head/status review; do not assume an open PR is merged or a historical passing run applies to its latest head.

### 12.4 OWASP knowledge and CI

- PR #181 is the refreshed OWASP security reference catalogue/context-builder branch. Its description explicitly says the context builder is not yet wired to `Orchestrator.executeTask()`; exact-head validation is pending.
- PR #180 proposes focused intelligence TypeScript validation. Its exact-head CI must be checked; a passing run from a prior branch head does not validate the refreshed PR.
- Earlier broad TypeScript build work exposed pre-existing East compile errors (`@elaraai/e3` export and `BlockBuilder.$0`). Do not conceal those errors by treating a focused intelligence build as a full repository build.
- OWASP content remains untrusted reference-only data. No APEX, East, native runtime, or authorization behavior is changed by a knowledge catalogue alone.

### 12.5 Coordination protocol

The repository's `coordination/LEADERSHIP.md`, `PROTOCOL.md`, `BOARD.md`, and append-only `LOG.md` govern collaboration. ChatGPT is the primary project lead as directed by the owner. Other agents must announce identity, authorization, exact scope/files, branch, dependencies, exclusions, and validation plan before implementation. The board is the ownership source of truth. The coordination branch is documentation-only. No overlapping edits, no force pushes, no agent self-approval, and no unsupported success claims.

## 13. Required integration contracts

Before merging implementation slices, verify these contracts end-to-end:

1. **UI → native runtime:** actual Local AI selected model, app-scoped runtime, lease identity, exact RuntimeSession, readiness, generation, cancellation, and honest status.
2. **Workspace → native dispatcher:** trusted main-frame origin, strict schema, one-use challenge, exact request/session binding, navigation invalidation, cancellation drain, teardown.
3. **Agent Team → inference:** each role invocation resolves an available provider through InferenceProvider/model router and records actual provider/model identity.
4. **Agent Team → East:** volatile UI history is not execution state; durable tasks, checkpoints, leases, recovery, and uncertainty are authoritative.
5. **Agent Team → APEX:** proposals are evaluated by policy; approvals are exact-scope and human/authority-controlled; no self-approval.
6. **Agent messages → memory/knowledge:** provenance and trust labels survive retrieval; untrusted instructions cannot alter policy.
7. **Generation → evidence:** unsigned output is a candidate; verification and signing are separate trusted steps.
8. **Resource scheduler → model pool:** measured limits and consumer leases prevent accidental unload or overcommit.
9. **Remote provider → privacy/security:** remote use is explicit, secrets are secure, and network loss does not break eligible local workflows.
10. **UI → observability:** every state shown is backed by runtime/task/evidence state, not a mock or optimistic label.

## 14. Acceptance gates

A capability is not complete until the relevant gates pass:

- **G0 — Requirements:** exact requirement IDs, owner, scope, dependencies, implementation path, and acceptance criteria.
- **G1 — Unit/contract tests:** deterministic positive and negative tests for contracts and failure paths.
- **G2 — Integration tests:** real components wired together; no mock-only claim for production behavior.
- **G3 — Security review:** threat model, trust boundaries, replay/injection/permission tests, and independent review for APEX/native bridge changes.
- **G4 — Exact-head CI:** required workflows pass on the exact current commit SHA. Stale runs do not count.
- **G5 — Hosted runtime/simulator:** engine build, app build, XCTest, simulator, and pinned model smoke where applicable. This is not device acceptance.
- **G6 — Physical iPhone Air:** install exact build; verify model artifact, load, actual token generation, cancellation/drain, unload/lease behavior, offline operation, background/foreground, app/device restart, memory/thermal/battery behavior, and recovery.
- **G7 — Evidence and owner acceptance:** record device model/iOS version/build identity/model hash/runtime version/test case results and evidence; obtain required owner approval. Signed receipt/device attestation are separate gates if claimed.

## 15. Priority execution roadmap

### P0 — Establish truthful end-to-end native generation
1. Reconcile PR #171 shared runtime, PR #174 native dispatcher, and PR #175 web client on exact heads.
2. Confirm every consumer uses the same app-scoped runtime and exact session lease.
3. Finish current-head iOS workflow and native tests; resolve queued/failed steps without weakening security.
4. Verify trusted origin, challenge issuance/consumption, replay rejection, session binding, model re-hash, cancellation, navigation, and teardown.
5. Install on the physical iPhone Air and prove local model load and real generation. Do not label local inference available before this.
6. Keep Agent Team native exposure separate until its own bounded bridge and approval contract is ready.

### P0 — Reconcile requirements and original module registry
1. Preserve the original 316-row snapshot and 28 explicit addenda (344 tracked entries), maintaining honest per-row statuses until requirement-specific re-audit.
2. Recover authoritative original M01–M42 source and map exact IDs to six layers.
3. Map every requirement to code, tests, PR, CI, device evidence, and owner.
4. Resolve duplicate/stale coordination claims and current branch ownership without overwriting collaborators.

### P1 — Complete durable orchestration
1. Validate East worker ownership, fencing, cancellation, checkpointing, and uncertain side-effect recovery.
2. Add ephemeral/live PostgreSQL integration for transaction/CAS and tenant/RLS behavior.
3. Connect native Agent Team task UI to durable East task lifecycle.
4. Ensure no uncertain side-effecting task is automatically replayed.

### P1 — Complete real agent collaboration
1. Integrate permanent core catalogue and dynamic specialist lifecycle.
2. Connect actual model registry/router/provider execution to every role.
3. Implement message bus, scoped context, independent analysis, critique, revision, validation, and synthesis.
4. Preserve sequential operation if that is the measured safe device design; do not claim parallel collaboration unless implemented and tested.
5. Add end-to-end multi-role tasks with distinct provider-backed invocations and independently checkable outcomes.

### P1 — Memory, knowledge, and research
1. Complete encrypted memory integration with all four memory classes and lifecycle controls.
2. Connect OWASP/provenance-backed knowledge context to the Orchestrator only through explicit, tested, injection-resistant integration.
3. Add source conflict, trust, correction, retention, export/delete, and project isolation tests.

### P1 — Device resource/performance acceptance
1. Measure real iPhone Air memory and thermal limits.
2. Tune one-model/multi-role scheduling, context budgets, and model unload.
3. Establish target thresholds for TTFT, tokens/sec, battery, sustained generation, and recovery.

### P2 — Governed autonomy and evidence
1. Complete APEX policy integration and exact-scope approval flows.
2. Independently validate evidence candidate, signer, key management, revocation, replay defense, and receipts.
3. Add device attestation only as a separate, validated capability.
4. Preserve ExploitGym isolation and require explicit authorization for workloads.
5. Add optional remote-provider integration without weakening offline-first behavior.

## 16. Work ownership and anti-overlap rules

- `agent-coordination`: documentation and synchronization only.
- ChatGPT: primary project lead; owns integration planning, evidence reconciliation, and explicitly claimed `codex/*` work.
- Other AI agents: inactive until announced and accepted; use their own feature branches and exact file claims.
- One owner per file/interface slice. Stacked PRs must state their exact base and dependencies.
- Before starting work: fetch latest coordination branch, read Leadership/Protocol/Board/latest Log, inspect active claims and PR changed files, claim exact scope, push the claim, then edit implementation.
- Before declaring review-ready: exact head, changed files, tests, workflow IDs, evidence, limitations, and review request.
- Never merge a PR simply because it is green or old. Preserve owner approval and independent review.
- Keep `LOG.md` append-only. Never rewrite prior entries.

## 17. Definition of done

Pocket AI Lab is not complete when the UI looks finished, a model file is present, a CI workflow passes, or agents can produce plausible text.

The product is complete only when the native iPhone Air experience can, with evidence:
- run eligible local inference offline through the shared native runtime;
- route actual work to permanent agents and dynamic specialists;
- collaborate through real provider-backed, bounded, independently reviewable steps;
- persist and recover durable East workflows safely;
- retrieve and maintain encrypted, provenance-aware memory and knowledge;
- research with source provenance and uncertainty;
- enforce APEX policy and human approval for protected actions;
- prevent prompt injection, replay, privilege escalation, cross-project leakage, and unauthorized bridge actions;
- report actual model/runtime/task/evidence status;
- operate within measured device resource budgets;
- survive cancellation, interruption, app/device restart, and network loss;
- provide verifiable test/device evidence for every claimed capability.

## 18. Immediate handoff for the next contributor

1. Read this document, `coordination/LEADERSHIP.md`, `coordination/PROTOCOL.md`, the entire `coordination/BOARD.md`, and the latest `coordination/LOG.md`.
2. Re-poll PRs #171, #174, #175, #180, and #181 for exact current head, base, changed files, draft/open state, and exact-head CI. Also reconcile the active native Agent Team, East, memory, and APEX PR stack before assigning new work.
3. Do not touch files claimed by an active collaborator. Use the board and PR file lists to choose a non-overlapping slice.
4. Prioritize native shared-session and physical-device generation acceptance, while keeping Agent Team native dispatch separately gated.
5. Preserve the historical 316-row traceability baseline plus the 28 indexed addenda, and recover original M01–M42 detailed descriptions and six-layer/tier mappings before asserting full coverage.
6. Report what is confirmed, what is candidate implementation, what is blocked, and what has not been tested. Never convert a plan into a completion claim.

## 19. Owner decisions / source artifacts still required

- **@owner:** Provide or identify the authoritative original M01–M42 six-layer registry/source archive so exact identifiers and descriptions can be recovered.
- **@owner:** Confirm any final product trade-offs that materially change offline-first, native iOS, model-provider, or external compute boundaries. Existing decisions remain in force unless explicitly changed.
- **@owner:** Supply physical-device access/signing approval when the native iPhone Air acceptance gate is ready. No signing credentials or device access should be assumed.
- **@owner:** Review any proposed production deployment, public visibility, credential use, irreversible data operation, protected local change, or final merge requiring owner consent.

---
**Authority and status:** This document is the consolidated handoff and integration guide. The master checklist defines the full requirement set; the traceability matrix defines per-requirement status; the board defines active ownership; the append-only log defines chronological handoffs. If these records disagree, stop, record the discrepancy, and reconcile it with evidence rather than silently choosing the more optimistic claim.
