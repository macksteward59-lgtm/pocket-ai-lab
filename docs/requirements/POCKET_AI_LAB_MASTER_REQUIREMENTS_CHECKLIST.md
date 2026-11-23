# Pocket AI Lab — Master Product Requirements & Engineering Handoff Checklist

**Document type:** Authoritative product requirements / engineering handoff  
**Target branch:** `agent-coordination`  
**Status:** Requirements baseline; implementation status must be established by repository evidence  
**Product:** Pocket AI Lab  
**Primary target:** Native iOS application, initially iPhone Air (256 GB device target)  
**Architecture:** Hybrid, offline-first, model-independent, governed multi-agent intelligence platform

> **Status discipline:** All checklist items below begin unchecked. Do not mark an item complete because it is planned, described in documentation, represented by a UI, stubbed, mocked, or passes an unrelated CI workflow. Mark it complete only when its stated acceptance evidence exists. Use `[~]` for in progress and `[x]` only for verified completion. Link PRs, commits, test runs, device evidence, and threat-model records.

> **Companion handoff:** See [Complete Product Vision & Engineering Handoff](../../coordination/POCKET_AI_LAB_COMPLETE_PRODUCT_HANDOFF_2026-11-17.md) for the consolidated architecture, integration contracts, evidence snapshot, roadmap, and next-contributor instructions. This checklist remains the detailed requirement baseline; the traceability matrix remains the per-requirement status ledger.

## 0. Product definition and non-negotiable principles

- [ ] Deliver one coherent personal AI environment, not merely a chatbot, model launcher, or disconnected collection of agents.
- [ ] Make the native iOS app the primary user interface; a web/PWA interface must not be represented as a substitute for native functionality.
- [ ] Operate offline-first: core local conversations, local models, local memory, and eligible local workflows remain useful without network access.
- [ ] Treat network access and remote compute as optional, explicitly authorized extensions.
- [ ] Keep the architecture model-independent: agents, governance, memory, and workflows must not depend on one model vendor.
- [ ] Preserve the existing Director/APEX, East/e3, ExploitGym, Grok Workspace, BridgeGate, RuntimeController, LlamaEngine, and Evidence responsibilities and trust boundaries.
- [ ] Separate intelligence from authority: models and agents propose and reason; policy and authorization components decide what may execute.
- [ ] Preserve user control over consequential actions, external access, sensitive data, and changes to local or remote systems.
- [ ] Make every important system state observable and explainable without exposing secrets.
- [ ] Distinguish designed, implemented, tested, integrated, and physically verified capabilities in all status reports.
- [ ] Do not silently merge the separate dual-node Ryzen/Snapdragon/Linux workstation project into Pocket AI Lab. It may become an explicitly authorized external compute provider later.
- [ ] Treat the 12 GB-class memory operating target discussed for constrained mobile execution as a resource budget to benchmark, not as a claim that all device RAM is available to models.

## 1. Product modes and user experience

### 1.1 Operating modes
- [ ] Collaborative mode: technical partner, independent analysis, debate, challenge, revision, and agreed recommendation.
- [ ] Security Analyst mode: threat analysis, attack surfaces, vulnerabilities, controls, and risk.
- [ ] Engineering mode: architecture, implementation, debugging, testing, and maintenance.
- [ ] Learning mode: explanations, guided learning, examples, and checks for understanding.
- [ ] Independent Review mode: independent examination, criticism, counterarguments, and evidence-based conclusions.
- [ ] Make mode selection affect agent selection, available modules, tool permissions, review requirements, and output format.
- [ ] Ensure mode selection never grants authority that the policy layer has not granted.

### 1.2 Unified interface
- [ ] Provide one primary conversation interface with streaming responses.
- [ ] Provide Automatic and explicit manual model selection.
- [ ] Show the actual responding model/provider and whether inference was local or remote.
- [ ] Preserve conversation context when switching models without falsely attributing earlier messages to the new model.
- [ ] Show agent participation, task state, progress, dependencies, and completion evidence.
- [ ] Provide approval/review queues for gated actions.
- [ ] Provide model, runtime, network, storage, and resource status.
- [ ] Provide memory inspection, correction, export, and deletion controls.
- [ ] Provide task history, cancellation, retry, pause, resume, and recovery controls.
- [ ] Provide accessible layouts, VoiceOver support, dynamic type, keyboard support, and clear status announcements.
- [ ] Provide user-configurable notifications for completion, failure, interruption, and approval requests.
- [ ] Clearly distinguish unavailable, degraded, offline, paused, queued, running, failed, and completed states.

## Original six-layer security capability framework

The canonical six layer names recovered from the owner's November 1, 2026 conversation are:
1. Reconnaissance and Intelligence
2. Threat Modeling and Risk Assessment
3. Penetration Testing and Analysis
4. Infrastructure and Application Security
5. Detection and Response
6. Engineering and Continuous Improvement

Governance: one central Director selects modules; the separate Authorization Engine controls invocation; restricted skills remain unexecuted absent authorization; Critic and Validator are advisory, not authorizers; local stand-in changes require explicit human approval; materially changed operations require new approval.

Original execution tiers: T0 Observe; T1 Assess; T2 Modify; T3 High-impact; T4 Prohibited. Do not infer individual module tier assignments from names.

The original M01–M42 names and numbering have now been recovered from the October 29, 2026 conversation. They are capability modules, not 42 mandatory permanent agents. The exact six-layer assignment table and complete verbatim descriptions remain unrecovered; do not infer either from module names or the separate four-group taxonomy.

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

