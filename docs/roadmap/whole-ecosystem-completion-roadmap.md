# Pocket AI Lab — Whole-Ecosystem Completion Roadmap

**Planning baseline:** 2026-11-15  
**Status:** Estimate and acceptance plan, not a release commitment  
**Product target:** One integrated, offline-first mobile intelligence ecosystem—not a bundle of independently working components.

## Executive estimate

A credible end-to-end, release-candidate ecosystem is estimated at **10–16 weeks of focused engineering after the current open-PR stack is reconciled**, assuming one experienced full-time engineer with access to CI and physical iOS test hardware. A production-hardened release with broader device coverage, security review, privacy/deployment work, and operational support is more realistically **16–24 weeks**.

For one person working intermittently, plan on approximately **4–8 months**. These are estimates, not elapsed-time guarantees. They exclude unbounded feature expansion, external review delays, unavailable hardware, Apple provisioning delays, and major architectural rewrites discovered during integration.

The project is not at the start line: substantial components and CI workflows already exist. It is also not close enough to claim completion: native iOS/runtime, durable execution, governance, memory, and product experience still need proven end-to-end integration.

## Current repository evidence snapshot

The following is a snapshot of visible pull requests and reported checks, not a statement that changes are merged or accepted:

| Workstream | Current evidence | Remaining gate |
|---|---|---|
| Autonomous task lifecycle, PR #94 | Draft PR; four reported CI workflows succeeded | Production durable store, host scheduler, Director/APEX and East/e3 integration, restart/fault-injection tests |
| Ecosystem work ethic/integration contract, PR #93 | Draft PR; four workflows succeeded; iOS LlamaEngine workflow was still running at snapshot | Adopt contract as implementation acceptance criteria and map every dependency edge |
| Runtime proof verifier, PR #83 | Five reported workflows succeeded, including iOS LlamaEngine CI | Reconcile old base with current main; validate physical runtime session and replay behavior |
| GGUF import/workspace hardening, PR #84 | Five reported workflows succeeded, including iOS LlamaEngine CI | Reconcile branch dependencies and validate on supported physical hardware |
| Native model pool/scheduler, PR #86 | Four workflows succeeded; iOS LlamaEngine CI still running at snapshot | Finish native build, integrate chat/orchestration, resource pressure and cancellation tests |
| Content-addressed model sessions, PR #88 | No PR-triggered workflow runs returned for inspected head | Validate stacked base, obtain CI, test import-to-runtime hash binding |
| Model router generation reservations, PR #90 | Five reported workflows succeeded | Integrate with real model pool and replacement/cancellation paths |
| Director skill lifecycle, PR #91 | Four reported workflows succeeded | Review promotion policy, connect to actual task execution without widening permissions |
| Rubric binding, PR #92 | No PR-triggered workflow runs returned for inspected head | Validate stacked dependency on #91 and obtain CI evidence |

PRs remain open and unmerged in this snapshot. CI success means configured workflows passed for the inspected commit; it does not mean product acceptance. Some branches are stacked on older open PRs and must be reconciled before integration.

## Delivery phases and estimates

Durations are sequential planning ranges. Some work can overlap after interfaces stabilize, but dependent acceptance gates must not be skipped.

### Phase 0 — Repository stabilization and dependency reconciliation
**Estimate: 1–2 weeks**

- Inventory every open PR, feature branch, workflow, and architectural owner.
- Build a dependency graph for stacked PRs; refresh stale bases and resolve conflicts on feature branches only.
- Review code diffs and CI results; obtain missing workflow evidence.
- Keep main unchanged until maintainers choose to integrate reviewed work.
- Produce a component/edge register with statuses: implemented, partial, placeholder, absent, verified.

**Exit evidence:** no unknown branch dependencies; current CI for each candidate; reviewed diffs; clear merge order and rollback plan.

### Phase 1 — Durable objective-to-execution vertical slice
**Estimate: 2–3 weeks**

- Replace test-only in-memory task storage with a production transactional store and migrations.
- Add cross-process-safe claims, leases, idempotency keys, deadlines, retry/backoff, cancellation, and restart recovery.
- Connect user objective → Director plan → task lifecycle → governed capability dispatch → East/e3 workflow → correlated evidence.
- Preserve separate user-owned and AI-owned task lists.
- Add fault injection for store failure, process restart, duplicate delivery, partial effects, and cancellation races.

**Exit evidence:** a repeatable end-to-end workflow survives process termination and resumes without duplicate consequential effects; APEX denies unauthorized actions; East/e3 records durable execution.

### Phase 2 — Native inference and model lifecycle
**Estimate: 2–4 weeks**

- Reconcile native model import, content-addressing, runtime-proof, ModelPool, and scheduler branches.
- Complete the iOS device build and distinguish compile, simulator, device-install, runtime-load, and successful-generation evidence.
- Connect model picker and automatic routing to actual runtime readiness, model identity/hash, session proof, resource limits, and failure states.
- Integrate cancellation, unload, memory pressure, thermal state, concurrency, and model replacement.
- Keep optional cloud inference explicitly disclosed and governed; offline-first remains the default.

