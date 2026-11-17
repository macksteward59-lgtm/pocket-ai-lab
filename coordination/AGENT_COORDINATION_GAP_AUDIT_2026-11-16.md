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
