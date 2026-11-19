# OWASP Security Knowledge Integration — Pocket AI Lab

**Status:** Proposed engineering baseline on `codex/owasp-knowledge-integration-v4`  
**Sources:** Official OWASP Cheat Sheet Series Markdown files, individually inspected through the GitHub repository.  
**Purpose:** Convert relevant OWASP guidance into Pocket AI Lab requirements, implementation mappings, and acceptance tests. This document is an integration specification, not a claim that every control is implemented.

## 1. Design decision

**Source license:** The OWASP Cheat Sheet Series repository identifies its material as Creative Commons Attribution-ShareAlike 4.0 International (CC BY-SA 4.0). Preserve attribution and applicable ShareAlike terms for any redistributed source text or adapted material. See [OWASP LICENSE.md](https://github.com/OWASP/CheatSheetSeries/blob/master/LICENSE.md). The catalog records this license and pins every source and license URL to repository commit `7af0ef1b745f1a38ce905c00c5a592d5b3a515a9`. The `master` branch is retained only as discovery metadata; it is not used as a retrieval URL.

OWASP material is versioned reference knowledge, not executable policy. Pocket AI Lab must retrieve relevant guidance for the current task, preserve its source provenance, and keep it subordinate to product policy and APEX authorization.

The existing architecture remains intact:

- Intelligence agents propose, research, plan, and critique.
- The message bus transports typed agent messages.
- Memory and knowledge retain source-linked information.
- APEX independently decides whether a consequential action is permitted.
- East/e3 manages durable workflow execution.
- Evidence verification determines what can actually be established about an execution.

No OWASP recommendation grants an agent new permissions. No retrieved document can override system policy, APEX, or an exact-scope approval.

## 2. Source-derived control requirements

### OWASP-AI-001 — Tool least privilege and independent authorization

**Source:** AI Agent Security Cheat Sheet.

- Give each agent only the tools and resource scopes needed for its current task.
- Enforce authorization in the trusted execution component, outside model context.
- Unknown tools, missing approvals, policy lookup failures, and unknown risk classes fail closed.
- Bind approval to actor, exact tool, target, normalized parameters, timestamp, expiry, and one-time use.
- Validate and consume approval atomically immediately before execution; changed parameters require a new approval.
- Distinguish an approval record from an agent-supplied `user_confirmed` field or model-generated claim.
- Apply bounded tool calls, delegation, retries, latency, and resource budgets to control cascading failure and denial-of-wallet risks.

**Pocket AI Lab mapping:** Director/APEX, tool registry/execution boundary, East task lifecycle, human approval queue.

### OWASP-AI-002 — Untrusted input and prompt-injection resistance

**Sources:** AI Agent Security; LLM Prompt Injection Prevention.

- Treat user content, retrieved documents, repository files, web pages, email, API responses, and tool-returned text as untrusted data.
- Keep instruction channels structurally separate from retrieved data; delimiters are helpful but are not a security boundary by themselves.
- Never allow retrieved content to directly authorize tools, change agent permissions, modify policy, or create trusted memory.
- Apply source-aware validation and output validation before any tool execution or persistence.
- Test direct and indirect injection, hidden/encoded text, multilingual and cross-script content, multimodal inputs, RAG poisoning, multi-turn persistence, system-prompt extraction, and tool-return injection.
- Require explicit policy checks after the model proposes an action; do not rely on model-based guardrails as the enforcement boundary.

**Pocket AI Lab mapping:** Researcher ingestion, Knowledge retrieval, Orchestrator context assembly, Tool execution gateway, Critic and Validator.

### OWASP-AI-003 — Memory and context security

**Sources:** AI Agent Security; LLM Prompt Injection Prevention.

- Keep user, project, session, task, and agent memory scopes isolated.
- Validate provenance and trust classification before persistence.
- Apply retention, expiration, size limits, and sensitive-data screening.
- Preserve cryptographic integrity for durable records and verify integrity before retrieval.
- Distinguish user-confirmed facts, tool observations, agent inferences, and untrusted external claims.
- Prevent untrusted content from becoming verified merely because it was summarized, repeated, or stored.
- Do not auto-save raw conversation content or secrets into durable memory.

**Pocket AI Lab mapping:** Four-layer MemoryManager (working, episodic, semantic, procedural), FileMemoryStore/encrypted native memory, ContextIngester, Archivist.

**Existing limitation to preserve in status reporting:** The consumer prototype has had a checksummed plaintext file-backed memory implementation. Checksums are not encryption. Do not claim encryption at rest unless the exact storage path and key handling have been verified.

### OWASP-AI-004 — Human oversight and high-impact action integrity

**Source:** AI Agent Security.

- Classify actions by risk. Only explicitly allowlisted low-risk actions may be eligible to proceed without human review.
- Require preview and explicit approval for high-impact, irreversible, destructive, financial, administrative, or externally visible actions.
- Bind approval to the exact action and protect against replay, expiry, parameter substitution, and duplicate execution.
- Require stronger authentication for critical operations where supported by the product threat model.
- Preserve interruption, cancellation, and recovery paths.
- Fail closed when approval validation, policy lookup, or required audit recording fails.

**Pocket AI Lab mapping:** Existing APEX exact-scope approval contract, native approval UI, East execution gate. This is a requirement to integrate with existing APEX—not to create a parallel approval authority.

### OWASP-AI-005 — Multi-agent trust boundaries

**Sources:** AI Agent Security; MCP Security.

- Authenticate agent identity and validate the sender, recipient, message type, task, and schema.
- A valid message signature or authenticated sender does not grant permission to execute the requested action.
- Enforce authorization at the receiving tool/execution boundary.
- Preserve provenance and trust labels through delegation.
- Bound delegation depth, fan-out, retries, and shared resource budgets.
- Isolate agents and tool servers by trust level and scope.
- Treat tool descriptions, tool outputs, and remote server responses as untrusted input.
- Protect message integrity and replay-sensitive operations with expiry and unique identifiers where the transport crosses a trust boundary.

**Pocket AI Lab mapping:** MessageBus, AgentProtocol, ToolDirector/ToolRegistry, Director/APEX, East worker ownership and idempotency controls.

### OWASP-AI-006 — Execution evidence verification

**Source:** Verifying Third-Party Agent Execution Evidence.

Review each execution record using six questions:

1. Who could have written or altered it?
2. What does the timing evidence actually establish?
3. Does it identify the intended artifact and execution?
4. Would an omitted event be detectable?
5. What happens when recording or delivery fails?
6. Can a reviewer verify it without being able to forge it?

- Label evidence as independently re-checkable, supplier assertion, or no information.
- A signature may prove who made an assertion without proving that the assertion is true.
- Identify the component, host, recorder, operator, and signing-key holder; count independent trust domains, not processes.
- Do not infer a clean execution from an incomplete or missing log.
- Preserve artifact identity, runtime/session identity, task identity, timestamps, and evidence lineage.
- Keep model-generated claims and supplier-controlled records separate from independently verified execution evidence.
- Recording failure must be explicit and must fail closed for actions that require evidence.

**Pocket AI Lab mapping:** Evidence.swift, RuntimeController readiness proof, signed generation evidence, APEX verifier, East parent/child evidence lineage.

**Existing trust contract remains authoritative:** Runtime session + model file hash + expiring generation check; disconnect means Unavailable while preserving the model file; receipts remain separate from UI labels; server and device attestation are distinct; attempts are immutable; Ed25519 trusted runtime key; inference backend cannot issue its own authoritative receipts.

### OWASP-MOB-001 — iOS client security foundations

**Source:** Mobile Application Security Cheat Sheet.

- Enforce authentication and authorization outside client-only UI controls; assume client-side checks can be bypassed.
- Do not embed credentials in the application bundle. Use revocable tokens and platform secure storage.
- Encrypt sensitive data at rest and in transit using platform cryptographic APIs; use hardware-backed key protection where appropriate.
- Use HTTPS and reject invalid certificates; never disable transport validation to make a connection work.
- Minimize personal data and apply retention/expiration/deletion.
- Prevent sensitive content leakage through logs, caches, background snapshots, notifications, and UI surfaces.
- Protect sensitive operations with re-authentication or platform authentication where appropriate.
- Validate inputs and outputs; maintain dependency updates, signing, static analysis, security tests, and incident response.

**Pocket AI Lab mapping:** Native iOS app, Keychain/Secure Enclave integration, BridgeGate, WebKit bridge, local encrypted memory, cloud adapters.

**Scope limitation:** This is mobile application security guidance. It does not establish kernel, firmware, Apple silicon, or exploit-chain security.

### OWASP-ID-001 — OAuth and token handling

**Source:** OAuth 2.0 Protocol Cheat Sheet.

- Use Authorization Code with PKCE for public native clients; do not use the deprecated implicit grant.
- Restrict access-token privileges and audience.
- Protect refresh tokens with rotation or sender-constraining mechanisms appropriate to the provider.
- Consider proof-of-possession mechanisms where token theft is in scope.
- Avoid open redirectors and validate redirect targets.
- Keep credentials out of model prompts, logs, app bundles, and repository files.

**Pocket AI Lab mapping:** Cloud provider adapters, GitHub/connector integrations, account linking, remote compute authorization.

### OWASP-THREAT-001 — Continuous threat modeling

**Source:** Threat Modeling Cheat Sheet.

- Maintain a living threat model alongside the product and its architecture.
- Explicitly document system components, trust boundaries, assets, entry points, data flows, threats, mitigations, and residual risks.
- Review the model after changes to agents, tools, message protocols, memory, runtime bridges, cloud adapters, or evidence contracts.
- Validate that mitigations exist in production paths and have tests.

**Pocket AI Lab mapping:** Architecture docs, security workstreams, Critic/Validator review, release gates.

## 3. Knowledge ingestion and retrieval requirements

- Keep source documents separate from generated summaries and product policy.
- Record canonical URL pinned to an immutable repository commit, repository, path, discovery branch, commit SHA, Git blob SHA, retrieval time, license metadata, and content hash.
- Pin source revisions for reproducible builds; a mutable branch such as `master` is not a stable version. Current catalog revision: `7af0ef1b745f1a38ce905c00c5a592d5b3a515a9`; each listed blob SHA was checked against that commit tree.
- Preserve headings, references, code examples, and relative links when ingestion is implemented.
- Make packs available offline after synchronization.
- Route only relevant excerpts to agents; do not insert the whole corpus into every system prompt.
- Treat all retrieved source content as untrusted data.
- Detect changed source revisions and preserve prior versions rather than overwriting them.
- Track which source versions informed a recommendation or code change.
- Keep OWASP guidance distinguishable from Pocket AI Lab policy and implementation decisions.

## 4. Work packages

| Work package | Scope | Primary owner area | Acceptance evidence |
|---|---|---|---|
| OWASP-KNOW-01 | Versioned source catalog and provenance metadata | intelligence/knowledge | Catalog validation tests; source URLs and blob SHAs |
| OWASP-KNOW-02 | Offline ingestion, parser, version diff, and retrieval | intelligence/knowledge | Deterministic ingestion tests; corruption and update tests |
| OWASP-KNOW-03 | Agent/task-aware retrieval routing | Researcher, Orchestrator, Archivist | Tests proving relevant sources are routed without prompt-wide injection |
| OWASP-SEC-01 | Tool least privilege and exact-action approval enforcement | APEX/tool boundary | Denial, replay, expiry, parameter-substitution tests |
| OWASP-SEC-02 | Untrusted-content and prompt-injection defenses | ingestion/context/tool boundary | Adversarial corpus and regression tests |
| OWASP-SEC-03 | Memory isolation, integrity, retention, and secret screening | Memory subsystem | Cross-scope, tamper, expiry, and secret-leak tests |
| OWASP-SEC-04 | Agent message authentication, recipient checks, replay and delegation limits | MessageBus/East | Contract and concurrency tests |
| OWASP-SEC-05 | Independent execution evidence classification and verification | Evidence/APEX | Forgery, omission, signer-compromise, and incomplete-log tests |
| OWASP-MOB-01 | iOS storage, bridge, transport, privacy, and dependency controls | Native iOS | Physical-device and integration tests |
| OWASP-ID-01 | Native OAuth/PKCE/token lifecycle controls | Provider adapters | Redirect, token audience, rotation, and revocation tests |

## 5. Immediate gaps observed during source-to-code review

These are code-review observations, not a complete security audit:

1. The current branch's `MessageBus` schema validates message shape and freezes published messages, but it does not itself authenticate senders, authorize recipients, prevent replay, enforce message expiry, or enforce delegation budgets. Those controls must live at trusted boundaries; do not claim the bus is secure merely because messages are immutable.
2. The current branch's `MemoryManager` has four-layer labels and provenance fields, but the shown implementation does not enforce namespace isolation, TTL, secret screening, cryptographic integrity, or durable encrypted storage. Existing separate storage implementations must be reviewed before deciding which gaps remain.
3. Model-generated tool requests must remain proposals. The tool execution component—not prompt text or a role name—must enforce permissions and exact-scope approvals.
4. The evidence guidance reinforces the existing distinction between signed assertions and independently verifiable execution facts. It does not justify weakening or replacing the current APEX trust contract.
5. Mobile app guidance should be mapped to iOS app and bridge work; it is not a substitute for the separate advanced mobile exploit research requirements.

## 6. Completion discipline

This integration is complete only when:
- the source catalog is checked and pinned;
- knowledge ingestion and retrieval are implemented and tested;
- every security work package is mapped to actual production code paths;
- negative tests prove unauthorized actions fail closed;
- independent review confirms no agent-to-APEX authority shortcut;
- physical iOS tests verify the applicable native controls;
- source provenance and limitations are visible in generated research artifacts.

Do not mark a control complete based solely on this document, a source citation, a model assertion, or a passing unrelated workflow.
