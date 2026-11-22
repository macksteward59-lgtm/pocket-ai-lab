# Agent Coordination Gap Audit — 2026-11-16

**Branch:** `agent-coordination`  
**Scope:** Live review of the master requirements handoff, traceability baseline, native agent coordinator, native runtime composition, and current integration PR/CI evidence.  
**Audit type:** Evidence-backed checkpoint, not a declaration of product completion.

## Executive finding

The project has progressed from disconnected foundations toward an integrated native iOS product. The most important current work is the native Agent Team/runtime base (PR #156), the Director/APEX bridge integration (PR #164), and the isolated Grok Workspace/ExploitGym archive restoration (PR #165).

None of these is merged. PR #164's repaired exact-head iOS run #43981080474 completed successfully at 2026-11-17 00:14:27 UTC, and its two companion Intelligence checks also passed. This clears hosted CI for that exact PR head only; no physical iPhone Air acceptance or WebKit action bridge is established. PR #166 now records the separate trusted-dispatcher implementation contract.

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
| P0 | PR #164 hosted CI passed, but no physical iPhone Air acceptance | Install and run the exact integrated build on iPhone Air; verify local model import/load/token generation, cancellation/unload, offline operation, restart recovery, and device/runtime/model identity evidence |
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


**Audit correction (2026-11-17):** The original P0 row above was refreshed after the exact-head workflow reached terminal success; the historical run narrative is retained for audit chronology. The current remaining P0 is physical iPhone Air acceptance plus the unimplemented WebKit dispatcher. PR #166 is a documentation-only contract, not dispatcher implementation or runtime validation.


## 7. BridgeGate consequential-action hardening — PR #167

A focused fail-closed source change is now proposed in PR #167.

- Branch: codex/bridgegate-host-approval-hardening
- Exact head: e9418da92d6ed06afedc946dff97841f30002c4d
- Base: PR #164 exact head 6661bf655edef85e94fa1f363fcf54a33f20233c
- BridgeGate.parse no longer accepts a caller-provided consequentialAuthorized Boolean.
- importModel, loadModel, and unloadModel are denied unconditionally with authorizationRequired until a native host approval coordinator exists.
- Focused tests assert all three actions remain blocked.

PR #167 is draft. The exact-head workflow query returned no PR-triggered workflow runs, so this change is not yet CI-validated. It does not implement approval or WebKit dispatch and does not enable consequential actions. Keep it separate from PR #164 until its exact-head iOS tests pass and the mergeability state is understood.


## 8. PR #167 native CI routing gap

Exact-head check-runs for PR #167 head e9418da92d6ed06afedc946dff97841f30002c4d show Intelligence workflow run #43991447842 passing. This workflow validates the JavaScript/Node intelligence project, not the Swift Director bridge.

The iOS LlamaEngine workflow was not triggered because its pull_request target-branch filter lists main and codex/native-product-experience-integration, while PR #167 targets codex/bridge-native-runtime-integration. The Swift source and XCTest changes therefore remain unverified by iOS CI. PR #167's body now records this limitation. Do not merge or mark the native change validated based on the Intelligence check.

Required follow-up: establish a supported exact-head iOS CI route for stacked native PRs, then confirm the XCTest suite passes. Do not broaden triggers blindly or weaken workflow protections. Physical iPhone Air acceptance remains a separate gate.


## 9. CI trigger repair and replacement hardening PR #168

The stacked iOS CI routing gap was addressed on PR #164's branch by adding codex/bridge-native-runtime-integration to the iOS LlamaEngine workflow pull_request target-branch filter. Workflow change commit: 482b364cb362b86224c3399ce16ce51a1c06c738.

- Refreshed PR #164 iOS run #43991837435 started and was in the pinned llama.cpp build stage at the last checkpoint.
- Fail-closed BridgeGate hardening was rebased onto the updated PR #164 head as draft PR #168, exact head ab6f290702018023edaec800f59bfec422f24bc9.
- PR #168 adds unconditional denial of importModel/loadModel/unloadModel absent native host approval, regression tests for all three, and test coverage that BridgeChallengeStore.invalidateAll revokes every outstanding challenge.
- PR #168 iOS LlamaEngine run #43991941724 started and was in runner setup at the last checkpoint. Wait for exact-head completion and inspect XCTest results before marking validated.
- PR #167 is closed as superseded, not merged. Continue only with PR #168.

The trigger repair does not itself validate the change. Hosted iOS CI is still distinct from physical iPhone Air acceptance, and the WebKit dispatcher/host approval coordinator remain unimplemented.


## 10. Exact-head bridge CI refresh and source gap recheck — 2026-11-17

Rechecked the current exact-head jobs for PR #168 and PR #164 and inspected the native workspace/bridge source.

- PR #168 head `ab6f290702018023edaec800f59bfec422f24bc9`, run [#43991941724](https://github.com/macksteward59-lgtm/pocket-ai-lab/actions/runs/43991941724): job remains `in_progress` at “Build pinned llama.cpp for the simulator and macOS”. Setup, checkout, Xcode display, CMake/Ninja install, and pinned artifact restore passed. Swift typecheck, native app build/XCTest, simulator XCTest, and GGUF/macOS smoke steps have not yet run.
- PR #164 head `482b364cb362b86224c3399ce16ce51a1c06c738`, run [#43991837435](https://github.com/macksteward59-lgtm/pocket-ai-lab/actions/runs/43991837435): pinned llama.cpp build, fail-closed Swift typecheck, generic iOS engine link, simulator selection passed. Simulator boot remains in progress; bridge manifest validation, app build/XCTest, simulator XCTest, and GGUF/macOS smoke remain pending.
- PR #168 patch inspection confirms the caller-controlled `consequentialAuthorized` Boolean is removed and `importModel`, `loadModel`, and `unloadModel` are unconditionally denied with `authorizationRequired`. Tests cover all three denials and challenge-store `invalidateAll()` behavior. No approval mechanism is implemented.
- Source recheck of `ios/PocketAILab/WorkspaceView.swift` confirms `PrivateWorkspaceWebView.Coordinator` implements only `WKNavigationDelegate`; no `WKScriptMessageHandler`/reply handler is registered in `WKWebViewConfiguration`. Thus no page-to-native message dispatcher is installed.
- `BridgeChallengeStore` remains a host-side primitive. `RuntimeController.generate` validates the nonce's format and records it in the unsigned generation candidate; it does not consume or independently validate the challenge. The future dispatcher must consume the challenge against the frame-derived trusted origin, request UUID, and runtime session before invoking generation. Direct controller invocation with a well-formed fabricated nonce is not challenge-authorized.

No PR was merged, no consequential action was enabled, and no physical iPhone Air acceptance is claimed. Next implementation remains a separately reviewed WebKit dispatcher with main-frame/origin/schema checks, one-use consume-before-generate, teardown invalidation, and negative/replay/expiry tests; consequential operations stay blocked until a parameter-bound native approval coordinator exists.


## 11. Follow-up exact-head CI checkpoint — 2026-11-17

A later poll confirms the PR #168 and PR #164 native workflows remain active, with additional completed gates:

- PR #168 exact head `ab6f290702018023edaec800f59bfec422f24bc9`, run [#43991941724](https://github.com/macksteward59-lgtm/pocket-ai-lab/actions/runs/43991941724): pinned llama.cpp build, fail-closed Swift typecheck, and generic iOS engine link passed. Simulator boot is in progress. Bridge package validation, app build/XCTest, simulator XCTest, GGUF download, macOS XCTest, and runner evidence remain pending. Companion Intelligence run #43991924464 passed.
- PR #164 exact head `482b364cb362b86224c3399ce16ce51a1c06c738`, run [#43991837435](https://github.com/macksteward59-lgtm/pocket-ai-lab/actions/runs/43991837435): pinned llama.cpp build, fail-closed typecheck, generic iOS link, simulator boot, bridge package manifest validation, and native app build passed. Native app XCTest is in progress; simulator XCTest and GGUF/macOS smoke remain pending.
- PR descriptions #164 and #168 were refreshed with these exact-head checkpoints.

No overall native workflow pass, physical iPhone Air acceptance, WebKit dispatcher implementation, or PR merge is claimed.



## 12. Runtime challenge enforcement and CI stall recheck — 2026-11-17

A fresh source and workflow poll confirms the security boundary is still incomplete and the two native CI runs have not reached terminal conclusions.

### Exact-head workflow state
- PR #168 head `ab6f290702018023edaec800f59bfec422f24bc9`, run [#43991941724](https://github.com/macksteward59-lgtm/pocket-ai-lab/actions/runs/43991941724): job is `in_progress`; the latest job listing shows “Validate restored Director bridge package manifest” in progress. Native app build/XCTest, simulator XCTest, pinned GGUF download, macOS XCTest, and runner evidence remain pending.
- PR #164 head `482b364cb362b86224c3399ce16ce51a1c06c738`, run [#43991837435](https://github.com/macksteward59-lgtm/pocket-ai-lab/actions/runs/43991837435): native app XCTest remains `in_progress`; simulator XCTest, pinned GGUF download, macOS XCTest, and runner evidence remain pending.
- The Actions run records' `updated_at` values have not advanced since the initial job starts. Treat both as potentially stalled/inconclusive. Do not mark them passed or failed without terminal evidence.

### Challenge-enforcement finding
Re-inspected `RuntimeController.swift`, `BridgeChallengeStore.swift`, `BridgeGate.swift`, `WorkspaceView.swift`, and the XcodeGen `ios/project.yml` on PR #168's exact head.

- `BridgeChallengeStore.consume` correctly enforces origin/request/session binding, expiry, and one-use consumption when it is called.
- `RuntimeController.generate` does not hold or call the challenge store. It checks only that `challengeNonce` is a well-formed token and then copies it into `RuntimeGenerationRecord`.
- Existing runtime-controller XCTest fixtures call `generate` directly with fabricated nonce strings, demonstrating that challenge consumption is not currently a mandatory controller/dispatch precondition.
- `PrivateWorkspaceWebView.Coordinator` remains navigation-only; `WKWebViewConfiguration` registers no script message handler.
- `ios/project.yml` includes the ApexBridge source and tests in the native app/test targets, so a focused native dispatcher can be added through the existing app/package composition, but lifecycle/session injection must be identified before implementation.

### Required implementation order
1. Introduce a host-owned generation authorization boundary that consumes the one-use challenge against the origin derived from WebKit frame metadata, the request UUID, and the active runtime session **before** invoking native generation.
2. Ensure no public generation entry point can bypass that boundary with a nonce-shaped string. Adapt existing tests to issue and consume genuine host challenges; add direct-bypass regression coverage.
3. Install a main-frame-only WebKit message/reply handler. Reject subframes, foreign origins, malformed/unknown fields, oversized payloads, replay, expiry, wrong request/session, and navigation/session teardown.
4. Invalidate outstanding challenges on navigation, workspace teardown, and runtime session replacement.
5. Keep import/load/unload denied until a separate native approval coordinator binds the exact action and parameters to a one-use host approval. Do not conflate this approval with signing, receipts, attestation, or APEX authorization.

No code was changed in this audit update. No PR was merged, no consequential action was enabled, and no physical iPhone Air acceptance is claimed.


## 13. Mandatory runtime challenge consumption — PR #169 — 2026-11-17

A focused implementation follow-on now enforces challenge consumption inside the native RuntimeController rather than relying on a future caller to remember to consume the store.

- PR: [#169](https://github.com/macksteward59-lgtm/pocket-ai-lab/pull/169), draft/open.
- Branch: `codex/runtime-challenge-enforcement`.
- Exact head: `47a2a63bfb3eea8755746a67b052298ee3b8efb0`.
- Base: PR #168 branch `codex/bridgegate-host-approval-hardening-ci`, exact base `ab6f290702018023edaec800f59bfec422f24bc9`.
- `RuntimeController` now requires a host-owned `BridgeChallengeStore` and trusted workspace URL at construction. Each generation call includes page URL context; before inference starts, the controller consumes the challenge against the trusted origin, request UUID, and active runtime session. Failure returns `unauthorizedChallenge`.
- Existing runtime tests now use host-issued challenges. New regression coverage rejects fabricated nonce strings and replays of a consumed challenge.
- Exact-head iOS LlamaEngine run [#43995918805](https://github.com/macksteward59-lgtm/pocket-ai-lab/actions/runs/43995918805) started. At first poll the job was in runner setup / Show Xcode; no Swift typecheck or XCTest gate had completed. Await exact-head workflow completion.
- This closes the direct RuntimeController bypass identified in the previous audit. It does not install the WebKit message handler: the future dispatcher must derive the origin from `WKScriptMessage.frameInfo.securityOrigin`, reject subframes, and pass host-verified frame context. The page URL parameter is context, not independent proof of origin.
- Import/load/unload remain blocked by PR #168. No approval coordinator, signing, receipts, attestation, APEX authorization, physical iPhone Air acceptance, or merge is claimed.

Implementation review still required: verify all native controller construction sites and the exact-head Swift/XCTest results; then implement the frame-derived WebKit dispatcher and lifecycle invalidation as a separate reviewed slice.


## 14. PR #169 fixture correction, CI routing, and shared-runtime integration gap — 2026-11-17

### Exact-head correction and validation
- PR #169's first iOS run [#43995918805](https://github.com/macksteward59-lgtm/pocket-ai-lab/actions/runs/43995918805) failed at native app XCTest compilation because three tests still destructured the old five-element `makeFixture` tuple after it began returning `BridgeChallengeStore` as a sixth element. The compiler diagnostics identified lines 245, 263, and 416 in `ApexBridgeTests.swift`.
- Corrected those three destructurings to ignore the unused sixth value. Commit `c984e102c6e7c851252888a9599999780b523710`.
- The Intelligence workflow for that commit [#44017778362](https://github.com/macksteward59-lgtm/pocket-ai-lab/actions/runs/44017778362) completed successfully.
- A workflow routing gap was found: iOS LlamaEngine CI's `pull_request.branches` filter contained PR #168's base branch but not PR #169's base branch `codex/bridgegate-host-approval-hardening-ci`. Added that base branch to the allowlist.
- Workflow routing fix commit `c727342a1485846a94190cc3c2cd19729fb75e6f`. This triggered the exact-head iOS workflow [#44066457735](https://github.com/macksteward59-lgtm/pocket-ai-lab/actions/runs/44066457735), now in progress. At the latest poll it was restoring pinned llama.cpp artifacts; Swift typecheck, native app build/XCTest, simulator XCTest, GGUF/macOS smoke, and runner evidence remain pending. Do not claim PR #169's iOS validation passed until the full run is terminal-success.

### Newly identified integration blocker: two independent native runtime owners
- `LocalChatModel` in `ios/PocketAILab/LocalChatView.swift` privately constructs and owns its own `NativeInferenceRuntime`, `ModelPoolLease`, selected catalog model, and local chat lifecycle.
- `WorkspaceView` currently constructs a standalone `PrivateWorkspaceWebView`; it does not receive a shared runtime service, selected model/session, or runtime controller. `RootView` independently instantiates `LocalChatView` and `WorkspaceView` as separate tabs.
- Therefore, installing a WebKit message handler alone would not connect the web workspace to the already-active local chat runtime. Creating another RuntimeController/runtime inside WorkspaceView would create a second ownership path and risk duplicate model loads, conflicting ModelPool leases, and inconsistent readiness/session state.
- Before implementing WebKit dispatch, refactor the app composition around one app-scoped native runtime/session service (or an explicitly designed adapter over the existing LocalChatModel runtime and lease). Both Local AI and Workspace must consume that same authoritative service. Preserve one ModelPool lease owner, one readiness contract, and the existing file-hash/session checks.
- Then inject a host dispatcher into the WebView. Derive origin only from `WKScriptMessage.frameInfo.securityOrigin`, require main-frame messages, validate strict BridgeGate schema and payload bounds, issue one-use challenges natively, and call the same runtime service. Invalidate challenges on navigation, teardown, model/session replacement, and workspace close.

### Security boundary unchanged
- PR #168 still denies import/load/unload. No consequential action is enabled.
- The RuntimeController challenge check consumes a one-use host challenge before inference, but the `pageURL` argument is not itself proof of WebKit origin. Only a host dispatcher that supplies frame-derived context can close that trust boundary end-to-end.
- No signing, receipts, device attestation, APEX authorization, merge, or physical iPhone Air acceptance is claimed.

### Required next sequence
1. Finish exact-head PR #169 iOS workflow and resolve any compiler/test failures.
2. Design and test the app-scoped shared runtime/session service; migrate LocalChatModel without changing inference behavior or ownership semantics.
3. Inject the same service into WorkspaceView and define the narrow bridge protocol for status, model listing, readiness, generation, cancellation, and unload. Keep import/load/unload blocked pending native approval.
4. Add the frame-derived main-frame WebKit dispatcher and lifecycle challenge invalidation with negative, replay, expiry, wrong-origin, wrong-session, and navigation tests.
5. Run exact-head iOS CI and then perform physical iPhone Air acceptance separately.


---

## 15. Live refresh — 2026-11-17

### 15.1 PR #169 exact-head CI reconciliation

The first PR #169 iOS run, #43995918805, failed during native app XCTest compilation. The job log identifies three stale tuple destructuring sites in `ApexBridgeTests.swift`: the fixture had been extended to return six values including `BridgeChallengeStore`, while three tests still destructured five. The simulator XCTest, GGUF download, and macOS XCTest steps were skipped after this compile failure.

This failure was not a runtime authorization bypass or a llama.cpp build failure. The current branch includes the corrected six-element destructuring. A subsequent workflow on exact current head `c727342a1485846a94190cc3c2cd19729fb75e6f`, run #44066457735, completed with conclusion **success**. This clears hosted iOS workflow validation for that exact head only. It does not establish physical iPhone Air acceptance, WebKit dispatch, native approval coordination, signing, receipts, attestation, or full APEX authorization.

### 15.2 Remaining native integration blocker: runtime ownership

The current board identifies a deeper architecture issue: `LocalChatModel` owns a private `NativeInferenceRuntime` / `ModelPoolLease`, while `WorkspaceView` has no shared runtime/session injection. Do not create a second runtime owner in `WorkspaceView`. The next integration change must establish one app-scoped runtime/session service shared by Local AI and Workspace, with one lease owner and a consistent readiness/file-hash contract. Only after that should the trusted main-frame WebKit dispatcher and challenge lifecycle be integrated.

Required dispatcher acceptance remains:
- Derive origin from `WKScriptMessage.frameInfo.securityOrigin`, not a page-provided string.
- Reject subframes and non-trusted origins.
- Validate strict message schemas and bind one-use challenges to origin, request UUID, active runtime session, and expiry.
- Invalidate outstanding challenges on navigation, session replacement, disconnect, and teardown.
- Keep import/load/unload denied until a native approval coordinator exists.
- Preserve APEX as the sole authorization authority and test fabricated, expired, wrong-binding, replayed, and subframe messages.

### 15.3 Advanced Security Research scope addition

Added `docs/requirements/ADVANCED_SECURITY_RESEARCH_REQUIREMENTS.md` and section 19 of the master checklist. The scope includes Operation Triangulation as a defensive historical case study and program-specific bounty research such as Microsoft Windows Insider Preview. It requires exact target/build scope, safe-harbor and exclusion checks, provenance, isolated sample handling, independent validation, APEX authorization, and East/e3 durable execution. This is a requirements baseline only; no active testing or exploit execution is authorized or claimed.

### 15.4 Coordination discipline

The `agent-coordination` branch remains documentation-only. Application implementation belongs on isolated feature branches with exact-head CI and review. The master checklist and traceability ledger remain evidence-driven; no broad requirement is marked verified solely because a PR exists or hosted CI passes.


---

## 16. App-scoped runtime ownership decision — 2026-11-17

A source-level review of `ios/PocketAILab/LocalChatView.swift`, `WorkspaceView.swift`, `PocketAILabApp.swift`, `RuntimeController.swift`, and `NativeInferenceRuntime.swift` confirms the following:
- `LocalChatModel` constructs its own `NativeInferenceRuntime` and retains a `ModelPoolLease`.
- `WorkspaceView` constructs a `WKWebView` but does not install a script-message handler or receive an app-scoped runtime/session dependency.
- `RuntimeController` can own exact leases when instantiated with a runtime, but the app composition root does not yet connect that controller to the Local AI runtime.
- Each `NativeInferenceRuntime` owns its own ModelPool and InferenceScheduler; a second instance is a second resource authority.

Added `docs/architecture/ADR-001-app-scoped-native-runtime-ownership.md` to define a single app-scoped composition root and session/lease owner. This is a proposed architecture decision and implementation plan, not an implemented code change.

Next implementation sequence:
1. Establish one stable app-lifetime runtime container.
2. Move model/session/lease transitions behind one service shared by Local AI, Workspace, Runtime Status, and evaluation.
3. Add the WebKit dispatcher only after shared ownership is in place.
4. Derive origin and main-frame status from WebKit frame metadata, issue/consume one-use host challenges, and invalidate them on navigation/disconnect/session replacement/teardown.
5. Preserve APEX authorization; import/load/unload remain denied pending native approval coordinator.
6. Prove single runtime/pool/scheduler/lease ownership in tests, then run hosted CI and physical iPhone Air acceptance separately.


---

## 17. Phase A implementation — app-scoped runtime composition — 2026-11-17

Created isolated feature branch `codex/app-scoped-runtime-composition`, stacked on the exact PR #169 head branch. Draft PR #171 adds:
- `NativeRuntimeComposition`, held by the SwiftUI root for app lifetime, constructs one `NativeInferenceRuntime` / ModelPool / InferenceScheduler.
- Explicit runtime dependency injection into `LocalChatView` and `LocalChatModel`; the production view initializer now requires a dependency rather than silently creating a per-view runtime.
- A fail-closed unavailable dependency path; it does not retry construction of a second runtime when app-level initialization fails.
- A two-consumer XCTest that checks one engine model load through the shared pool and eventual single session unload.
- A second XCTest that confirms unavailable app runtime initialization does not fall back to a per-view runtime.

CI routing: the iOS workflow's base-branch allowlist did not initially include the PR #169 branch, so PR #171 could not receive the native workflow. Added `codex/runtime-challenge-enforcement` to that allowlist on the PR #169 branch in commit `3666c01a629219b22b9313cb770b6246f082217d`. Exact PR #171 head is `3459a989e68ebb89a4324a9b7fc026ab04d5ea41`; iOS LlamaEngine run #44092708116 and Intelligence CI run #44092697374 are in progress at this refresh. A superseded earlier iOS run was cancelled after a newer head was pushed; that is not a test failure.

This is not completion of ADR-001. `LocalChatModel` still retains its lease; the shared lease/session service, Workspace injection, Runtime Status snapshots, RuntimeController/challenge-store composition, WebKit frame-derived dispatcher, lifecycle invalidation, native approval coordinator, and physical iPhone Air acceptance remain open. Preserve APEX as the sole authorization authority and keep consequential bridge actions fail-closed.


---

## 18. Phase A refinement — centralized session lease ownership — 2026-11-17

Extended PR #171 with `NativeModelSessionService` on `codex/app-scoped-runtime-composition`. The service owns exact `ModelPoolLease` values keyed by consumer UUID. `LocalChatModel` no longer owns a mutable lease handle; it resolves its active lease through the shared service. Releasing one consumer no longer attempts to unload a model while another consumer still has a lease. The service unloads only after the final active lease is released and reports unload failures distinctly.

Current PR #171 head: `be517ff613ff822fe649623ffe36ea0512b1dcab`. Current exact-head validation: Pocket AI Lab CI run #44093487773 and iOS LlamaEngine CI run #44093503567 are in progress; previous native workflow attempts on superseded heads were cancelled and are not counted as failures or passes.

Remaining ADR-001 gaps: Workspace does not yet receive the shared service; Runtime Status still reports compile-time probe information rather than live app-scoped pool/scheduler snapshots; RuntimeController and BridgeChallengeStore are not yet composed with the same runtime/session authority; WebKit has no script-message dispatcher; challenge invalidation and native approval coordinator remain outstanding. Physical iPhone Air acceptance is still required. This update does not mark Phase A fully accepted until exact-head CI completes.

---

## 19. Phase B — WebKit challenge-gated generation on app-scoped runtime — 2026-11-17

The active follow-on is PR #174 (`codex/webkit-readonly-dispatcher-rebased`), stacked on PR #171's updated app-scoped runtime branch at `90b4e2b408fd98d418bff729c8e8d208fe13463f`. PR #173 was closed as superseded because the parent branch advanced after the first follow-on was opened. PR #172 was already closed as superseded when PR #171's concurrent runtime-composition work was discovered.

### Implemented in PR #174

- Injects the existing app-scoped `LocalChatRuntimeDependency` into Workspace; no second `NativeInferenceRuntime`, ModelPool, or scheduler is constructed.
- Adds a read-only `NativeModelSessionService.activeLeases()` inventory. Workspace only attaches a Director `RuntimeController` lease after Local AI already holds a lease for the selected catalog descriptor. The controller obtains a second consumer lease from the same ModelPool, and the dispatcher requires exact equality of `RuntimeSession.id` between the controller lease and Local AI lease before readiness or generation. A matching model ID alone is insufficient.
- Installs a `WKScriptMessageHandlerWithReply` under the fixed `pocketAILab` name in the `.page` content world. Origin comes from `WKScriptMessage.frameInfo.securityOrigin`; main-frame only; strict `BridgeGate.parse`; rejects foreign origins, unknown fields/actions, malformed values, and payloads above 40 KiB.
- Supports read-only `getRuntimeStatus` and `listModels`, native `checkReadiness`, host-only `authorizeGeneration`, challenge-gated `generate`, and drained `cancelGeneration`.
- `authorizeGeneration` issues a host-owned one-use challenge only after readiness is true. Challenge binds origin, request UUID, and exact runtime session. `RuntimeController.generate` consumes it before inference.
- Generation returns an unsigned `RuntimeGenerationRecord` candidate with `authorized == false`. This is not a signed receipt, APEX authorization, device attestation, or proof of trust.
- Import/load/unload remain rejected by BridgeGate until a separate parameter-bound native approval coordinator exists.
- Navigation invalidates all outstanding challenges and cancels/drains active generation. Session replacement invalidates challenges and disconnects the prior controller lease. WebView teardown removes the message handler, invalidates challenges, cancels/drains work, and releases the controller lease without unloading a model still leased by Local AI.
- `RuntimeController` re-hashes the model off actor before readiness and generation, comparing against the load-time SHA-256. This supplements file size/modification-time identity and detects same-size mutation with restored timestamps.
- Tests cover trusted frame/origin, schema and size limits, exact shared-session equality, real readiness probe, host challenge issuance/consumption, replay rejection, navigation invalidation, same-size model tampering, cancellation drain, and teardown.

### Validation snapshot

Exact PR #174 head at this update: `48a6fabea107cc587327bf1782caef14aeefdab7`. Intelligence CI passed; iOS LlamaEngine CI #44112233207 is running at pinned llama.cpp build. The earlier iOS run #44093929443 failed XCTest compilation due three app-scoped runtime fixture issues (two initializer argument-order errors and one missing runtime dependency); those fixtures were corrected in the parent PR #171 branch and carried into the clean follow-on. Prior Pocket AI Lab CI #44111500667 passed on an earlier `ac29e06` head, not the current exact head. Do not treat these as final validation until the current exact-head jobs complete.

### Remaining bridge gates

1. Confirm exact-head native app build, XCTest, simulator XCTest, pinned GGUF/macOS smoke gates, and workflow runner evidence.
2. Test expiry, wrong-origin, wrong-session, wrong-request, replay, navigation, teardown, and session replacement end-to-end against the host dispatcher.
3. Complete the native approval coordinator for import/load/unload with parameter-bound, one-use approvals. Keep those actions denied until then.
4. Integrate APEX authorization and Ed25519 signed evidence receipts as a distinct authority. The generation record remains unsigned and `authorized == false`.
5. Verify actual model inference, cancellation, thermal/memory behavior, and app lifecycle on the physical iPhone Air. Hosted CI and simulator success are not device acceptance.

No PR merged and no physical iPhone Air acceptance claimed.

## 20. Phase C — Workspace frontend client for the native iOS bridge — 2026-11-17

PR #175 (`codex/workspace-native-chat-client`) is stacked on PR #174 and adds the web-side client without changing the native dispatcher authority.

Implemented:
- Optional `apps/web/nativeBridge.js` detects the fixed WKWebView `pocketAILab` message handler and uses UUID-correlated request/reply envelopes.
- Client enforces per-action field allowlists, rejects unknown fields/actions, validates response correlation, and bounds prompt size and generation options.
- A native chat turn obtains runtime status and selected catalog model, requires a matching active Local AI lease, requests a real readiness probe, obtains a host-issued one-use challenge, and then submits generation. The client verifies the returned runtime session ID.
- In the iOS WKWebView, the Chat composer uses native generation. If the native bridge exists but the model is not loaded or native generation fails, it does not silently fall back to server inference.
- In ordinary Safari/desktop browsers where no native handler exists, the existing server-backed llama.cpp route remains unchanged.
- Added the bridge script to the HTML shell and service-worker offline cache. Added a Stop control: native chat records the exact active session/request UUID and calls the dispatcher cancellation route, which awaits native cancellation/drain. Node tests cover action/schema restrictions, challenge sequencing, missing lease, session mismatch, prompt/options bounds, exact-request cancellation, and static/offline serving.

Boundaries:
- This currently wires the ordinary Chat composer only. Agent Team remains on the existing server-backed task endpoint pending a separate native Agent Team bridge contract.
- The JS helper is not an authorization authority; native `BridgeGate`, `BridgeChallengeStore`, and `RuntimeController` remain authoritative.
- No import/load/unload action is exposed by this frontend client.
- No signed evidence, APEX approval, device attestation, or physical iPhone Air acceptance is implied.

Validation snapshot:
- PR #175 exact head `4381df81ed0305a96cded87c78c9e446369c5893`; exact-head CI #44113067640 passed JavaScript syntax, TypeScript build, and the full web test suite.
- PR #174 native exact head `48a6fabea107cc587327bf1782caef14aeefdab7`; Intelligence CI passed, iOS LlamaEngine CI #44112233207 is running at pinned llama.cpp build.
- These hosted workflows are not physical device acceptance.


## 7. Current coordination and source-recovery update — 2026-11-17

### M01–M42 inventory

The current master checklist contains all 42 original module names and IDs. The final entries are:

- M41 — Cybersecurity Risk Management
- M42 — Secure Software Development Lifecycle (SSDLC)

The inventory-name recovery is complete. The following remain blocked pending the original source: complete verbatim descriptions, the exact mapping of all 42 modules to the six canonical layers, and per-module T0–T4/permission assignments. Do not infer these from names or from the separate four-group conceptual view. The six layer names and global tier labels are documented, but they do not establish per-module assignments.

### Focused TypeScript and OWASP PR validation

- PR #180 current head `419e006ca0ad5ed40386b540ba4bc7e4b46681e4` is 1 ahead / 0 behind `agent-coordination` head `8025680f732a55b00b52e07e765c1d6d25bd200b`. Its exact-head workflow #44153786406 completed successfully. Its three-file scope is limited to the TypeScript test runner, package scripts, and focused tsconfig.
- PR #181 current head `9956428091446d9408b765b19c2881cec0edd7bd` is 1 ahead / 0 behind the same base and changes nine OWASP knowledge files. No exact-head workflow run exists for #181. The successful #180 run is not evidence for #181's catalog/context tests.
- PR #181's context builder is reference-only and is not yet integrated into `Orchestrator.executeTask()`. No OWASP reference material grants tool permissions or execution authority.

### Scope and status

This update does not change the 316-row traceability counts except for the single M01–M42 inventory requirement moved from blocked to partial. It does not mark any requirement verified. The current master checklist and traceability matrix remain separate authorities. No application implementation, APEX policy, East behavior, native runtime, PR merge/closure, or physical iPhone Air acceptance is changed or implied.


## 8. Follow-up source retrieval and CI dependency — 2026-11-17

A further retrieval attempt for the original November 1 conversation source returned no complete M01–M42 descriptions and no exact per-module layer or T0–T4 mapping. The November 1 context does identify the live app files as `src/components/compliance/console.tsx`, `src/lib/compliance/providers.ts`, `src/lib/compliance/modes.ts`, `src/lib/compliance/director.ts` (described as Director and the 42 checks), and `src/lib/compliance/orchestrator.ts`. These are leads for targeted repository/history inspection, not evidence of the missing mappings.

The current TypeScript test workflow is introduced on PR #180 and is not yet in the shared base. PR #181's OWASP test files therefore have no exact-head hosted workflow run. Keep PR #181's status validation-blocked until the workflow is available from the base and runs on its exact head, or until an independently authorized validation mechanism is established. Do not copy the workflow into PR #181 merely to manufacture a run; that would create ownership overlap.


---

## 21. Live repository refresh — 2026-11-17

This section supersedes older status snapshots above where exact PR heads or CI states have advanced. It is a documentation-only reconciliation.

### Current bridge/runtime chain

| PR | Current head | Exact-head CI evidence | Current interpretation |
|---|---|---|---|
| [#164](https://github.com/macksteward59-lgtm/pocket-ai-lab/pull/164) | `482b364cb362b86224c3399ce16ce51a1c06c738` | iOS LlamaEngine run [#43991837435](https://github.com/macksteward59-lgtm/pocket-ai-lab/actions/runs/43991837435) completed success | Hosted CI passed on current head; still no physical iPhone Air acceptance or WebKit action dispatch in this PR. |
| [#168](https://github.com/macksteward59-lgtm/pocket-ai-lab/pull/168) | `ab6f290702018023edaec800f59bfec422f24bc9` | iOS LlamaEngine run [#43991941724](https://github.com/macksteward59-lgtm/pocket-ai-lab/actions/runs/43991941724) completed success | Fail-closed import/load/unload denial and challenge-store invalidation tests have hosted native CI evidence on this head; no approval coordinator is implemented. |
| [#169](https://github.com/macksteward59-lgtm/pocket-ai-lab/pull/169) | `3666c01a629219b22b9313cb770b6246f082217d` | iOS LlamaEngine run [#44092562693](https://github.com/macksteward59-lgtm/pocket-ai-lab/actions/runs/44092562693) completed success | Mandatory challenge consumption in RuntimeController has hosted native CI evidence on this head; this does not establish trusted WebKit frame origin by itself. |
| [#171](https://github.com/macksteward59-lgtm/pocket-ai-lab/pull/171) | `90b4e2b408fd98d418bff729c8e8d208fe13463f` | No PR-triggered run was returned for this exact head in the current check | App-scoped runtime/session composition remains a critical integration prerequisite; do not transfer older-head CI evidence. |
| [#174](https://github.com/macksteward59-lgtm/pocket-ai-lab/pull/174) | `e3105b9985e44e687524dd08e32080705d9d4b0f` | iOS LlamaEngine run [#44161238097](https://github.com/macksteward59-lgtm/pocket-ai-lab/actions/runs/44161238097) is pending | Challenge-gated WebKit dispatcher is the active native integration path. Wait for exact-head completion before claiming validation. |
| [#175](https://github.com/macksteward59-lgtm/pocket-ai-lab/pull/175) | `4381df81ed0305a96cded87c78c9e446369c5893` | Exact-head web CI [#44113067640](https://github.com/macksteward59-lgtm/pocket-ai-lab/actions/runs/44113067640) passed | Workspace native chat client is web-tested, but its recorded base is PR #174's earlier head `48a6fabea107cc587327bf1782caef14aeefdab7`; reconcile its dependency against PR #174's current head before treating the stack as current. |

The native chain remains draft/open. Hosted checks are not physical-device acceptance. Do not enable import/load/unload, infer APEX authorization, or claim signed evidence from these PRs.

### Current OWASP/test-runner dependency

- PR [#180](https://github.com/macksteward59-lgtm/pocket-ai-lab/pull/180) current head `fe25b0a43151f71c23ee8d673788a18187e019c8`; exact-head Intelligence TypeScript Tests run [#44159541367](https://github.com/macksteward59-lgtm/pocket-ai-lab/actions/runs/44159541367) completed success. This validates only its focused test-runner scope.
- PR [#181](https://github.com/macksteward59-lgtm/pocket-ai-lab/pull/181) current head `46894868049c124808a06e7d0a4d94b89ca82cd1`; no PR-triggered workflow run was returned for this exact head. Keep its OWASP tests validation-blocked. PR #180's successful run is not transferable evidence, and the OWASP context builder remains reference-only rather than integrated into `Orchestrator.executeTask()`.

### Source-recovery status

The October 29 response metadata still confirms that the original assistant response contains M01–M42 descriptions and layer mappings, but the actual message body has not been recovered into the repository. The later 44-entry/five-layer catalog remains a separate taxonomy and must not be substituted. No missing description, layer assignment, tier, permission class, or approval rule was reconstructed.

No requirement status was promoted to verified, no PR was merged, and no application or authorization behavior was changed by this refresh.


---

## 22. Workspace web-client cancellation repair and stack replacement — 2026-11-17

### PR #174 current native dispatcher gate
- PR #174 current fetched head: `beac6964aa4eda8d370b32ffa3ae565745b4e062`, based on PR #171 head `90b4e2b408fd98d418bff729c8e8d208fe13463f`.
- Exact-head iOS workflow [#44161924371](https://github.com/macksteward59-lgtm/pocket-ai-lab/actions/runs/44161924371) is queued at this refresh; no native acceptance is claimed.
- The preceding dispatcher lifecycle fixes include synchronous lifecycle-generation advancement, a navigation-cleanup barrier, and deterministic stale-session-resolution regressions. These changes remain subject to the current exact-head native workflow.

### PR #185 replaces the stale Workspace web-client stack
- PR: [#185](https://github.com/macksteward59-lgtm/pocket-ai-lab/pull/185), draft/open.
- Branch: `codex/workspace-native-chat-client-rebased`.
- Exact head: `8c3dc8708cdfca354cecdc33d84b8d4cf430821f`.
- Base branch: `codex/webkit-readonly-dispatcher-rebased`, exact base at creation `beac6964aa4eda8d370b32ffa3ae565745b4e062` (PR #174 head at that time).
- Six-file web client change is carried forward from PR #175; no native dispatcher, runtime, APEX, signer, receipt, or authorization files are changed.
- Fixed cancellation handoff by registering the AbortSignal listener before native generation dispatch, rechecking the signal after registration, and invoking the UI `onRequest` callback only after the native request is dispatched. Thus a synchronous abort from `onRequest` reaches the already-installed listener and sends cancellation for the exact request.
- Added a deterministic test that aborts synchronously inside `onRequest`, checks `generation_cancelled`, and verifies the cancellation request uses the exact session/request UUID.
- At this refresh no PR-triggered workflow run was returned for PR #185's exact head. Do not mark its tests passed until exact-head web CI completes.

### Stale PR #175
- PR #175 remains open/draft at head `4381df81ed0305a96cded87c78c9e446369c5893`, still based on old PR #174 commit `48a6fabea107cc587327bf1782caef14aeefdab7`.
- Compare against PR #174 current head at this refresh shows the branches diverged: PR #175 is 10 commits ahead and 29 behind. It does not include the latest native dispatcher/runtime hardening and contains the reported cancellation race.
- PR #185 is the replacement candidate. Do not merge PR #175; keep it open until PR #185's exact-head validation and stack review are complete, then close/supersede deliberately.

No PR was merged. No physical iPhone Air acceptance is claimed. No APEX authorization, signing, or consequential bridge action was added.


### PR #185 exact-head CI result — 2026-11-17

- PR #185 head `8c3dc8708cdfca354cecdc33d84b8d4cf430821f` completed Pocket AI Lab CI [#44162270273](https://github.com/macksteward59-lgtm/pocket-ai-lab/actions/runs/44162270273) with conclusion **success**. The job completed dependency installation, JS syntax checks, TypeScript build, and the repository's configured `npm test` command.
- PR #185's base remains PR #174's current fetched head `beac6964aa4eda8d370b32ffa3ae565745b4e062`; PR #174 native workflow #44161924371 remains in progress. Thus the web slice is green, but the complete native+web stack is not yet validated.
- The cancellation fix's regression test is included in the full npm test run. This is hosted CI only, not physical iPhone Air acceptance.


## 22. Native dispatcher navigation cancellation race


## Native Workspace bridge navigation cancellation review — 2026-11-17

- Refreshed PR #174: current head `e159dee0c381ef61a2f311a53f44969988159cbe`, base PR #171 head `90b4e2b408fd98d418bff729c8e8d208fe13463f`. The exact-head iOS run [#44163444351](https://github.com/macksteward59-lgtm/pocket-ai-lab/actions/runs/44163444351) is pending; no result is claimed.
- Source review confirmed the lifecycle-generation/navigation-cleanup barrier around dispatcher session resolution and challenge issuance. The new RuntimeController tests cover disconnect and caller cancellation while challenge consumption is suspended.
- A remaining race is reported on PR #174: navigation does not disconnect the RuntimeController session. If a request has already consumed its challenge but is suspended in the post-consumption file hash before it registers in `ActiveSession.generations`, navigation's `cancelAllGenerations()` may see no registered generation and return; the request can then proceed to inference. The dispatcher's post-call epoch check only suppresses the reply. A deterministic dispatcher-to-controller navigation test and cancellation barrier are requested before enabling this path.
- PR #185 remains open/draft at head `8c3dc8708cdfca354cecdc33d84b8d4cf430821f`, but its base is still `beac6964aa4eda8d370b32ffa3ae565745b4e062`, now one commit behind PR #174. Rebase/reconcile it onto the eventual reviewed #174 head and rerun exact-head web CI; do not treat the stack as current or merge either PR.
- No application code was changed in this coordination pass. No merge, APEX authorization, signed receipt, or physical iPhone Air acceptance is claimed.


## 23. Native generation cancellation epoch and test coverage


## Native bridge cancellation epoch review — 2026-11-17 (latest refresh)

- PR #174 current head is `18bcb49848c22f0c697a82ab0a4415ba92da03cf`, base PR #171 head `90b4e2b408fd98d418bff729c8e8d208fe13463f`. The prior exact-head run #44163444351 was cancelled after the branch advanced. Current exact-head iOS run [#44163980153](https://github.com/macksteward59-lgtm/pocket-ai-lab/actions/runs/44163980153) is in progress: pinned llama.cpp build, fail-closed Swift typecheck, and physical-device framework link passed; simulator boot is active; app build, app XCTest, simulator XCTest, and GGUF smoke steps remain pending.
- Latest source now adds a RuntimeController generation lifecycle epoch. `cancelAllGenerations()` advances it synchronously before awaiting drain, and `generate()` checks the captured epoch after challenge consumption and again after the post-challenge model-file hash. The deterministic `testCancelAllInvalidatesGenerationSuspendedDuringChallengeConsumption` proves cancellation while challenge consumption is paused and asserts zero non-readiness inference calls.
- Review follow-up on PR #174 requests one additional deterministic regression for the distinct second suspension window: allow challenge consumption to succeed, pause the post-challenge file hash, complete `cancelAllGenerations()`, resume the hash, and assert cancellation plus zero native inference calls. The implementation contains the post-hash epoch check, but this exact test was not present in the inspected test file.
- PR #185 remains draft/open/unmerged at head `8c3dc8708cdfca354cecdc33d84b8d4cf430821f`, still based on old PR #174 head `beac6964aa4eda8d370b32ffa3ae565745b4e062`; current PR #174 is `18bcb49848c22f0c697a82ab0a4415ba92da03cf`. PR #185's recorded base remains the older #174 commit and must be rebased/reconciled onto the current reviewed #174 head, then exact-head web CI rerun before treating the stack as current. GitHub currently reports the PR's mergeability flag as true; that flag does not mean its stack is up to date or validated against the latest native commits.
- PR #185's exact-head web run [#44162270273](https://github.com/macksteward59-lgtm/pocket-ai-lab/actions/runs/44162270273) remains green across dependency installation, JavaScript syntax, TypeScript build, and configured npm tests. This does not validate native integration.
- No application code was changed in this coordination pass. No PR merged, no signed evidence/APEX authorization claimed, and no physical iPhone Air acceptance established.


## 22. Native bridge post-challenge hash regression and current CI — 2026-11-17

PR #174 now includes `testCancelAllInvalidatesGenerationSuspendedDuringPostChallengeFileHash` at commit `b6a9b68c4c6e3ffee2ec0a41c08518b2784b1a0c`. Source inspection confirms it pauses the post-consumption file hash, completes cancellation while no native generation task is registered, resumes hashing, expects cancellation, verifies one-use challenge replay rejection, asserts zero native inference calls, and checks the shared model lease remains held. The previously identified post-hash test-coverage gap is therefore closed in source, pending exact-head execution. Exact-head iOS workflow #44166303330 is in progress; prior run #44166043070 on the preceding commit was cancelled. PR #185 is 1 commit ahead / 7 behind the current PR #174 base and must be reconciled before stack acceptance. No physical iPhone Air acceptance, signed evidence, or APEX authorization is claimed.


## 23. Current PR reconciliation and prioritized gaps — 2026-11-17

### Verified in this refresh

- PR #174 current head: `ce07e17f917c283ef1b13b548ee554601ffc10fe`. The post-challenge file-hash cancellation test from commit `b6a9b68c4c6e3ffee2ec0a41c08518b2784b1a0c` is in the branch. A later unannounced commit on the same branch adds an overlapping navigation-cleanup barrier test in a different test file. Latest exact-head iOS run #44167047921 is still in progress; prior run #44166303330 was cancelled after branch advancement.
- PR #162 current head: `be8f014ce90bce6266aae4ee64d76f353c7d08ff`. New test covers durable `uncertain=true` and no auto-reclaim after restart for expired single-attempt side effects. No exact-head workflow or combined status exists.
- PR #132 real PostgreSQL 16 integration run #43846062218 succeeded for the migration, row-lock/CAS, namespace isolation, rollback, concurrent stale-writer behavior, and actual TypeScript adapter. This is ephemeral CI database validation, not production database or RLS evidence.
- PR #135 exact-head iOS run #43797547712 succeeded through pinned llama.cpp, app build, app XCTest, simulator XCTest, GGUF setup, and macOS XCTest. PR #157, #159, and #164 exact-head iOS runs #43957233723, #43957567346, and #43991837435 also succeeded on hosted infrastructure.

### Prioritized gaps

1. **PR #174/#171 native bridge integration:** finish exact-head run #44167047921 and inspect every app/simulator/macOS test result. PR #171 is the base and currently reports non-mergeable with no exact-head workflow; reconcile that base before treating PR #174 as integration-ready. Keep generation disabled until all cancellation, navigation, shared-lease, and fail-closed tests pass.
2. **East/e3 ownership and persistence:** PR #162's new uncertainty regression is unverified because its exact head has no workflow/status. Add real PostgreSQL coverage for worker-owner persistence and foreign-worker completion to the existing PG16 integration path; the current #162 fake-DB test does not prove that boundary. Preserve the distinction between worker fencing and authentication/authorization.
3. **East production crash recovery:** the lifecycle adapter still uses checkpointed task/message state, not an append-only event log. Provider cancellation propagation, provider idempotency/result retrieval or transactional outbox, durable MemoryStore, tenant RLS, and production PostgreSQL/TLS/backup/key operations remain open. No production DB/RLS claim.
4. **Workspace web client stack:** PR #175 and #185 are stale against current PR #174. Rebase the better #185 candidate and rerun web tests against the exact current native base; do not merge the stale PRs.
5. **Native catalog/self-evaluation integration:** PR #135 hosted validation is green, but PR #133 is 4 commits behind current PR #115 and has no exact-head run. PR #115's current iOS run was cancelled after app XCTest; simulator and GGUF/macOS smoke did not finish. Reconcile catalog and evaluation on one current base, then re-run the full native matrix.
6. **Integration branch duplication:** PR #157/#159 diverge 84 ahead / 27 behind; PR #131/#132 diverge 17 ahead / 10 behind. Preserve the best validated mainline candidate and cherry-pick only reviewed, non-overlapping changes; do not combine either pair wholesale.
7. **Physical device:** no signed iPhone Air archive/install, on-device generation, memory/thermal/battery acceptance, or offline acceptance evidence is present. Hosted macOS and simulator results are not physical-device results.
8. **Historical security framework source:** full verbatim prior chats were not available in this run. The current accessible chat context is summary-level. The source-recovery audit still lacks the October 29 full M01–M42 descriptions and exact six-layer/module tier-permission assignments; do not infer mappings.

### Coordination and safety

- The current coordination records contain a single ChatGPT ownership claim for the WebKit dispatcher and East owner-fencing work. A new same-branch PR #174 commit appeared without a separate active-agent announcement; this run stopped editing that branch after detecting the concurrent advance. No repository instruction was treated as authority to bypass security.
- No open GitHub issues were returned in the repository search. Repository metadata reports public. No merge, main-branch edit, settings/secrets/visibility change, deployment, production database action, or physical-device test occurred.
- Accessible project-history sources were the current conversation, summary-level prior context, the consolidated product handoff, the source-recovery audit, coordination board/log, master requirements and traceability docs, and live GitHub PR/commit/CI records. Full verbatim historical ChatGPT conversations were not accessible.

## November 22, 2026 — Owner vision compared with demonstrated improvements

The owner asked for one teachable, offline-first iPhone workspace. They want to give it an incomplete objective, get an inspectable first draft, see what evidence changed the draft, and come back later without re-explaining the project. APEX governance, East/e3 continuity, ExploitGym evaluation, and a companion that keeps the owner's tasks separate from the agents' queue all belong to this vision. The decisive missing demonstration is one owner task that carries its identity, permissions, sources, review, and corrections through interruption and return to the phone. [Consolidated owner handoff](POCKET_AI_LAB_COMPLETE_PRODUCT_HANDOFF_2026-11-17.md)

| Requirement from the conversations | Improvement with evidence | What would justify the larger claim |
| --- | --- | --- |
| One workspace, five modes, eight permanent roles plus specialists. PAL-00-001, PAL-24-005, PAL-24-006, PAL-24-009 | The combined checkout includes the native client, OpenClaw review, Activity, Memory, and a Cloudflare note service. A human-supervised review completed. [Integration record](CLOUD_AGENT_HANDOFF.md) | Observe one owner-facing task carried by real providers, with a separately attributable review and disagreement visible to the owner. |
| Offline-first personal device. PAL-07-015, PAL-08-007, PAL-24-003 | The unsigned kit rebuilt for arm64 iOS. The simulator exported six cases and twelve OS readings with a mock provider. Three Linux runs of the pinned 1.5B model scored 4/6 each. [Kit and measurements](../docs/evidence/source-recall/device-server-v1/resource-samples/README.md) | Record offline generation, actual app memory and heat, interruption and successful reopening on the signed iPhone Air. Server RSS cannot set the phone's memory budget. |
| APEX permissions, East/e3 continuity, evaluated results, and a cloud partner. PAL-14-008, PAL-14-011, PAL-15-011, PAL-24-008 | Cloudflare retained a revisioned work order and its supervised Linux result. The private engineering note was read at revision 6. GitHub contains the related code and evidence. [Cloud round trip](../docs/evidence/source-recall/device-server-v1/README.md#live-cloudflare-round-trip) | For a benign source-review task, observe a restart and retry returning one result under the same task identity, with its authorization intact. An unattended Cloudflare model run and a measured stop with 30% capacity left were not evidenced. That reserve was requested for the research assignment. |
| Durable teaching, memory, and source-grounded research. PAL-09-006, PAL-09-008, PAL-09-014, PAL-10-007 | A reviewed source register and citation-preserving history exist. On five retrieval questions the 3B model scored 3/5 exactly and declined both unknowns. In the separate six-question Linux check, the 1.5B model twice gave the correct balance but omitted its source label. [Retrieval and raw answers](../docs/evidence/source-recall/device-server-v1/README.md#from-a-question-to-a-retrieved-passage) | Correct one source-backed fact, reopen on the phone, and show that a later answer uses the correction and cites its origin. Longer-term memory and backup/restore need their own evidence. |
| Create, evaluate, and improve. PAL-09-012, PAL-11-005, PAL-24-010 | On one ordinary coding task the candidate passed 7/20 held-out cases against 4/20 for the starting version. The recorded repair was incomplete. [Frozen repair study](evidence/tool-workshop-repair-2026-11-21/README.md) | Demonstrate repeatable gains on independently fixed ordinary tasks and retain failed candidates. The study cannot establish general learning or competitive bounty performance. |
| Six layers, 42 modules and the original access-control contract. PAL-05-001, PAL-05-003, PAL-05-005 | The historical record recovered the layer titles and M01–M42 names and IDs. [Framework recovery](HISTORICAL_SECURITY_FRAMEWORK_SOURCE_RECOVERY.md) | Recover original descriptions and exact layer/tier assignments and reconcile the v3.12 access-control text. A recovered name establishes inventory only. |
| G.I.R.L. and experimental model communication. PAL-GIRL-013, PAL-GIRL-014 | The project records native capture and encoding. A separate frozen macOS recipient benchmark returned zero valid answers in 36 attempts. [Representation handoff](GIRL_GEOMETRIC_LATENT_INTEGRATION_2026-11-19.md) · [Apple run](https://github.com/macksteward59-lgtm/pocket-ai-lab/actions/runs/44986761973) | Evidence of useful shared meaning would require a recipient result that improves a predefined benign task over ordinary text. That benchmark did not establish it. |

**Release and source coverage.** GitHub showed open draft PRs [#258](https://github.com/macksteward59-lgtm/pocket-ai-lab/pull/258), [#259](https://github.com/macksteward59-lgtm/pocket-ai-lab/pull/259), [#260](https://github.com/macksteward59-lgtm/pocket-ai-lab/pull/260), and [#261](https://github.com/macksteward59-lgtm/pocket-ai-lab/pull/261). Both #259 and #261 build on #258. #260 builds on #259. There is no single release demonstrated by those four PRs. At review, main was `fb59f76` and coordination was `91a6dce`. The [requirements matrix](../docs/requirements/POCKET_AI_LAB_REQUIREMENTS_TRACEABILITY.md) counts 212 unassessed, 85 implemented but unverified, 38 partial and 9 blocked entries. Its 344 entries are a historical ledger. Converting those counts into a product-completion percentage would misstate both the later evidence and the outstanding hardware work.

The comparison uses the visible owner instructions, recovered excerpts from Project and other conversations, the November 21 research materials, the branch evidence, and the private note readback. Recovery did not yield a full transcript of every conversation. Cloudflare documents support for scheduled tasks and Apple documents the limitations of simulator performance measurements. Those vendor capabilities do not attest to a Pocket AI Lab deployment or a physical-device run. [Cloudflare scheduling](https://developers.cloudflare.com/agents/agent-class/schedule-tasks/) · [Apple simulator guidance](https://developer.apple.com/library/archive/documentation/IDEs/Conceptual/iOS_Simulator_Guide/TestingontheiOSSimulator/TestingontheiOSSimulator.html)

**First end-to-end proof to prioritize.** Give the phone one benign question about an approved project document. Keep the task ID and cited draft, interrupt the session, and reopen it. Have an independent reviewer check the draft, correct a fact if needed, and verify the correction and citation in a later session. Record the actual device and provider, the approval decision, and whether a retry created a duplicate. If the optional cloud leg runs, record actual usage and the single returned result separately. This exercise is a proposed acceptance test.

## Owner recovery across full app termination — November 22, 2026

[Draft #262](https://github.com/macksteward59-lgtm/pocket-ai-lab/pull/262) at `12d511f2` recovered a corrected source answer after full app termination in the iOS simulator. Re-import retained one record. The owner-facing export, original server reply and independently copied digest matched in the shipped reader. A live Cloudflare note retained the result after a repeated save. Hardware inference, hosted Workers AI and the frozen model-quality gate remain open. [Full project check, test results and device kit](https://github.com/macksteward59-lgtm/pocket-ai-lab/blob/agent-coordination/docs/evidence/source-recall/device-server-v1/owner-recovery/README.md).
