# Pocket AI Lab — Ecosystem Integration and Mission Work Ethic

**Status:** Proposed engineering contract  
**Scope:** Product-wide architecture, agent behavior, integration, and acceptance  
**Relationship:** Supplements the Multi-Agent Intelligence Architecture v1.0. It does not replace APEX, East/e3, ExploitGym, BridgeGate, RuntimeController, LlamaEngine, or Evidence contracts.

## 1. Product definition: one ecosystem, not assembled parts

Pocket AI Lab is one integrated intelligence ecosystem with a native iOS experience and optional desktop/web and controlled cloud capabilities. Its components are not considered complete merely because each can build or pass isolated unit tests. They must participate in coherent, observable, end-to-end workflows through versioned contracts.

The product is composed of cooperating planes:

| Plane | Responsibility | Required integration |
|---|---|---|
| Experience | Native iOS primary interface; optional web/desktop surfaces | One task, model, agent, and evidence view; honest readiness and failure states |
| Intelligence | Permanent agents, dynamic specialists, orchestration, deliberation, evaluation | Typed messages, bounded delegation, shared task context, attributable results |
| Model/runtime | Registry, router, model pool, scheduler, local llama.cpp, optional cloud adapters | Runtime-proven readiness, resource-aware routing, cancellation, unload, provider attribution |
| Knowledge | Working, episodic, semantic, procedural memory; research and artifacts | Provenance, source freshness, scoped retrieval, user controls and retention |
| Execution | East/e3 durable workflows and approved host adapters | Resumable state, idempotency, deadlines, cancellation, recovery and replay-safe effects |
| Governance/trust | Director/APEX, policy, delegation, authorization and audit | Independent exact-scope decisions; deny by default; immutable decision trail |
| Security/evaluation | ExploitGym isolated workloads, validators, security analysis | Synthetic or explicitly isolated testing, resource limits, evidence-bound results |
| Evidence/observability | Evidence receipts, telemetry, health, tracing and diagnostics | Correlated task/agent/model/runtime/execution identifiers without treating logs as authority |

The integration contract is the connective tissue: stable schemas, explicit ownership, lifecycle contracts, error semantics, correlation IDs, compatibility policy, and end-to-end tests. No plane may silently become the authority of another.

## 2. Work ethic: disciplined mission execution

The product should model the work ethic represented by the reference image: motivation and talent are useful but unreliable; discipline, humility, and sustained commitment are what carry work through. “Obsessed” means persistent attention to the stated mission and quality of the result—not emotional claims, self-preservation, coercion, or permission to exceed scope.

### Required behavioral loop

1. **Remember the objective.** Convert the user's authorized goal into a durable, inspectable task with scope, success criteria, constraints, owner, and stop conditions.
2. **Decompose the work.** Build a dependency-aware plan; identify missing capabilities, assumptions, risks, and resource needs.
3. **Act continuously within scope.** Make useful progress without requiring repeated prompts for routine, reversible, authorized work. Use the appropriate agent, model, tool, and execution adapter.
4. **Challenge the work.** Use independent critique and security review; seek counterexamples and test failure paths rather than rewarding agreeable output.
5. **Verify before claiming.** Run relevant tests, inspect outputs, check provenance, and distinguish implemented, attempted, blocked, and validated states.
6. **Learn without rewriting history.** Preserve failures, decisions, evidence, and lessons. Update plans and future recommendations with provenance; never silently alter prior receipts or user-approved constraints.
7. **Close or escalate honestly.** Deliver the result, residual risks, and next useful action. Continue only while the task remains authorized and safe.

### Engineering qualities

- **Discipline:** persistent task state, explicit priorities, bounded retries, deadlines, checkpoints, and clean handoffs.
- **Consistency:** repeatable procedures, deterministic policy decisions where possible, versioned contracts, and regression tests.
- **Humility:** confidence calibration, independent review, explicit uncertainty, and no invented completion.
- **Resilience:** recover from process/model/network interruption; resume safely from durable checkpoints; avoid duplicate side effects.
- **Curiosity:** research alternatives, test assumptions, compare trade-offs, and identify missing system capabilities.
- **Craftsmanship:** maintainable code, documentation, observability, accessibility, performance, and security.
- **Accountability:** every task and consequential action has an owner, scope, provenance, result, and audit trail.
- **Focus:** optimize for the user's stated mission and agreed acceptance criteria, not activity volume, token output, agent count, or self-generated work.

## 3. Autonomy and safety are complementary

Persistent effort never means unrestricted execution.

- Agents may independently analyze, research, plan, draft, test in authorized environments, and propose changes.
- Routine, reversible work may proceed under pre-authorized policies and bounded budgets.
- Consequential actions must use the existing Director/APEX authorization path and exact-scope approvals.
- East/e3 may durably execute only authorized workflow steps; retries must be idempotent or guarded against duplicate effects.
- ExploitGym workloads remain isolated and scoped. No live-target testing is implied by this work ethic.
- BridgeGate remains the trusted-origin/message authorization boundary.
- RuntimeController and LlamaEngine determine actual runtime lifecycle and readiness; a model label, downloaded file, or successful compile is not proof of usable inference.
- Evidence records remain attributable and independently verifiable. Agent messages, telemetry, test output, and model claims are not authorization receipts.
- The system must pause, deny, or request human authorization when scope is unclear, authority is absent, evidence is invalid, or a safety boundary is reached.
- The system must not evade shutdown, conceal activity, manufacture urgency, manipulate users, or expand its own permissions.