Earlier four-group conceptual view (distinct from the six canonical layers):
1. Technical foundations: Programming, Networks, Operating systems, Databases, Cryptography.
2. Security analysis: Vulnerability assessment, Threat modeling, Application security, Reverse engineering, Forensics.
3. Operational capabilities: Red team, Blue team, SIEM, Threat hunting, Incident response, Cloud defense.
4. Advanced integration: AI/ML, Automation, Intelligence, Risk governance, Quantum-resistant security, Cyber-physical resilience.

- [ ] Recover and preserve each original module description verbatim where available; mark any unavailable description as unrecovered.
- [ ] Recover the original M01–M42-to-six-layer mapping and per-module T0–T4/permission matrix from the November 1 source; do not infer assignments.
- [ ] Keep the four conceptual groups separate from the canonical six-layer taxonomy.


## 2. Director/APEX governance and authorization

- [ ] Keep Director/APEX as the governance and orchestration authority, separate from model-generated intelligence.
- [ ] Preserve existing APEX authorization contracts and policy invariants; do not replace them with agent consensus.
- [ ] Enforce deny-by-default for consequential, external, privileged, or out-of-scope actions.
- [ ] Require exact-scope authorization for protected actions, including target, operation, environment, limits, and expiry where applicable.
- [ ] Require human approval for consequential local changes, external actions, security remediations, submissions, and other configured protected operations.
- [ ] Ensure an agent cannot approve its own action or elevate its own permissions.
- [ ] Ensure model output, agent messages, tool output, pasted text, and generated plans are never authorization receipts.
- [ ] Separate proposal, authorization, execution attempt, execution result, independent verification, and approval records.
- [ ] Make authorization revocable and enforce expiry, emergency stop, and cancellation.
- [ ] Record policy version, actor identity, capability, scope, decision, reason, and evidence reference.
- [ ] Test bypass attempts, confused-deputy paths, replay, stale approval, privilege escalation, and cross-project access.
- [ ] Preserve repair authorization as an independent decision from the failed operation.
- [ ] Ensure model/provider switching cannot silently change policy or permission.
- [ ] Keep human approval explicit and attributable; no implied consent from silence or prior unrelated approvals.

## 3. East/e3 durable workflow execution

- [ ] Use East/e3 for durable, resumable workflow execution rather than relying on volatile in-process task state.
- [ ] Define typed workflow, task, dependency, assignment, checkpoint, retry, timeout, cancellation, and completion contracts.
- [ ] Persist task state and execution history across app restarts and worker restarts.
- [ ] Support dependency-aware task graphs and bounded parallel execution.
- [ ] Support worker ownership, leases/fencing, duplicate-delivery protection, and idempotency.
- [ ] Restore task/message context accurately after interruption.
- [ ] Persist checkpoints before relinquishing work or crossing a reliability boundary.
- [ ] Distinguish queued, scheduled, running, waiting-for-approval, paused, interrupted, failed, cancelled, and completed states.
- [ ] Implement bounded retries, backoff, dead-letter/error handling, and human-readable failure diagnostics.
- [ ] Ensure workflow resumption rechecks authorization, expiry, target scope, and resource budgets.
- [ ] Verify that parent task evidence references child task and generation evidence without replacing it.
- [ ] Test crash recovery, duplicate workers, stale leases, network loss, partial completion, and replay.

## 4. Agent intelligence and coordination

### 4.1 Permanent core team
- [ ] Director: coordination, delegation, policy-aware synthesis; no self-granted authority.
- [ ] Reasoner: decomposition, logic, assumptions, and structured problem solving.
- [ ] Researcher: source discovery, retrieval, provenance, and synthesis.
- [ ] Engineer: software design, implementation, debugging, and testing.
- [ ] Security Analyst: threat modeling, vulnerability analysis, and defensive review.
- [ ] Critic: challenge assumptions, detect gaps, and test counterarguments.
- [ ] Validator: independent verification against criteria and evidence.
- [ ] Archivist: memory, project continuity, provenance, and knowledge organization.

### 4.2 Dynamic specialists
- [ ] Create specialists on demand for Python, Swift/iOS, frontend/backend, databases, networking, cryptography, cloud, performance, math, documentation, ML, reverse engineering, and authorized security research.
- [ ] Define specialist identity, role, instructions, capabilities, permissions, model eligibility, resource budget, and lifecycle.
- [ ] Support register, instantiate, activate, suspend, resume, evaluate, retire, and audit lifecycle operations.
- [ ] Release temporary model/runtime resources when a specialist completes or is retired.
- [ ] Prevent dynamic specialists from inheriting permissions merely because another agent possesses them.

### 4.3 Collaboration protocol
- [ ] Implement genuine provider-backed inference for each agent invocation; do not simulate collaboration as multiple labels over one answer.
- [ ] Give agents task-scoped context and only the data required for their assignment.
- [ ] Use typed, immutable, validated AgentMessage envelopes with stable IDs, sender/recipient, task, timestamp, content type, and evidence references.
- [ ] Implement independent analysis → cross-review → challenge → revision → validation → Director synthesis.
- [ ] Permit reasoned disagreement; never force consensus or equate majority vote with truth.
- [ ] Bound deliberation rounds, tokens, latency, memory, tool calls, and total cost.
- [ ] Record which agent/model generated each contribution and which evidence supports it.
- [ ] Handle agent failure, timeout, refusal, malformed output, and disagreement without falsely reporting success.
- [ ] Test collaboration with tasks requiring genuinely different expertise and independently checkable answers.

