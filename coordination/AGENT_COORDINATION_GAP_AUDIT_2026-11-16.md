# Agent Coordination Gap Audit — 2026-11-16

**Branch:** `agent-coordination`  
**Scope:** Live review of the master requirements handoff, traceability baseline, native agent coordinator, native runtime composition, and current integration PR/CI evidence.  
**Audit type:** Evidence-backed checkpoint, not a declaration of product completion.

## Executive finding

The project has progressed from disconnected foundations toward an integrated native iOS product. The most important current work is the native Agent Team/runtime base (PR #156), the Director/APEX bridge integration (PR #164), and the isolated Grok Workspace/ExploitGym archive restoration (PR #165).

None of these is merged. PR #164's repaired exact-head iOS run has advanced through native app build/XCTest, iOS simulator XCTest, pinned-GGUF download, and smoke-path setup; macOS XCTest is currently in progress and runner evidence is pending. The workflow remains in progress, and no physical iPhone Air acceptance is established.

The requirements traceability matrix remains the authoritative audit ledger. Its last recorded baseline is 316 requirements: 184 unassessed, 85 implemented-unverified, 37 partial, 10 blocked, zero verified, and zero missing. This audit does not silently change those counts or mark broad requirements complete based on PR descriptions.

## 1. Confirmed implementation evidence

### 1.1 Native Agent Team — PR #156

Exact base/head recorded for the current stack: `31bdc57b8812243279097899fecd2c938a96e78f`.

Inspected source includes:
- `runtime/ios/Sources/PocketLlamaEngine/NativeAgentCoordinator.swift`
- `runtime/ios/Tests/LlamaEngineTests/NativeAgentCoordinatorTests.swift`
- `runtime/ios/Sources/PocketLlamaEngine/ModelPool.swift`
- `runtime/ios/Sources/PocketLlamaEngine/NativeInferenceRuntime.swift`
- `ios/PocketAILab/LocalModelCatalog.swift`
- `ios/PocketAILab/LocalAgentTaskHistoryStore.swift`

Confirmed capabilities:
- Typed native agent steps and linked message envelopes.
- Sequential role execution with a bounded plan (maximum eight steps).
- Per-role model routing when routed profiles are supplied.
- Exact ModelPool lease acquisition/release around routed generation.
- Shared NativeInferenceRuntime and scheduler path.
- Bounded task, prompt, output, token, and capability inputs.
- Cancellation checks and cancellation-drain handling.
- Local model catalog metadata with SHA-256 identity and operator-selected routing labels.
- Local Agent Team task history with bounded retention; a task found running after app restart is marked interrupted rather than automatically resumed.
- Focused tests for message linkage, invalid plans, empty output, and bounds.

Important limitations:
- Native role execution is sequential, not parallel independent inference.
- The current app composition configures one resident model and one concurrent request; this is not evidence that the iPhone can safely host multiple models simultaneously.
- Capability labels are routing metadata, not permissions.
- Local task history is an audit/history store, not the durable East/e3 execution queue.
- The inspected history behavior intentionally does not auto-resume interrupted tasks.
- These source findings do not prove all eight roles have independently configured, verified model profiles in a real on-device run.
- PR #156's recorded iOS run #43957027828 concluded failure, with the exact failing step/cause not established by the available job record. Four companion workflows passed; they do not substitute for iOS validation.

### 1.2 Director/APEX native bridge — PR #164

Exact head: `6661bf655edef85e94fa1f363fcf54a33f20233c`; stacked on PR #156.

The PR description records:
- ApexBridge Swift package and strict BridgeGate origin/action/schema validation.
- Host-owned, one-use BridgeChallengeStore challenge primitive bound to origin, request UUID, runtime session, and expiry.
- Actor-isolated RuntimeController over the shared NativeInferenceRuntime and ModelPoolLease.
- Hash checks, readiness probes, health expiry, cancellation drain, and exact lease release.
- Unsigned generation candidates only; no signer, receipt, attestation, or APEX authorization is created.
- XcodeGen app target integration and same-origin navigation checks.

Critical remaining bridge gap:
- No WKScriptMessageHandler or Web-to-native action dispatch is installed.
- No runtime-control action is enabled.
- Host-side approval coordination remains a prerequisite.
- Challenge storage exists as a primitive but is not connected to WebKit dispatch.
- Additional security detail confirmed by source inspection: `RuntimeController.generate` validates only the challenge nonce's string format and records it in the unsigned candidate; it does not call `BridgeChallengeStore.consume` or independently prove nonce binding/one-use/expiry. Therefore the future trusted host dispatcher must consume the nonce and validate the exact origin, request UUID, and runtime session before it calls `generate`. Direct calls to the controller with a fabricated but well-formed nonce are not challenge-authorized.
- Therefore this is not yet a complete working web/native action bridge and must not be described as one.

Current exact-head CI evidence:
- Run #43981080474 remains reported in progress overall; its native app build and native app XCTest steps have now completed successfully.
- Pinned llama.cpp simulator/macOS build, fail-closed Swift typecheck, generic iOS engine link, simulator selection/boot, Director bridge package validation, and native app build for simulator and generic iOS targets have passed.
- Native app XCTest completed successfully on the exact head.
- iOS engine simulator XCTest has completed successfully. The pinned smoke GGUF download and path setup have also completed successfully. macOS XCTest is now in_progress; final runner evidence remains pending.
- Companion Intelligence CI #43981072947 passed on the exact PR head.
- The overall iOS run remains in_progress. Simulator tests and GGUF setup are green, but macOS XCTest and final runner evidence are not complete; do not claim an overall workflow pass or physical iPhone Air acceptance.
- Exact-head run #43981080474 subsequently reached a terminal `success` conclusion at 2026-11-17 00:14:27 UTC. The `ios-llamaengine` check is completed successfully, including macOS XCTest, runner-evidence recording, and post-job checkout. Exact-head PR checks now show iOS LlamaEngine success plus two Intelligence workflow successes (#43981072947 and #43983044172). This clears the hosted CI gate for this PR head only; it does not prove physical iPhone Air inference or complete WebKit bridge functionality.

### 1.3 Grok Workspace and ExploitGym archive slice — PR #165

Exact head: `b89d0bffd319ba940b17c50ee971fa1674dd541f`; base is PR #164 head.

Confirmed scope and evidence:
- Grok Workspace is restored as historical status/attachment metadata, not represented as live service health.
- ExploitGym is a pinned upstream Git submodule, isolated from the iOS runtime.
- Desktop archive collection excludes directory gitlinks and symlinks.
- Exact-head CI #43983284394 passed; desktop archive suite reports 17/17.
- PR #165 remains draft/open and stacked on PR #164.
- No ExploitGym benchmark workload was run.

Do not merge PR #160 wholesale: its recorded branch comparison is divergent (73 ahead / 230 behind) and it overlaps the bridge/runtime paths now isolated in PR #164. Preserve only its archive-specific work through the separate PR #165 path.

### 1.4 East worker ownership — PR #162

PR #162 adds worker ownership fencing to lifecycle attempts. Its previously recorded successful CI run is for an older head, not the current head `1db0345938ac029c3742a391c51ad7027d57e3bc`. No current exact-head run/status was surfaced in the coordination record. It remains unverified at current head. Its PostgreSQL concurrency test uses a deterministic fake adapter, not a live PostgreSQL/RLS deployment.

## 2. Priority integration gaps

| Priority | Gap | Required completion evidence |
|---|---|---|
| P0 | PR #164 exact-head iOS workflow is still running | Complete macOS XCTest and runner evidence on exact head `6661bf655edef85e94fa1f363fcf54a33f20233c`; investigate the runner-log `BlobNotFound` limitation if the job stalls; require an overall successful conclusion |
| P0 | Native bridge has no WebKit message/action dispatch | Trusted-origin handler, schema validation, one-use challenge consumption, approval coordination, deny/replay/expiry tests; no bypass of APEX |
| P0 | No physical iPhone Air acceptance | Signed/installable build, actual local model import/load/token generation, cancellation/unload, offline operation, restart recovery, device/runtime/model identity evidence |
| P1 | Agent collaboration is currently sequential | Explicitly accepted sequential operating design or separately tested bounded multi-session/parallel orchestration; demonstrate genuine distinct role inference and disagreement/revision |
| P1 | Local history is not durable East workflow execution | Connect task lifecycle/checkpoint/worker ownership/recovery with the native task UI without auto-replaying uncertain side effects |
| P1 | Resource budgets are not device measurements | Measure memory, KV cache, time-to-first-token, tokens/sec, thermal behavior, battery, cancellation recovery, and sustained multi-role workload on iPhone Air |
| P1 | Current model catalog metadata is not full model registry verification | Parse/verify GGUF metadata, compatibility, licenses/source, capabilities, context limits, quantization, runtime availability, and model hash |
| P1 | East worker-fencing current head lacks CI evidence | Fresh exact-head tests plus live ephemeral PostgreSQL integration for transaction/CAS behavior; production RLS remains a separate deployment gate |
| P1 | Six-layer M01–M42 registry source is missing | Recover the owner's authoritative original registry and preserve exact IDs/layer assignments; do not invent replacements |
| P2 | Dynamic specialist lifecycle and permission isolation need end-to-end proof | Register/instantiate/activate/suspend/resume/retire tests, per-specialist model/resource leases, scoped context, and no permission inheritance |
| P2 | Five operating modes need integrated behavior proof | Mode-specific routing, modules, review requirements, UI state, and policy checks for Collaborative, Security Analyst, Engineering, Learning, and Independent Review |
| P2 | Offline-first and remote-optional behavior need acceptance evidence | Airplane-mode tests for local chat/model/memory/task paths and explicit policy-controlled remote fallback |
| P2 | Four-layer memory acceptance remains broader than encrypted storage | Working/episodic/semantic/procedural behavior, provenance, correction, retrieval isolation, deletion/export, migration, restore, and restart tests |
| P2 | Evidence and authorization boundaries remain separate | Signed evidence, attestation, APEX approval, East execution, and human consent each independently verified; unsigned candidate data never promoted to authority |

## 3. Coordination and product-scope corrections

1. Keep `agent-coordination` documentation-only. Application code and tests remain on isolated feature branches and enter main through reviewed PRs.
2. Keep PR #156 as the native Agent Team/runtime prerequisite; PR #164 is stacked on it; PR #165 is stacked on #164.
3. Do not merge, retarget, or rewrite stacked PRs until their exact dependencies and checks are reconciled.
4. Do not treat PRs, branch names, UI labels, mock responses, or hosted compilation as evidence of production capability.
5. Keep the separate dual-node Ryzen/Snapdragon/Linux workstation project outside Pocket AI Lab until deliberately introduced as an authorized external compute adapter.
6. Preserve Director/APEX as authorization authority; agents and model outputs remain untrusted proposals.
7. Preserve East/e3 durable workflow responsibilities; local task history is not a replacement.
8. Keep ExploitGym host-side and isolated; no automatic benchmark or exploit workload execution.
9. The original M01–M42 registry remains blocked pending authoritative source recovery.

## 4. Next execution sequence

1. Recheck PR #164 exact-head run #43981080474 and its job/check state. macOS XCTest is the remaining active test gate, with runner evidence pending. Do not infer success until the overall workflow concludes; do not cancel or rerun without recording the state transition and reason.
2. Once #164 validation is resolved, review the complete native bridge diff and close the WebKit/approval integration gap in a separately scoped change with explicit tests.
3. Validate PR #156's native coordinator/runtime path against the real model smoke gates; inspect sequential multi-role output, exact per-role model identity, cancellation, lease release, and app history persistence.
4. Revalidate PR #165's dependency on the accepted #164 base; keep the archive slice isolated.
5. Refresh PR #162 current-head CI and add real ephemeral PostgreSQL integration coverage.
6. Continue requirement-by-requirement traceability. Do not change the 316-row status counts until individual rows are assessed with direct code/test/evidence links.
7. Recover the authoritative M01–M42 source from owner-provided files or project history before mapping modules.
8. Plan and execute physical iPhone Air acceptance after a valid installable build and owner-provided device/signing access.

## 5. Acceptance rule

A feature is complete only when its production path is integrated, the relevant tests pass on the exact commit, independent review is recorded, and the applicable target-environment evidence exists. For local inference, physical iPhone Air evidence is mandatory. Hosted CI and simulator checks are supporting evidence, not a substitute.


## 6. Trusted WebKit dispatcher follow-on — PR #166

A documentation-only follow-on has been opened to turn the bridge gap into an explicit implementation and acceptance contract.

- PR: [#166](https://github.com/macksteward59-lgtm/pocket-ai-lab/pull/166)
- Branch: `codex/webkit-bridge-dispatcher-contract`
- Exact head: `0ae7dafff95065d5a17c6c3caac98897a0cae43b`
- Base: PR #164 exact head `6661bf655edef85e94fa1f363fcf54a33f20233c`
- File: `docs/architecture/trusted-webkit-dispatcher-contract.md`

The contract requires a native host dispatcher to derive origin from `WKScriptMessage.frameInfo`, reject subframes and foreign origins, bind the request and runtime session to a host-issued challenge, consume that challenge exactly once before invoking generation, and invalidate pending challenges on navigation/session replacement/teardown. Import/load/unload remain disabled until explicit native approval bound to exact parameters. Page-supplied authorization booleans are prohibited.

PR #166 is draft and documentation-only. The exact-head workflow query returned no workflow runs, so there is no runtime/test validation claim. No WebKit handler has been implemented or enabled. This is not a complete bridge and does not change the status of PR #164's runtime implementation or physical iPhone Air acceptance.

The next code change must be a separately reviewed implementation with focused origin, frame, schema, challenge replay/expiry/binding, approval, cancellation, and teardown tests. The challenge must be consumed before generation; validation must not be an optional callback that callers can bypass.