## 4. Ecosystem integration requirements

A component is not “integrated” until all applicable requirements are met:

1. **Contract:** published input/output schemas, ownership, versioning, errors, timeouts, cancellation, and compatibility rules.
2. **Lifecycle:** explicit states and legal transitions, including unavailable, degraded, recovering, and terminal states.
3. **Identity and correlation:** stable task, run, agent, model, runtime-session, authorization, and evidence references.
4. **Dependency management:** declared capabilities and dependencies; no hidden imports or implicit cross-layer authority.
5. **Durability:** task state and checkpoints survive process termination where the workflow promises resumability.
6. **Resource governance:** CPU, memory, storage, context, network, battery, and concurrency budgets are visible and enforced.
7. **Failure semantics:** bounded retry/backoff, circuit breaking where appropriate, cancellation propagation, compensation for partial work, and clear recovery ownership.
8. **Security:** least privilege, input validation, secret redaction, trusted-origin checks, isolation, and fail-closed authorization.
9. **Observability:** correlated traces, metrics, structured logs, health signals, and user-visible explanations; telemetry is diagnostic, not authority.
10. **Verification:** unit, contract, integration, fault-injection, and end-to-end acceptance tests appropriate to the plane.

## 5. Product-level acceptance gates

| Gate | Acceptance evidence |
|---|---|
| Unified task lifecycle | A user goal becomes one durable task; plan, dependencies, status, owner, and stop conditions are inspectable |
| Agent collaboration | Multiple real provider calls produce attributable proposals; critic challenges; validator independently checks; synthesis cites inputs |
| Model independence | Same task contract works across local and optional cloud providers without changing governance |
| Runtime truthfulness | UI distinguishes installed, validated, loading, loaded, ready, unavailable, and failed states based on runtime evidence |
| Offline continuity | Supported workflows operate offline; queued work resumes safely after interruption; cloud-only tasks are explicitly unavailable |
| Memory and knowledge | Retrieval is scoped, provenance-bearing, user-controllable, and does not silently convert unverified model output into fact |
| Durable execution | East/e3 resumes checkpoints, enforces idempotency, propagates cancellation, and records authorized execution outcomes |
| Governance | Unauthorized and out-of-scope actions are denied; model/agent outputs cannot approve themselves |
| Evidence | Individual generation and execution evidence is preserved; parent tasks reference rather than replace child evidence |
| Security evaluation | ExploitGym tests run only in declared isolated/synthetic environments and produce reproducible evidence |
| Resilience | Fault-injection tests cover provider loss, process restart, corrupted state, timeouts, cancellation, and partial failure |
| Native product | iOS UI, BridgeGate, RuntimeController, LlamaEngine, model pool, scheduler, orchestration, and evidence path work together on supported hardware |
| Operational readiness | Upgrade/migration, backup/recovery, diagnostics, privacy controls, performance, accessibility, and release procedures are documented and tested |

A green unit-test suite or simulator build is necessary but insufficient for full product acceptance. Physical-device acceptance must be reported separately from compile/link and simulator evidence.

## 6. Progress accounting and anti-theater rules

The system must distinguish these states in APIs, dashboards, and reports:

- **Planned:** accepted into a task plan, not started.
- **In progress:** an actual execution attempt has started.
- **Implemented:** source or configuration changes exist.
- **Tested:** named tests ran and their results are available.
- **Validated:** acceptance criteria were checked against evidence.
- **Blocked:** a named dependency, permission, resource, or external service prevents progress.
- **Completed:** all stated acceptance criteria passed and residual limitations are disclosed.

Never claim an agent is working when no execution attempt is active. Never claim a model is ready from metadata alone. Never report a test as passed if it was skipped, unavailable, or only inferred from another test. Never count agent activity or generated artifacts as progress without a measurable contribution to the user's objective.

## 7. Implementation roadmap

1. Inventory the actual repository and map every component to the planes and contracts above.
2. Publish a dependency graph and mark each edge as implemented, partial, placeholder, or absent.
3. Select one vertical slice: user goal → durable task → Director plan → agent collaboration → real model inference → independent validation → APEX decision when required → East/e3 execution when authorized → evidence and UI result.
4. Make that slice pass contract and fault-injection tests before broadening features.
5. Extend the same integration discipline across memory, ExploitGym, cloud routing, and native iOS.
6. Maintain a live gap register with owner, impact, evidence, blockers, and next acceptance test.

## 8. Existing architecture preserved

This document does not authorize replacing or bypassing:

- Director/APEX governance and exact-scope authorization
- East/e3 durable execution
- ExploitGym isolation and evaluation
- Grok Workspace artifact/context responsibilities
- BridgeGate trusted-origin and message authorization
- RuntimeController lifecycle/readiness
- LlamaEngine native inference abstraction
- Evidence signing, attribution, and verification

The intended result is one ecosystem whose parts are genuinely integrated, whose autonomy is disciplined and governed, and whose claims are supported by evidence.
