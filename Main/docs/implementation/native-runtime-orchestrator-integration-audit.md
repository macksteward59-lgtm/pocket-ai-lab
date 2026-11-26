# Native inference ↔ intelligence orchestrator integration audit

**Baseline:** `main` at `9dde1ee16874b4b4802dd92e94605dd5fb92bc2d`  
**Branch:** `codex/native-runtime-agent-bridge`  
**Scope:** Integration and lifecycle audit; no APEX/East authorization changes.

## Executive finding

The repository contains both a native Swift inference engine and a TypeScript multi-agent orchestrator, but it does not currently demonstrate an end-to-end path in which the TypeScript agent runtime invokes the native iOS engine and receives runtime-backed session evidence.

There are two separate working paths:

1. **Native single-model chat:** `ios/PocketAILab/LocalChatView.swift` directly creates `LlamaCppMetalBackend(requireMetal: true)`, imports a GGUF into the app's private Documents/Models folder, loads a Swift `RuntimeSession`, and calls `generate`. This is a real native path when the linked llama.cpp/Metal build is present. It is not an agent-team path.
2. **TypeScript agent lab:** `apps/web/server.mjs` composes `LlamaCppInferenceProvider` with `runtime/lab/session.ts`. The provider talks to an external loopback `llama-server` over HTTP. The lab assembles AgentManager, ModelRegistry, ModelRouter, MessageBus, DeliberationEngine, and MemoryManager itself. It does not invoke the Swift `LlamaEngine` or instantiate the main `Orchestrator`.

The native SwiftUI app does not currently compose the TypeScript orchestrator, and the TypeScript orchestrator does not have a native Swift inference adapter. The current implementation should therefore be described as **native local chat plus a separate loopback agent-team runtime**, not as an integrated on-device multi-agent platform.

## Verified implementation facts

### Native Swift path

- `runtime/ios/Sources/PocketLlamaEngine/LlamaEngine.swift` defines `LlamaEngine.load/generate/cancel/unload`, `RuntimeSession`, `LlamaCppMetalBackend`, `PlaceholderLlamaEngine`, and `LoopbackLlamaEngine`.
- The linked Metal backend verifies that llama.cpp is linked, validates the model path, probes Metal, opens the GGUF, and retains a native session. It returns generated text only after a non-empty decode.
- `LocalChatView` uses the native backend directly and explicitly treats output as untrusted. Importing a model only copies it; loading is a separate action.
- The app's `RuntimeStatusView` reports build/link and Metal probe facts. It does not report an agent-orchestrator connection.
- `runtime/ios/Tests/LlamaEngineTests/SmokePath.swift` defaults to no smoke model and `required = false`. The documentation says macOS CI can run a pinned GGUF smoke test, but no physical iPhone run is recorded.
- `docs/implementation/ios-llamaengine-gate2.md` explicitly says the repository does not record a physical iPhone run and that simulator/host CI is not device acceptance.

### TypeScript agent path

- `packages/intelligence/orchestrator/Orchestrator.ts` requires an injected `InferenceProvider`; this is a good composition boundary and the orchestrator states that model output is untrusted proposal data.
- `runtime/adapters/llama-cpp/LlamaCppInferenceProvider.ts` implements that TypeScript interface using an HTTP backend. It does not call Swift or the iOS app's native engine.
- `apps/web/server.mjs` creates that provider from a loopback llama-server URL.
- `runtime/lab/session.ts` assembles its own agent runtime. Its model resource provider currently reports a fixed 8192 MB and no loaded models; this is a local harness assumption, not a live iOS memory/session report.
- `ModelRegistry` stores descriptors and agent preferences. It does not verify that a model file is loaded.
- `ModelRouter` accounts for memory reservations. A reservation is not proof that a backend session exists.
- `AgentManager.startSession` creates a task-scoped orchestration record with an agent ID, task ID, and model ID. It does not bind that record to a native `RuntimeSession`.

## Integration blockers and risks

### 1. No cross-runtime provider bridge

There is no Swift-backed implementation of the TypeScript `InferenceProvider`, no documented IPC contract between the iOS app and the TypeScript orchestrator, and no composition root proving that the agent team uses the native model session.

**Consequence:** A working native Local AI chat screen cannot be used as evidence that multi-agent orchestration is running on-device.

### 2. Model routing is not runtime readiness

The current TypeScript registry/router can select a configured descriptor and reserve estimated memory without querying a native runtime. `getResources` is injected and may be a static estimate. The router must not be used as a source of truth for loaded/ready state.

**Change in this branch:** Reservations now behave as reference-counted route leases. Multiple concurrent agent routes to the same model retain one memory reservation until every route releases it. Externally loaded models remain owned by the runtime/resource provider. Regression tests cover shared leases, release order, external ownership, descriptor estimate changes, and malformed resource reports.

### 3. Loopback load is health-bound, not model-bound

`LoopbackLlamaEngine.load` validates the descriptor and checks that `GET /health` reports ready, then creates a local `RuntimeSession`. The health response does not prove that the server loaded the requested model ID, file hash, context size, or runtime instance.

**Consequence:** A loopback session is a client-side readiness handle, not cryptographic or process-level proof of the requested model. Do not treat it as satisfying the native readiness contract.

