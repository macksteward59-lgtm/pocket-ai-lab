# ADR-001: App-Scoped Native Runtime Ownership

**Status:** Proposed — architecture decision for implementation; not yet implemented.
**Date:** 2026-11-17
**Context branch:** `codex/runtime-challenge-enforcement`
**Coordination record:** `agent-coordination`

## Context

The current iOS app has separate UI ownership boundaries:

- `LocalChatModel` constructs a `NativeInferenceRuntime`, owns a `ModelPoolLease`, and passes that runtime/lease into native evaluation.
- `WorkspaceView` creates a `WKWebView` and navigation coordinator but has no injected runtime/session service or script-message dispatcher.
- `RuntimeController` independently accepts an injected `NativeInferenceRuntime`, `BridgeChallengeStore`, and trusted workspace URL. Its actor owns exact leases and generation/readiness state.
- `NativeInferenceRuntime` composes the `ModelPool` and `InferenceScheduler`. Creating another instance creates another pool and scheduler; it is not a harmless wrapper.

A second runtime constructed for Workspace would create competing model ownership and memory admission, separate schedulers, and inconsistent readiness/session state. Moving ownership into a SwiftUI view risks recreating runtime state as views are reconstructed.

The existing PR #169 challenge enforcement is necessary but insufficient: a challenge must be issued and consumed by a host-controlled dispatcher whose origin context comes from WebKit's frame metadata. A page-provided URL is not proof of origin.

## Decision

Create exactly one app-scoped native runtime composition root, retained for the lifetime of the app process and injected into the relevant feature models.

The composition root owns or coordinates:
1. One `NativeInferenceRuntime` instance (one `ModelPool` and one `InferenceScheduler`).
2. One model catalog/artifact resolver and integrity-check path.
3. One app-scoped session service that owns exact `ModelPoolLease` values and serializes load/readiness/generate/cancel/unload/disconnect transitions.
4. One `RuntimeController` for the trusted Workspace bridge, using the same runtime and session ownership model; do not let Local AI and Workspace independently acquire the same model as separate owners.
5. One host-owned `BridgeChallengeStore` whose lifetime and invalidation are controlled by the app and WebKit lifecycle.
6. Read-only runtime snapshots for Runtime Status and other presentation surfaces.

The SwiftUI root constructs this composition root once using stable app lifetime state (for example, a `StateObject` app model or equivalent stable dependency container) and injects references into Local AI, Workspace, and Runtime Status. Views do not construct engines, pools, controllers, or lease owners.

## Ownership model

| Resource | Sole owner | Permitted consumers |
|---|---|---|
| LlamaCppMetalBackend / LlamaEngine | Native runtime composition root | NativeInferenceRuntime |
| NativeInferenceRuntime | App-scoped runtime container | Session service and controlled evaluators |
| ModelPool / InferenceScheduler | NativeInferenceRuntime | Internal runtime operations |
| ModelPoolLease | App-scoped session service | Operations scoped to that exact session |
| RuntimeController session records | RuntimeController/session service, with one documented authority | Trusted bridge dispatcher |
| BridgeChallengeStore | App-scoped host security service | Host dispatcher and RuntimeController |
| Model catalog | App-scoped catalog service | Local AI and session service |
| Runtime status | Derived read-only snapshot | SwiftUI presentation |

Do not expose the raw engine, pool, lease, signing key, or challenge-store mutation API to JavaScript or agent/model output.

## Request flow

1. Local AI or the trusted Workspace requests a model operation through the app-scoped session service.
2. The service resolves a catalog entry and validates the exact model artifact hash before loading.
3. A single owner acquires and retains the exact ModelPool lease.
4. Readiness runs a real native probe against that same lease and produces a bounded, expiring readiness record.
5. Workspace requests enter only through a host-installed WebKit message handler.
6. The handler derives origin from `WKScriptMessage.frameInfo.securityOrigin`, requires the main frame, validates the strict BridgeGate schema, and checks the configured trusted origin.
7. For generation, the host issues a one-use challenge bound to origin, request UUID, active session, and expiry. RuntimeController consumes it before inference.
8. Generation, cancellation, and drain execute through the same runtime/scheduler and exact lease.
9. Disconnect, navigation, session replacement, or teardown invalidates outstanding challenges and prevents stale requests from using the session.
10. The service releases the lease only after in-flight operations have completed or been cancelled and drained.

## Authorization invariants

- APEX remains the sole authority for consequential approvals; this ADR does not grant the Workspace permission to import, load, or unload models.
- Import/load/unload remain fail-closed until a native approval coordinator is implemented and tested.
- A WebKit message, challenge, readiness result, model hash, or unsigned generation candidate is not an APEX approval, signed receipt, or device attestation.
- Never trust a page-supplied origin, session identity, file path, hash, or authorization Boolean.
- Reject subframes, opaque origins, origin mismatches, unexpected message keys, stale sessions, expired readiness, fabricated challenges, and replayed challenges.
- Do not automatically resume interrupted work after process restart or reconnect.
- Preserve offline-first local inference; network connectivity is not required for Local AI operation.

## Required implementation sequence

### Phase A — composition root
- Add an app-scoped dependency container with stable lifetime.
- Construct the native engine/runtime once.
- Inject the same runtime and session service into Local AI, Workspace, and Runtime Status.
- Remove runtime construction from LocalChatModel.
- Make NativeEvaluationRunner use the shared service/lease, not an independently created runtime.
- Preserve model catalog, encrypted memory, conversation history, and evaluation journal behavior.

### Phase B — single lease/session authority
- Move model load/readiness/generate/cancel/unload/disconnect state transitions behind one session service.
- Prevent Local AI and Workspace from creating duplicate leases or controllers for the same active session.
- Define behavior when switching models, navigating Workspace, cancelling, backgrounding, memory pressure, and app termination.
- Keep the model file on disk when a runtime session is unloaded; runtime availability and artifact presence are separate states.

### Phase C — WebKit dispatcher
- Install a named message handler in WKWebViewConfiguration before WKWebView construction.
- Derive source origin and main-frame status from WKScriptMessage.frameInfo.
- Validate message schema and route through BridgeGate and the app-scoped session service.
- Issue/consume host challenges only after host validation.
- Add explicit navigation, disconnect, teardown, and session-replacement invalidation.
- Avoid exposing privileged native APIs to page JavaScript.

### Phase D — tests and acceptance
- Unit-test composition-root identity: Local AI, Workspace, and status resolve the same runtime/session owner.
- Assert only one ModelPool and scheduler are created per app container.
- Test one lease owner and correct release/drain under concurrent chat, evaluation, cancellation, and navigation.
- Test fabricated, expired, replayed, wrong-origin, wrong-request, wrong-session, and subframe messages.
- Test challenge invalidation on navigation, disconnect, session replacement, and teardown.
- Test model hash changes, readiness expiry, process restart, background/foreground, memory pressure, and failed native loads.
- Test that import/load/unload remain denied absent native approval.
- Run exact-head iOS CI, then perform signed physical iPhone Air tests with recorded device/model/build evidence.

## Explicit non-goals

This ADR does not implement a WebKit handler, native approval coordinator, signing, attestation, cloud inference, autonomous external actions, or physical-device acceptance. It does not authorize merging PR #168 or #169. Those changes retain their own review and merge gates.

## Acceptance gate

The architecture is accepted only when source inspection and tests demonstrate a single app-scoped runtime and lease authority shared by all native UI surfaces, and the host WebKit dispatcher passes the security tests above. A green hosted CI run alone does not prove physical iPhone Air acceptance.