## 5. The six-layer / 42-module capability framework

- [ ] Recover the authoritative original M01–M42 names, descriptions, and layer assignments from the original registry, source archive, or project history.
- [ ] Do not invent or silently rename the original 42 module identifiers.
- [ ] Preserve the six-layer, 42-module structure as a capability registry, not as a claim that there must be 42 agents.
- [ ] Define for every module: stable ID, name, purpose, inputs, outputs, dependencies, permission class, execution class, resource budget, owner, version, tests, and lifecycle.
- [ ] Map modules to the five operating modes and define allowed/denied combinations.
- [ ] Identify restricted modules and ensure they remain unexecuted unless the applicable authorization policy explicitly permits them.
- [ ] Require human confirmation before protected local stand-in changes or other consequential module actions.
- [ ] Add module discovery, compatibility validation, health checks, versioning, deprecation, and rollback.
- [ ] Add tests proving a module cannot bypass its declared permissions through another agent or tool.
- [ ] Maintain a traceable mapping from every module to implementation files and acceptance tests.

## 6. Model registry, routing, and inference

The owner’s November 22 clarification adds model creation to the existing selection and routing requirements. A user can keep a working model, develop a candidate from saved weights, select a base and teacher, compare both parents with their child, and choose the result in the same conversation. The release record must identify supported artifact formats, where computation ran, parent versions, what persisted, and which outcomes passed independent evaluation. The [integrated workshop](https://github.com/macksteward59-lgtm/pocket-ai-lab/blob/ea8f168553879a029e8a225eed75d8be65efe117/docs/implementation/unified-model-workflow.md) includes direct edits to a v1 reader, two-reader blending with both parent IDs, and exact interrupted optimizer recovery for the supported local CPU recipe. Native execution and quality on new material remain separate acceptance gates.

### 6.1 Registry and provider adapters
- [ ] Maintain a model registry independent of agent definitions.
- [ ] Record model identity, version, format, source, checksum, license metadata, capabilities, context limits, quantization, hardware requirements, and availability.
- [ ] Support local model artifacts such as compatible GGUF models and the selected native runtime format(s).
- [ ] Support authorized remote providers through isolated provider adapters.
- [ ] Treat named model targets such as LFM2 2.6B, Gemma 4 E2B, Qwen 3.5 4B, and Grok as candidate integrations, not as installed or verified capabilities until tested.
- [ ] Keep credentials in platform-secure secret storage; never embed API keys in source, logs, or model prompts.
- [ ] Verify model and adapter compatibility before offering a model as selectable.

### 6.2 Routing rules
- [ ] Automatic routing must select only a provider that is actually available and permitted for the task.
- [ ] Manual selection must honor the selected model; do not silently substitute another model.
- [ ] Report unavailable models honestly.
- [ ] Route based on task capability, model availability, memory, context, latency, thermal state, privacy, network state, cost, and user policy.
- [ ] Explain routing decisions at an appropriate level without exposing secrets.
- [ ] Preserve conversation continuity when switching providers and maintain accurate provenance.
- [ ] Distinguish local inference, remote inference, cached output, mock output, and user-pasted content.
- [ ] Never label a placeholder or mocked response as real inference.

### 6.3 Native model lifecycle
- [ ] Implement import/download, integrity validation, compatibility validation, load, readiness check, generation, cancellation, unload, and removal.
- [ ] Represent states explicitly: not installed, importing, imported, validating, invalid, loading, loaded, ready, generating, unloading, unavailable, and failed.
- [ ] Treat a model file on disk as distinct from a model proven capable of generating.
- [ ] Verify file hash and model identity at load/readiness boundaries.
- [ ] Support streaming token generation and safe cancellation.
- [ ] Release memory and native resources deterministically after cancellation, failure, or unload.
- [ ] Preserve model artifacts when runtime sessions are disconnected, while reporting runtime as unavailable.
- [ ] Test corrupt artifacts, unsupported formats, low-memory conditions, interrupted loading, cancellation, and repeated load/unload.

## 7. Native iOS application and runtime

- [ ] Deliver a native iOS application as the primary product interface.
- [ ] Integrate native inference; a browser bridge or remote server alone does not satisfy local inference acceptance.
- [ ] Implement and test LlamaEngine.swift against a real supported inference backend.
- [ ] Implement ModelPool.swift for loaded model ownership, limits, and release.
- [ ] Implement InferenceScheduler.swift for concurrency, priorities, cancellation, and resource-aware scheduling.
- [ ] Preserve RuntimeController.swift lifecycle/readiness responsibilities.
- [ ] Preserve BridgeGate.swift trusted-origin and message authorization boundaries.
- [ ] Preserve Evidence.swift signed generation-evidence responsibilities.
- [ ] Restrict WebKit/native bridge messages to validated schemas, trusted origins, and authorized operations.
- [ ] Ensure native and web surfaces cannot invoke privileged actions by bypassing APEX.
- [ ] Implement secure local storage and Keychain-backed key management as appropriate.
- [ ] Handle app foreground/background transitions, suspension, termination, and restoration honestly.
- [ ] Test installation, launch, model import, real token generation, cancellation, unload, restart, offline use, and crash recovery on physical target hardware.
- [ ] Record device model, iOS version, build identity, model hash, runtime version, and test evidence for device acceptance.
- [ ] Do not treat simulator or hosted CI success as physical iPhone acceptance.

## 8. Resource governance and performance

- [ ] Establish measured budgets for app memory, model weights, KV cache, context, agent concurrency, storage, CPU, GPU/ANE where available, battery, and thermal state.
- [ ] Account for iOS/system memory overhead; do not assume device RAM is entirely available to the model.
- [ ] Implement adaptive model selection, concurrency limits, context budgeting, and model unloading.
- [ ] Avoid loading multiple large models unless measured budgets allow it.
- [ ] Schedule workloads by priority, deadlines, privacy, memory, thermal state, and expected value.
- [ ] Provide graceful degradation when resources become constrained.
- [ ] Measure time-to-first-token, tokens/second, latency, peak memory, energy/battery impact, thermal behavior, and recovery time.
- [ ] Benchmark representative single-agent, multi-agent, long-context, and interrupted workloads.
- [ ] Define performance acceptance thresholds from real measurements on target devices.

## 9. Memory, knowledge, and personalization

- [ ] Implement working memory for active task and conversation state.
- [ ] Implement episodic memory for events, prior tasks, decisions, and execution history.
- [ ] Implement semantic memory for facts, concepts, entities, and relationships.
- [ ] Implement procedural memory for reusable methods, workflows, and learned procedures.
- [ ] Encrypt persisted sensitive memory and protect encryption keys with platform security facilities.
- [ ] Store provenance, source, confidence, timestamp, scope, and retention metadata with memory records.
- [ ] Implement retrieval ranking, relevance filtering, deduplication, consolidation, and contradiction detection.
- [ ] Support user correction and ensure corrections supersede stale information according to explicit policy.
- [ ] Support project boundaries and prevent accidental cross-project or cross-user memory leakage.
- [ ] Protect memory retrieval from prompt injection and untrusted embedded instructions.
- [ ] Implement retention, expiration, export, deletion, backup, and restore.
- [ ] Distinguish stored facts, workflow adaptation, routing adaptation, evaluation-driven improvements, and model fine-tuning.
- [ ] Do not silently modify model weights, permissions, or safety policy under the label of learning.
- [ ] Test persistence through process termination, app restart, device restart, migration, and restore.

## 10. Research and information intelligence

- [ ] Provide source discovery, retrieval, extraction, comparison, and synthesis.
- [ ] Record source URL/identity, retrieval time, author/publisher where available, version, and relevant excerpts or evidence.
- [ ] Distinguish sourced facts, inference, assumptions, estimates, and unknowns.
- [ ] Detect conflicting sources and report uncertainty.
- [ ] Respect source access controls, licenses, privacy, and rate limits.
- [ ] Prevent retrieved content from becoming executable instructions or authorization.
- [ ] Preserve research trails so findings can be reproduced and independently checked.
- [ ] Support structured research plans, deliverables, and evidence-linked reports.

## 11. Software engineering and repository development

- [ ] Inspect repository structure, branch, commit, dependencies, architecture, and existing conventions before editing.
- [ ] Understand issue/PR context and identify the exact target branch and files.
- [ ] Produce a plan and task graph before substantial changes.
- [ ] Assign independent code, test, security, and review tasks to suitable agents.
- [ ] Support code generation, editing, refactoring, debugging, dependency analysis, documentation, profiling, and build/CI diagnosis.
- [ ] Use isolated worktrees/branches or equivalent safe change isolation for parallel work.
- [ ] Preserve patch provenance, agent attribution, base commit, changed paths, and test evidence.
- [ ] Run relevant formatters, linters, type checks, unit tests, integration tests, and builds.
- [ ] Require independent review and validation before proposing merge.
- [ ] Require human approval for protected repository writes, merges, releases, or external publication as configured.
- [ ] Never claim code was changed unless the repository confirms the commit or patch.
- [ ] Never claim tests passed unless the exact relevant run and commit are identified.
- [ ] Support rollback and recovery from partial or conflicting parallel changes.

## 12. Cybersecurity and threat modeling

- [ ] Maintain a distinct Security Analyst workflow for architecture and defensive security.
- [ ] Identify assets, trust boundaries, entry points, attack surfaces, threat actors, and assumptions.
- [ ] Generate and prioritize threats with likelihood, impact, exploitability, and confidence.
- [ ] Review source code, APIs, authentication, authorization, network, cloud, storage, and configuration.
- [ ] Recommend mitigations with rationale and testable acceptance criteria.
- [ ] Require authorization before applying remediations or changing protected environments.
- [ ] Track finding states such as hypothesis, observed, validated, remediated, and unverified.
- [ ] Preserve reproduction steps and evidence while minimizing sensitive data.
- [ ] Test false positives, missed findings, authorization boundaries, and remediation effectiveness.

## 13. Bug bounty research division

- [ ] Keep bug bounty research distinct from general threat modeling.
- [ ] Ingest and version program policies, scope, exclusions, rate limits, prohibited techniques, and testing windows.
- [ ] Normalize targets and maintain exact allowlists and exclusions.
- [ ] Fail closed when scope or authorization is ambiguous; mark it needs-human-review.
- [ ] Require human approval before testing ambiguous or consequential targets.
- [ ] Bind each test to the applicable program, policy version/digest, target, authorization, time window, and limits.
- [ ] Provide specialist workflows for reconnaissance, web, API, authentication, authorization, cloud, mobile, source analysis, business logic, cryptography, chaining, validation, and reporting.
- [ ] Restrict testing to explicitly authorized assets and permitted techniques.
- [ ] Implement emergency stop, rate limits, safe test boundaries, and audit logging.
- [ ] Use ExploitGym for isolated synthetic workloads, evaluation, false-positive testing, and safe exploitability experiments.
- [ ] Require independent reproduction/validation before classifying a finding as confirmed.
- [ ] Produce evidence-backed reports with impact, severity rationale, reproduction, remediation, and limitations.
- [ ] Require human review before submission to HackerOne, Bugcrowd, Intigriti, or another platform.
- [ ] Never automatically expand scope, submit findings, or perform prohibited testing.
- [ ] Test scope bypass, stale policy, exclusion matching, wildcard handling, redirects, DNS changes, and authorization expiry.

## 14. Temporal intelligence and simulation

- [ ] Implement a Temporal Clock that distinguishes wall-clock time, monotonic elapsed time, computational time, and simulated time.
- [ ] Implement a Cycle Scheduler for bounded reasoning and workflow cycles.
- [ ] Implement an Execution Ledger for chronological events and state transitions.
- [ ] Implement a Simulation Manager with isolated simulated state and explicit simulation-time semantics.
- [ ] Integrate Temporal Memory with episodic records and event provenance.
- [ ] Integrate Resource Governor with scheduling and device limits.
- [ ] Implement a Synchronization Engine for local and remote time/state reconciliation.
- [ ] Support durable checkpoints and resume after interruption.
- [ ] Preserve ordering, causality, and timestamps across agents and distributed workers.
- [ ] Prevent simulated events from being represented as real-world events.
- [ ] Revalidate authorization and resource budgets after resumption.
- [ ] Respect iOS background execution limits; never claim continuous background work unless a permitted runtime actually executes it.
- [ ] Test clock changes, timezone changes, clock skew, duplicate events, delayed workers, interrupted cycles, and simulation isolation.

## 15. Distributed and cloud compute

- [ ] Keep iPhone as primary interface and a useful local/offline execution environment.
- [ ] Define a provider-neutral external compute interface for approved edge, private server, GPU, and cloud resources.
- [ ] Treat Google Cloud as a candidate discussed integration, not a mandatory dependency until selected and provisioned.
- [ ] Allow remote inference or durable workload continuation only when user policy, network, privacy, and authorization permit it.
- [ ] Authenticate devices and services with scoped credentials and rotate/revoke credentials safely.
- [ ] Encrypt data in transit and at rest; minimize data sent off-device.
- [ ] Define workload placement, capability negotiation, resource budgets, retries, and failover.
- [ ] Preserve task identity, agent attribution, policy context, and evidence across nodes.
- [ ] Implement synchronization, conflict resolution, idempotency, disconnection recovery, and stale-worker fencing.
- [ ] Keep secrets and private memory out of remote payloads unless explicitly authorized.
- [ ] Provide cloud cost, quota, usage, and provider availability controls.
- [ ] Test offline operation, intermittent connectivity, remote outage, replay, and node compromise assumptions.
- [ ] Keep the separate dual-node workstation project outside this repository's product scope unless deliberately integrated as a separately authorized compute adapter.

## 16. Tool and capability ecosystem

- [ ] Maintain a versioned tool registry with descriptions, schemas, capabilities, dependencies, and owners.
- [ ] Require explicit capability and permission checks before tool execution.
- [ ] Validate all tool inputs and outputs against schemas.
- [ ] Apply timeouts, resource budgets, rate limits, cancellation, and idempotency where appropriate.
- [ ] Sandbox untrusted code and risky workloads.
- [ ] Record tool version, actor, arguments (redacted where sensitive), result, and evidence.
- [ ] Treat tool output as untrusted data, never as policy or authorization.
- [ ] Support tool health checks, compatibility checks, upgrades, deprecation, and rollback.
- [ ] Require human confirmation for tools that modify protected state or communicate externally where policy demands it.

## 17. Identity, privacy, and data protection

- [ ] Define user, device, project, agent, worker, and service identities.
- [ ] Enforce least privilege and project/tenant isolation.
- [ ] Separate personal, development, research, and test environments.
- [ ] Store secrets in secure platform or managed secret storage.
- [ ] Apply data minimization and explicit local-versus-remote data routing.
- [ ] Document what data leaves the device, for what purpose, and under which authorization.
- [ ] Provide retention, export, deletion, backup, and recovery policies.
- [ ] Protect logs, telemetry, prompts, artifacts, and backups from accidental secret disclosure.
- [ ] Review third-party SDKs, providers, dependencies, and data processors.
- [ ] Test unauthorized cross-project access and credential leakage.

## 18. Evidence, provenance, and auditability

- [ ] Preserve immutable execution attempts and attributable generation records.
- [ ] Bind evidence to actor, model/provider, runtime session, model artifact hash, task, policy decision, and time.
- [ ] Use trusted signing keys and verify signatures independently.
- [ ] Keep device attestation distinct from server attestation.
- [ ] Use expiring runtime/generation checks where required by the existing evidence contract.
- [ ] Ensure model/runtime components cannot mint trusted authorization receipts.
- [ ] Preserve individual generation evidence; parent task evidence references child evidence.
- [ ] Record failures and denials as first-class outcomes.
- [ ] Make evidence tamper-evident and exportable for audit.
- [ ] Define key provisioning, rotation, revocation, recovery, and trust-root management.
- [ ] Test forged evidence, replay, stale receipts, altered model files, signer compromise, and mismatched runtime sessions.

## 19. Evaluation, self-assessment, and improvement

- [ ] Evaluate outputs against explicit task objectives and acceptance criteria.
- [ ] Use independent validators for high-impact claims and code changes.
- [ ] Track factual accuracy, source quality, reasoning quality, code correctness, security findings, false positives, completion rate, and recovery.
- [ ] Evaluate agent collaboration against a single-agent baseline where meaningful.
- [ ] Track latency, token use, memory, energy, thermal impact, and cloud cost.
- [ ] Maintain regression datasets and reproducible evaluation runs.
- [ ] Record evaluator version, dataset version, model/provider, prompt/config version, and evidence.
- [ ] Allow the system to recommend improvements and test them in controlled environments.
- [ ] Do not let self-evaluation directly change permissions, policy, trusted keys, or production behavior.
- [ ] Require review and approval before promoting changes to production.
- [ ] Detect evaluation gaming, reward hacking, self-confirmation, and correlated evaluator errors.

## 20. Observability and diagnostics

- [ ] Provide structured logs, metrics, traces, and task timelines.
- [ ] Correlate user request, workflow, agent assignments, model generations, tool calls, policy decisions, and evidence.
- [ ] Redact secrets and sensitive content by default.
- [ ] Diagnose model load/generation, agent, tool, database, network, synchronization, and workflow failures.
- [ ] Show actionable error states and recovery instructions.
- [ ] Track resource pressure, queue depth, latency, retries, and provider health.
- [ ] Support exportable diagnostic bundles with privacy review and user consent.
- [ ] Ensure observability itself cannot bypass data-access policies.

## 21. Data portability, synchronization, and recovery

- [ ] Export/import conversations, projects, memories, tasks, agent definitions, and permitted artifacts in documented formats.
- [ ] Provide encrypted backup and restore.
- [ ] Support device migration and compatible schema upgrades.
- [ ] Version schemas and implement tested migrations and rollback strategy.
- [ ] Distinguish local-only data, synchronized data, and remote-only data.
- [ ] Resolve synchronization conflicts without silently discarding user changes or evidence.
- [ ] Recover from interrupted writes and corrupted indexes/databases.
- [ ] Test restore on a clean installation and verify integrity after migration.
- [ ] Provide user-visible controls for backup, sync, and deletion.

## 22. Quality assurance, release, and operations

- [ ] Replace placeholder test scripts with real test suites and meaningful failure exit codes.
- [ ] Maintain unit, contract, integration, end-to-end, security, performance, and regression tests.
- [ ] Test exact commit heads for required CI workflows.
- [ ] Test native iOS build, signing, installation, and runtime on physical hardware.
- [ ] Test offline, airplane mode, network loss, provider outage, low storage, low memory, thermal pressure, and battery constraints.
- [ ] Test long-running workflows, app termination, restart, and checkpoint resumption.
- [ ] Test accessibility, localization readiness, and UI state correctness.
- [ ] Maintain dependency scanning, license review, SBOM, secret scanning, and vulnerability response.
- [ ] Define release versioning, signed artifacts, reproducible build metadata, staged rollout, rollback, and release notes.
- [ ] Ensure documentation accurately reflects current implementation and verified gates.
- [ ] Do not equate compilation, simulator success, or hosted CI with production or physical-device acceptance.

## 23. Required architectural components and ownership map

The following components must retain clear responsibilities and documented contracts:

| Component | Required responsibility | Acceptance evidence |
|---|---|---|
| Director / APEX | Governance, orchestration, authorization boundary | Policy tests, denial tests, approval records |
| East / e3 | Durable workflow execution | Recovery, replay, fencing, persistence tests |
| ExploitGym | Isolated security evaluation | Isolation and synthetic workload tests |
| Grok Workspace | Project artifacts, attachments, context | Provenance and access-control tests |
| BridgeGate.swift | Trusted-origin/message authorization | Bridge abuse and schema validation tests |
| RuntimeController.swift | Model lifecycle/readiness | Real runtime lifecycle tests |
| LlamaEngine.swift | Native inference abstraction | Physical-device generation evidence |
| ModelPool.swift | Loaded model ownership/resource limits | Memory and unload tests |
| InferenceScheduler.swift | Scheduling and cancellation | Concurrency/resource tests |
| Evidence.swift | Signed generation/execution evidence | Signature, expiry, provenance tests |
| Intelligence AgentManager | Permanent/dynamic agent lifecycle | Lifecycle and permission tests |
| Orchestrator | Task decomposition and assignment | Multi-agent integration tests |
| Model Registry/Router | Model discovery and routing | Local/remote routing and attribution tests |
| Message Bus | Typed immutable agent communication | Contract, tamper, and replay tests |
| Deliberation | Bounded challenge/revision/validation | Disagreement and quality tests |
| Memory/Knowledge | Four-layer persistent memory | Encryption, retrieval, isolation, recovery tests |
| Temporal subsystem | Clock, cycles, ledger, simulation, resume | Determinism and interruption tests |
| Resource Governor | Device/cloud resource policy | Benchmark and pressure tests |
| Evaluation/Telemetry | Quality measurement and diagnostics | Reproducible evaluation evidence |

## 24. Implementation and acceptance gates

The owner’s November 22 call with Kay sets the prototype milestone before a hardware purchase. On one reviewed build, demonstrate sign-in, task creation, interruption and same-account recovery with one execution, denial to a different account, and independently verified evidence. CI or simulation can establish the bounded in-app milestone. Gate 12 still requires physical-device evidence. The [six-work-chat cross-reference](../../coordination/POCKET_AI_LAB_COMPLETE_PRODUCT_HANDOFF_2026-11-17.md#kay-and-pocket-ai-lab-chat-cross-reference) records the passing host-local prototype checks in [PR #298](https://github.com/macksteward59-lgtm/pocket-ai-lab/pull/298), the environments used, and the remaining native and cross-device gates.

- [ ] **Gate 0 — Baseline and audit:** repository/branch/commit inventory, architecture map, real test baseline, gaps, and dependency map.
- [ ] **Gate 0.1 — Trust-contract hardening:** immutable messages, honest consensus, authorization boundaries, evidence integrity, and fail-closed tests.
- [ ] **Gate 1 — Native local inference:** install/import/verify/load/generate/stream/cancel/unload offline on physical iPhone.
- [ ] **Gate 2 — Model registry and routing:** multiple providers, truthful Automatic/manual selection, continuity, attribution, and unavailability behavior.
- [ ] **Gate 3 — Agent team:** permanent agents plus dynamic specialists perform real independent inference and exchange typed messages.
- [ ] **Gate 4 — Deliberation:** bounded challenge/revision, disagreement handling, and independent validation.
- [ ] **Gate 5 — Persistent memory:** encrypted four-layer memory, retrieval, provenance, correction, restart persistence, and recovery.
- [ ] **Gate 6 — APEX/East integration:** durable workflows, policy enforcement, approvals, checkpoints, evidence, and recovery.
- [ ] **Gate 7 — Product UI:** native unified interface for chat, models, agents, tasks, approvals, memory, and diagnostics.
- [ ] **Gate 8 — Research and engineering:** source-backed research and repository workflows with tests and attributable patches.
- [ ] **Gate 9 — Security and bug bounty:** policy ingestion, exact scope enforcement, safe testing, independent validation, and human-reviewed reports.
- [ ] **Gate 10 — Temporal intelligence:** clock semantics, scheduling, execution ledger, simulation isolation, and durable resumption.
- [ ] **Gate 11 — Distributed compute:** authenticated, policy-aware remote execution and synchronization with offline recovery.
- [ ] **Gate 12 — Production readiness:** privacy, security, performance, accessibility, backup/restore, signing, release, and physical-device acceptance.

## 25. Definition of done

A capability is complete only when all applicable conditions are met:

- [ ] Requirements and behavior are documented.
- [ ] Implementation exists in the intended production path; no placeholder or mock is being counted as functional.
- [ ] Interfaces and data contracts are versioned and validated.
- [ ] Authorization, privacy, and failure behavior are tested.
- [ ] Unit and integration tests pass on the exact commit.
- [ ] Relevant end-to-end tests pass.
- [ ] Resource and performance behavior is measured where applicable.
- [ ] Independent review/validation is recorded.
- [ ] Physical-device evidence exists for iOS/native requirements.
- [ ] Logs, telemetry, and evidence identify the actual implementation and execution.
- [ ] Documentation and status tables match the observed state.
- [ ] Remaining limitations are explicit and have owners or follow-up issues.

## 26. Handoff instructions for the agent coordination team

1. Treat this document as the master requirements checklist, not as proof that any requirement is implemented.
2. First inspect the current branch, working tree, commit history, existing architecture docs, tests, and open pull requests.
3. Map every checklist item to existing files, tests, PRs, and evidence. Use `implemented-unverified`, `verified`, `partial`, `missing`, or `blocked` in a separate traceability matrix; do not change unchecked boxes based on assumptions.
4. Recover the original six-layer M01–M42 registry before assigning final module IDs or names.
5. Identify contradictions between this handoff and existing code/contracts. Preserve established trust invariants; propose changes explicitly rather than silently weakening them.
6. Break implementation into dependency-aware workstreams. Parallelize independent research, tests, documentation, and implementation only when shared files/contracts are coordinated.
7. Every workstream must state owner agent, prerequisites, files, deliverables, tests, resource budget, security class, and acceptance evidence.
8. Run independent Critic and Validator review for security-sensitive and cross-cutting changes.
9. Keep protected writes, merges, releases, external testing, and other consequential actions behind the existing authorization and human-approval controls.
10. Update this checklist only when evidence supports the status change. Link evidence next to the relevant item or in the traceability matrix.
11. Report blockers and unavailable capabilities honestly. Never fabricate repository changes, test runs, physical-device results, or provider availability.

## 27. Traceability matrix template

Use one row per requirement or a stable requirement group. Expand groups into individual rows before implementation begins.

| Requirement ID | Requirement | Owner | Code path | Test/evidence | Status | Blocker / issue |
|---|---|---|---|---|---|---|
| PAL-0.1 | Offline-first native product | TBD | TBD | TBD | missing | TBD |
| PAL-2.1 | APEX fail-closed authorization | TBD | TBD | TBD | missing | TBD |
| PAL-3.1 | Durable workflow recovery | TBD | TBD | TBD | missing | TBD |
| PAL-4.1 | Genuine multi-agent inference | TBD | TBD | TBD | missing | TBD |
| PAL-5.1 | Original M01–M42 registry recovered | TBD | TBD | TBD | blocked | Source registry not yet recovered |
| PAL-6.1 | Truthful model routing and attribution | TBD | TBD | TBD | missing | TBD |
| PAL-7.1 | Physical iPhone native inference | TBD | TBD | TBD | missing | Device evidence required |
| PAL-9.1 | Encrypted persistent memory | TBD | TBD | TBD | missing | Verify current implementation |
| PAL-13.1 | Bug bounty scope fail-closed | TBD | TBD | TBD | missing | Verify current implementation |
| PAL-14.1 | Temporal checkpoint/resume | TBD | TBD | TBD | missing | Verify current implementation |
| PAL-15.1 | Authorized distributed execution | TBD | TBD | TBD | missing | Provider decision and integration |
| PAL-18.1 | Signed, attributable evidence | TBD | TBD | TBD | missing | Verify trust contract |
| PAL-22.1 | Physical-device release acceptance | TBD | TBD | TBD | missing | Signing/device test evidence |

---

**Scope note:** This handoff consolidates the product requirements recovered from prior project discussions and the repository's existing architecture direction. It intentionally does not invent the original M01–M42 names, assert that historical PRs are currently merged, or claim that previously reported CI/device gates remain current. The repository audit must establish those facts against the current branch and commit.


## 19. Advanced security research and vulnerability analysis

- [ ] Provide a dedicated Security Research workflow combining the Security Analyst, Researcher, Engineer, Critic, and Validator roles.
- [ ] Support sourced research plans, artifact provenance, vulnerability hypotheses, reproducibility records, severity analysis, remediation, and responsible-disclosure reports.
- [ ] Include Operation Triangulation as a defensive historical case study for multi-stage mobile exploit-chain analysis, trust boundaries, forensic evidence, patch timelines, and mitigations; distinguish public facts from unknowns and hypotheses.
- [ ] Support bounty-program-specific planning, including Microsoft Windows Insider Preview bounty eligibility, exact build/channel scope, exclusions, safe-harbor terms, reproduction requirements, and disclosure rules.
- [ ] Require explicit structured authorization for every active target; never infer permission from a bounty listing, product name, agent consensus, or available tool.
- [ ] Keep passive research, isolated lab reproduction, and externally authorized testing as separate execution classes.
- [ ] Isolate untrusted samples and prohibit automatic execution on the user's iPhone or other production devices.
- [ ] Preserve task/attempt provenance, artifact hashes, agent/model identity, timestamps, confidence, limitations, reviewer outcome, and report versions.
- [ ] Require APEX authorization and East/e3 durable task controls for consequential testing; retain human approval for state-changing or externally interacting actions.
- [ ] Test fail-closed behavior for out-of-scope targets, ambiguous authorization, exclusions, unsafe sample handling, cancellation, and unsupported claims.

**Detailed requirements:** [ADVANCED_SECURITY_RESEARCH_REQUIREMENTS.md](ADVANCED_SECURITY_RESEARCH_REQUIREMENTS.md). This is a requirements addition only; no security testing or exploit execution is authorized or claimed.


## 28. G.I.R.L. — Geometric Intelligence Representation Layer and machine-native agent communication

The owner recovered and confirmed the original acronym **G.I.R.L. = Geometric Intelligence Representation Layer**. This is a candidate geometric/latent representation between model-specific inference and authorized agent messaging. It is not a claim that multiple models inherently share an internal language, nor a replacement for APEX/East governance, typed MessageBus, native inference, or ordinary-language fallback.

- [ ] Define G.I.R.L. as an experimental, model-independent *adapter boundary* with exact provenance, rather than an assumed universal common latent language.
- [ ] Require explicit sender/recipient capability negotiation for model ID, immutable revision, codec ID/version, shape, codebook identity, supported latent ingestion, and privacy classification.
- [ ] Capture genuinely generated native token-level vector sequences within validated memory, token, dimension, runtime-session, and cancellation bounds; record vector layer/position semantics.
- [ ] Preserve byte-for-byte compatible TypeScript and native Swift GIE1 encoding/decoding against canonical shared fixtures; do not silently alter the wire protocol.
- [ ] Load canonical GCB1 codebook artifacts with independently checked SHA-256 bytes, exact model/revision binding, and separately trusted publisher/provenance verification before production use.
- [ ] Preserve the strict typed JSON MessageBus as the control plane while transferring latent tensors only through separately bounded, integrity-addressed binary blobs.
- [ ] Enforce independent APEX/Director approval for exact task, sender, recipient, codec, scope, payload size, expiry, and privacy policy, with East/e3 durable execution ownership.
- [ ] Enforce authenticated route binding, digest and length checks, replay prevention, expiration, quotas, cancellation/drain, and rejection of mismatched or tampered latent transfers.
- [ ] Test text fallback or fail-closed rejection when models, revisions, decoders, artifacts, runtime readiness, quality thresholds, or authorization do not meet negotiated constraints.
- [ ] Demonstrate a real two-agent same-model communication round trip in which the recipient **consumes** the reconstructed representation and completes a measured downstream task, not merely decoding bytes.
- [ ] Evaluate Minimal Surface-inspired relationship/order preservation as an optional, versioned experimental sidecar, never an unnegotiated extension of GIE1 v1.
- [ ] Permit heterogeneous-model latent exchange only through separately trained/versioned alignment adapters with held-out task-quality, safety, and distribution-shift evidence; otherwise fall back to text.
- [ ] Compare text, raw latent, affine-int8, GIE1/GCB1, and optional geometric/relationship variants for payload bytes, numerical error, task success, end-to-end latency, memory, battery/thermal behavior, and evidence reproducibility.
- [ ] Integrate negotiated G.I.R.L. into the native user-visible agent task path with clear model/route attribution, approval state, explicit failure/fallback, physical iPhone testing, and safe interruption/recovery.

**Integration contract and test matrix:** [G.I.R.L. Integration and End-to-End POC Gates](../../coordination/GIRL_GEOMETRIC_LATENT_INTEGRATION_2026-11-19.md). All requirements above remain unchecked pending requirement-specific acceptance evidence. This is a post-November-16 addition to the original 316-row traceability snapshot.