### 4. Native session evidence is incomplete

The Swift `RuntimeSession` currently contains only an ID and model ID. It does not expose a content hash, runtime build identity, load timestamp, expiration, generation counter, or signed generation receipt. The current engine interface is suitable for local inference, but it is not yet the accepted readiness/evidence contract.

**Consequence:** UI status, model file presence, a successful health check, or a model registry entry must not be promoted into a verified runtime receipt.

### 5. Cancellation and overlapping generation need hardening

The native backend tracks a generation UUID, but the current cancellation path does not compare the supplied request ID with the active generation before cancelling the session. The implementation also needs an explicit per-session policy for overlapping generations and deterministic cleanup of generation state on success, failure, cancellation, and unload.

**Required tests:** stale cancellation cannot cancel a newer request; a session cannot run overlapping decode operations unless the backend explicitly supports them; unload waits for or safely cancels in-flight native work; completion and all error paths release the active-generation marker.

### 6. Physical-device acceptance is still absent

A green macOS workflow, simulator compile, Metal probe, or host smoke test does not prove that the installed iPhone app loads the pinned GGUF, executes Metal, streams/returns output, survives memory pressure, or behaves under thermal and Low Power Mode constraints.

## Recommended integration architecture

Do not make llama.cpp, a model, or an agent an authority. Keep the current trust separation and introduce a narrow, typed runtime adapter boundary:

```text
SwiftUI App
  └─ Native Runtime Controller
       ├─ Model File Store (hash + size + private path)
       ├─ LlamaEngine (load / generate / cancel / unload)
       ├─ Runtime Session Registry (session + model hash + build identity)
       └─ Native Inference Adapter
             ⇅ typed request/result protocol
       Agent Orchestrator
         ├─ AgentManager
         ├─ ModelRegistry / ModelRouter (selection, not readiness)
         ├─ DeliberationEngine
         ├─ MessageBus
         ├─ MemoryManager
         └─ APEX/East boundary (separate authorization decision)
```

There are two viable implementation strategies. Choose one explicitly before coding the bridge:

- **Native-first orchestration:** implement the agent orchestration coordinator in Swift against a language-neutral request/message contract, while preserving the TypeScript orchestrator for web/desktop. This avoids embedding a JavaScript runtime in the iOS app, but requires parity tests to prevent behavior drift.
- **Embedded TypeScript runtime:** bundle the TypeScript orchestrator as JavaScript and host it in an iOS JavaScript runtime, exposing a narrowly scoped native inference adapter. This maximizes code reuse but introduces packaging, async bridging, lifecycle, debugging, and runtime-version complexity.

Do not silently mix the two approaches or make the iOS app depend on a desktop `llama-server`.

## Required native runtime contract

Before connecting the orchestrator, define a runtime state machine and stable DTOs:

- `Unavailable`: backend absent, disconnected, or failed verification.
- `Available`: backend is linked and can accept a load request; no model is claimed loaded.
- `Loading`: a specific model file hash is being loaded.
- `Ready`: a live runtime session is bound to the model ID, file SHA-256, runtime build/pin, device/runtime instance, context configuration, and an expiry/lease.
- `Generating`: a unique request ID is executing within that session.
- `Failed`: typed failure with no synthetic output.
- `Unloaded`: session invalidated; model file may remain on disk.

The adapter must reject stale session IDs, stale model hashes, expired readiness leases, duplicate/overlapping generation requests, and cancellation IDs that do not match the active request. Disconnect or app restart invalidates readiness while preserving the model file.

Generation output is untrusted content. It may enter a typed agent message only after schema validation. It cannot create an approval, authorize an action, write a receipt, change trust state, or bypass Director/East. Device runtime attestation and server-side attestation remain distinct evidence sources.

## Acceptance gates

1. **Contract tests:** language-neutral DTO schemas, state transitions, invalid/stale IDs, hash mismatch, expiry, and cancellation behavior.
2. **Native engine tests:** load/unload/reload, one in-flight generation per session, request-scoped cancellation, error cleanup, and deterministic session invalidation.
3. **Adapter tests:** agent request maps to exactly one native generation; output maps to an untrusted typed result; failures never produce messages that look like successful output.
4. **Orchestrator tests:** the same task runs through injected fake provider and native provider adapter with identical stage/message validation; model readiness must come from runtime evidence, not registry metadata.
5. **Resource tests:** memory accounting includes active leases, actual model loads, context/KV-cache cost, and release after all tasks; no static 8192 MB value is used as iOS device truth.
6. **Device acceptance:** physical iPhone load and generation, actual device/Metal evidence, memory pressure, thermal behavior, app background/foreground, interruption, and Low Power Mode.
7. **Governance regression:** every test continues to assert that model output, agent consensus, runtime readiness, and a valid signature alone do not imply APEX authorization.

## Explicit non-goals

- No changes to APEX trust roots, approvals, receipts, RLS, East authorization, or evidence issuance.
- No treating model registry entries, UI labels, HTTP health checks, or estimated memory as proof of a loaded native model.
- No remote endpoint fallback without an explicit policy and separate server-attestation contract.
- No claim that a physical iPhone test has passed.