**Exit evidence:** on a supported physical iPhone, import a supported GGUF, verify its content identity, load it, generate a response, cancel/unload it, recover from interruption, and report truthful readiness states.

### Phase 3 — Multi-agent collaboration, knowledge, and evaluation
**Estimate: 2–3 weeks**

- Connect permanent agents and dynamic specialists to the same task/message/evidence contracts.
- Demonstrate actual provider calls for each claimed active agent; no simulated agent activity.
- Add bounded delegation, shared task context, disagreement preservation, critic review, independent validation, and final synthesis.
- Connect working/episodic/semantic/procedural memory with provenance, retention, user controls, and deletion.
- Connect ExploitGym only to isolated/synthetic workloads with resource caps and reproducible evaluation evidence.

**Exit evidence:** a multi-agent task runs end-to-end on local inference, records attributable agent/model outputs, preserves disagreement, independently validates results, and stores only provenance-bearing memory under user controls.

### Phase 4 — Unified native experience and resilience
**Estimate: 2–3 weeks**

- Integrate chat, agent team, memory, activity, model management, settings, and evidence into one native task experience.
- Show task/agent/model/runtime/execution status and explain blocked, unavailable, degraded, and recovering states.
- Add offline queues and safe resume for supported tasks; clearly mark cloud-only work unavailable offline.
- Add correlated diagnostics and privacy-safe telemetry; keep telemetry separate from authority/evidence receipts.
- Verify accessibility, battery/resource budgets, storage limits, and data lifecycle controls.

**Exit evidence:** one task is traceable from the user interface through agents, runtime, governance, execution, memory, and evidence; offline and recovery behavior is tested.

### Phase 5 — Security review, release engineering, and acceptance
**Estimate: 2–4 weeks**

- Run contract, integration, end-to-end, fault-injection, security, dependency, and secret-scanning suites.
- Review APEX policy boundaries, BridgeGate trusted-origin handling, RLS/tenant isolation where applicable, signed evidence, and replay protection.
- Validate upgrade/migration, backup/recovery, crash handling, privacy notices, diagnostics, and release/rollback procedures.
- Test on the supported physical iPhone matrix and document model/device compatibility.
- Publish limitations and a release runbook.

**Exit evidence:** all product acceptance criteria have named passing evidence; no critical security findings remain open; device and release checks are documented; a rollback path is tested.

## Critical path

1. PR and branch reconciliation.
2. Durable task store and lifecycle.
3. Director/APEX authorization and East/e3 execution.
4. Correlated evidence and restart/fault recovery.
5. Native model import, runtime proof, and ModelPool.
6. Actual multi-agent local inference and evaluation.
7. Unified iOS experience and offline continuity.
8. Security review and physical-device acceptance.
9. Release candidate.

Agent collaboration, memory, and UX work can proceed in parallel once task, identity, and evidence contracts are stable. Native device acceptance cannot be replaced by TypeScript tests or simulator compilation.

## Completion definition

The project is complete only when all of the following are demonstrated together:

1. One user objective creates a durable task with explicit scope, constraints, priorities, dependencies, and stop conditions.
2. Director coordinates real agents and models; every claimed action is attributable.
3. Local inference works on supported hardware and readiness reflects real runtime evidence.
4. APEX independently authorizes consequential operations; East/e3 executes approved work durably and idempotently.
5. ExploitGym evaluates only isolated/synthetic workloads and returns reproducible evidence.
6. Memory and artifacts retain provenance and obey user retention/deletion controls.
7. The native app shows truthful progress, failures, recovery, model status, and evidence.
8. Offline operation and restart recovery work for the supported offline task set.
9. Security, privacy, performance, accessibility, upgrade, and rollback gates pass.
10. The release report links exact commits, CI runs, test reports, device evidence, known limitations, and unresolved risks.

## Risks and estimate confidence

- **Stacked branches:** stale bases and dependent drafts can add 1–3 weeks if integration conflicts are substantial.
- **iOS build/runtime:** long native builds, provisioning, device compatibility, and model memory limits are high-variance risks.
- **Persistence/East integration:** the lifecycle kernel is not itself a production scheduler or durable distributed execution system.
- **Hardware:** physical-device acceptance requires a supported device and repeatable test access.
- **Scope:** new feature requests after Phase 0 should be triaged against the completion definition; otherwise the finish date continually moves.

Confidence is **medium-low** until Phase 0 produces a complete repository dependency graph and the first vertical slice passes on real hardware. Re-estimate after Phase 1 and Phase 2 using measured throughput and actual CI/device cycle times.

## Operating rules

- Continue routine, reversible, authorized engineering work without repeated prompts.
- Use feature branches and draft PRs for review; do not silently merge or alter protected/mainline state.
- Never bypass APEX, East/e3, BridgeGate, or evidence authority to make a demo pass.
- Stop and report when access, credentials, hardware, permissions, or human decisions are required.
- Report completed work only when its evidence exists; planned work is not progress.
- Keep the user's objective and product acceptance criteria above activity volume or autonomous self-generated tasks.
