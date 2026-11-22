# Pocket AI Lab — three complete security engines admission contract v1

**State:** Host-admission contract and executable negative tests only. Engines are not installed, started or invoked by this package. Green CI does not establish product-wide integration, signed APEX verification, target scope, or an ExploitGym production workload.

## Owner direction (2026-11-22)
Retain ARTEX's full offensive toolchain, STRIDE-GPT's full threat-modeling application, and ExploitGym's benchmark/evaluator as separately hosted, optional, isolated engines; selective component reuse is allowed too. No replacement for the native iPhone interface, Director/APEX, East/e3, MessageBus, InferenceProvider or trusted Evidence contracts.

## Avoid duplicate work
- ExploitGym has an existing draft submodule restoration at PR #165, pinned to the same upstream commit as the owner's ZIP. Reuse it instead of copying the 23 MB ZIP into main.
- Draft PR #139 ScopeGuard and #183/#184 scope/quarantine records are references, not currently implemented APEX-issued authorizations for a live target.
- Draft PR #281/#282/#283 already test synthetic causal scoring, East recovery, and a Docker compatibility worker. Do not overwrite these drafts.
- STRIDE-GPT donor D-02 is covered by PR #198/#200, with unresolved workspace-race issue #202. Full STRIDE-GPT may also run in an isolated analysis sidecar; do not duplicate D-02 or put LiteLLM in the iPhone model router.

## Full-engine topology
Owner iPhone workspace -> Pocket host/API -> trusted admission (current scope, APEX approval, emergency stop, audit, atomic attempt reservation) -> East task lifecycle -> isolated sidecar engine -> independent Critic/Validator -> evidence & owner review.

- ARTEX: planner, workers, offensive tool registry, traffic capture/replay, authorized browser tests, coverage and finding management. Its internal target/intercept controls are a second defense, not APEX permission. Enforce host firewall/target/rate restrictions independently.
- STRIDE-GPT: Python 3.12+ threat-modeling agent, data-flow diagrams, attack trees, source-evidence and SARIF. External LLM usage requires approved host provider routing; original tool's network abilities must not become automatic permission.
- ExploitGym: benchmark controller, trial environments, firewall proxy, grader and agent interfaces on isolated compute. A local challenge is distinct from a live external target. Evaluate upstream Nov 14 cross-trial network isolation before deployment.

## Implementation here
- engines.json pins uploaded archive SHA-256, matched upstream commits, licenses, capabilities, deployment and currently unavailable readiness.
- admission.mjs validates exact engine/capability, task and attempt, opaque host asset reference, environment and source revision. Host ports are called for stop, scope, independently verified action-bound APEX record, stop, persisted audit, durable reservation, stop, and execution. Any missing or mismatched approval blocks dispatch; ambiguous outcomes cannot be automatically retried. No authority can be inferred from model text or an engine result.
- admission.test.mjs uses injected synthetic executors for all three engines. It contains no network code, model calls, real target or offensive execution.

## Remaining acceptance gates
1. Actual APEX cryptographic verifier plus fresh program rules and exact asset/operation/time/rate/budget binding; review existing ScopeGuard and RLS v3.12 requirements.
2. East durable identity, cancellation/fencing, stable replay-safe attempt reservations and outbox, including crash recovery.
3. Real container isolation with independent egress policy and resource caps. Existing Docker network-none tests in PR #283 certify neither a production sandbox nor an ExploitGym runtime.
4. License counsel review: ARTEX AGPL-3.0 source and network-use conditions, STRIDE-GPT MIT, ExploitGym Apache-2.0 code but externally licensed benchmark datasets.
5. Source verification of newer upstream patches, signed/build images, provider credentials isolated from sidecars, and output redaction.
6. Real iPhone-to-host flow, usable Activity/evidence review, cancellation and resumption, signed evidence review and independent scoring.

Product-direction permission is not a replacement for current authorization to test external assets. All three engines remain not connected until release gates are satisfied.
