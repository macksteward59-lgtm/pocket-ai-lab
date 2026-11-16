# Pocket AI Lab implementation status register

**Snapshot:** 2026-11-16  
**Acceptance target:** iPhone Air, 256 GB. Record the installed iOS version during physical acceptance.  
**Purpose:** Track the whole product by end-to-end capability and evidence, not by the number of open branches or commits.

## Product-level completion gates

| Capability | Current repository evidence | Status | Required completion evidence |
|---|---|---|---|
| Native application shell | Local AI, Workspace, Runtime; this integration adds encrypted Memory navigation | Integrated in draft PR #156 | Exact-head iOS app build/XCTest and physical install |
| Native local inference | Pinned llama.cpp/Metal backend, GGUF import, model catalog, content hash, ModelPool and scheduler | Implemented in code; CI/device acceptance pending | Exact-head package/app tests; actual iPhone Air model import and generation |
| Agent Team | Native coordinator, routed per-role profiles, durable role-message linkage; this integration replaces six hardcoded roles with eight catalogue roles and specialist selection | Integrated in draft PR #156 | Exact-head tests; actual local eight-role run and specialist-route fail-closed test |
| Agent task history | Local task journal and role-message linkage | Implemented as local history; not a durable distributed task lifecycle | Restart/corruption/retention tests; link to East task IDs and correlated evidence |
| Encrypted native memory | AES-GCM vault, Keychain device-only key, explicit CRUD/provenance, no automatic ingestion | Integrated in draft PR #156 | App XCTest, physical lock/unlock/restart checks, documented backup/recovery |
| Automatic model selection | Operator-configured capability labels and deterministic candidate routing exist | Partial; no measured device-aware Automatic policy | Device memory/thermal/context/readiness measurements, selection rationale and safe unavailable behavior |
| Multi-agent knowledge integration | Eight logical roles and specialist templates | Partial; memory is not retrieved into context | Consent-based retrieval, provenance, relevance, retention, deletion and cross-agent context tests |
| Durable East/e3 lifecycle | Lifecycle kernel and East adapter work in PRs #94/#103; PostgreSQL store PR #131 and validation PR #132 | Partial, unmerged | Transactional production adapter, migration, leases, idempotency, cancellation, restart and fault-injection tests |
| APEX authorization/evidence | Existing authorization/evidence modules and separate proof verifier PR #83 | Partial integration | End-to-end approved/denied actions with independent APEX decision, signed evidence and replay tests |
| ExploitGym | Isolated evaluation workstream exists in repository | Not integrated into native task lifecycle | Synthetic workload execution, isolation, quotas, reproducibility and no escape tests |
| Cloud provider | Explicit per-message consent path in draft PR #152 | Local prototype only | Server-side secret lifecycle, authentication, privacy review, network failure tests and no silent cloud fallback |
| Offline/recovery | PWA shell caching and local native data stores | Partial | Offline task queue/restart recovery, interrupted-run handling, storage pressure and migration tests |
| Release engineering | GitHub workflows and generic iOS device compile/link gate | Not release-ready | Signing, install, upgrade/rollback, privacy/security review, performance and device acceptance |

## Integration stack

- **Native app candidate:** PR #156 is the unified mainline candidate. It contains the dependency stack from #146/#148/#150 plus the catalogue and encrypted-memory changes. It remains draft and must not be treated as merged or release-ready.
- **Earlier native slices:** #150/#151 routed Agent Team; #153 encrypted memory; #154 catalogue; #155 catalogue mainline validation. Their implementation is reconciled into #156; retain the original PRs until #156 exact-head validation and review are complete.
- **Durable task lifecycle:** #94 and #103 are lifecycle foundations; #131 adds a PostgreSQL transactional store on #103; #132 is its mainline validation aggregate. These remain a separate critical integration stack.
- **Cloud consumer prototype:** #152 is explicitly consented cloud chat; it is not part of the offline native runtime.
- **Runtime proof and import:** #83 and #84 are merged/ready foundations; the remaining runtime proof-to-native-app integration still needs device evidence.

## Next execution order

1. **Stabilize unified native candidate #156:** get exact-head Pocket AI Lab, Consumer, Governance, Cursor, and iOS LlamaEngine checks; fix all compiler/test failures; remove duplicate feature-branch ambiguity after validation.
2. **Complete native model policy:** implement Automatic over runtime-verified local catalog entries using device memory, context, task capability, measured latency, and thermal/resource state. Cloud remains opt-in and never silently substitutes for offline inference.
3. **Join native tasks to durable East lifecycle:** define one task identity and event/evidence correlation contract; connect task creation, role messages, cancellation, checkpoints and recovery to the East store without allowing model output to authorize dispatch.
4. **Close APEX/East vertical slice:** route only explicitly scoped, independently approved actions through existing authorization; record denial, approval, execution and repair as separate attributable events.
5. **Integrate memory deliberately:** add user-controlled retrieval and context injection with provenance, bounded context budgets, retention/deletion semantics, and no auto-promotion to verified.
6. **Integrate ExploitGym and evaluation:** run only isolated/synthetic workloads, preserve reproducible evidence, and keep evaluation scores separate from authorization.
7. **Release acceptance:** offline/restart, privacy, security, storage, memory/thermal/performance, signing, upgrade/rollback, and iPhone Air physical test matrix.

## Current exact-head CI snapshot (2026-11-16)

- **Unified native candidate #156**, head `09207c1c2a9ea94ff351eb7e6ed999a91a8a7d07`: Pocket AI Lab CI `43923738084` passed; Consumer prototype CI `43923737874` passed; Governance sidecar CI `43923737750` passed; Cursor collaboration plugin CI `43923737795` passed; iOS LlamaEngine CI `43923737970` is still in progress building the pinned llama.cpp simulator/macOS artifacts. Native app build and XCTest have not yet been reached in that job.
- **Whole-product execution candidate #157**, head `44c8e936ee1cb336e5290fcdeba1c1f9df08e12c`: Pocket AI Lab push CI `43923985317` passed. PR-triggered companion workflows are pending observation. No production database, physical device, or end-to-end authorized action has been tested.

## Evidence rules

- A commit is implementation, not validation.
- A draft PR is not merged.
- A generic iOS arm64 build is compile/link evidence, not an installed app.
- A hosted simulator is CI evidence only, not iPhone Air acceptance.
- A model catalog entry is not proof of load or generation.
- Agent role labels and model output do not grant permissions or create APEX receipts.
- A task-history record is not a durable East transaction unless the transactional store and recovery path are actually used.
- Every release claim must link the exact commit, workflow runs, test results, physical device/iOS version, and unresolved risks.
