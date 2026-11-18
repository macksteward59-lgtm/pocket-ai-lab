# Native Runtime Request Cancellation

## Scope

This document describes the request-scoped cancellation lifecycle implemented by the Director RuntimeController, its WebKit dispatcher boundary, and the shared native inference runtime.

It covers local iOS requests only. It does not define remote-provider cancellation, East durable-task cancellation, APEX authorization, or evidence semantics.

## Request identity

A cancellation is scoped to the exact pair:

- sessionId: the active Director runtime session.
- requestId: the UUID for one generation attempt.

The WebKit dispatcher validates the message through BridgeGate, resolves the exact controller session, and returns the controller's Boolean result as data.cancelled. A successful bridge envelope (ok: true) alone is not cancellation confirmation. The web client must require data.cancelled === true.

## Lifecycle

The controller registers the request task in generationAttempts[sessionId][requestId] before its first asynchronous preparation step. The task covers:

1. Initial model-file verification and readiness validation.
2. One-use, origin/session/request-bound challenge consumption.
3. Post-challenge model-file verification and session/readiness revalidation.
4. Native inference and output validation.
5. Completion or cancellation cleanup.

The registry intentionally includes preparation-stage requests that have not yet entered ActiveSession.generations.

### Cancellation while the request is registered

cancelGeneration cancels the exact task and awaits its value. The request task must settle before the controller acknowledges cancellation. During native inference, the shared NativeInferenceRuntime retains its use pin and awaits the engine's cancelAndWait path before releasing that pin. The llama.cpp bridge clears the prior request's atomic cancellation flag before publishing a new generation task; the C decode entry point does not clear it. This ordering prevents a cancellation delivered just before C decode begins from being erased by decode startup. The controller's generation task then settles before the caller can release the corresponding session lease.

A cancellation request does not directly release a model lease.

### Cancellation arrives before generation registration

The WebKit dispatcher creates a task for each message. A cancel message can therefore reach the controller before the matching generate message.

When the session is active and the request ID is a valid UUID, the controller can record an exact-session/request tombstone. Tombstones are:

- Scoped to the exact session and request IDs.
- Single-use: the matching generation consumes the tombstone.
- Time-limited to 30 seconds.
- Bounded to 256 entries.

The matching generation fails with cancellation before preparation, challenge consumption, or inference. If the tombstone cannot be recorded, cancellation is not confirmed.

### Cancellation after completion

A completed request is not retroactively cancellable. The controller retains a bounded completion marker for up to 30 seconds (maximum 512 entries). A late cancellation returns false while that marker remains. This prevents a completed generation from being reported as cancelled merely because its caller has not yet processed the result.

Completion markers are lifecycle bookkeeping only. They are not generation receipts, evidence, authorization, or attestation.

## Navigation and unload

cancelAllGenerations advances the lifecycle epoch and raises a drain barrier before awaiting any request. This prevents suspended preparation from resuming into native inference after navigation invalidation. It snapshots the request registry, cancels each exact attempt, and waits for those tasks to settle.

Session unload marks the session as unloading, cancels and drains its registered requests, then removes the controller session and releases its exact runtime lease. The shared pool's other consumers and leases are not evicted.

The intended ordering is:

generationStarted → cancellationReceived → generationDrained → workspaceLeaseReleased

For preparation-stage requests, the request may be invalidated before inference starts; the drain still waits for the suspended preparation operation to settle.

## What the acknowledgement proves

For a registered local request, a cancelled: true response means the controller's exact request task has settled after cancellation was requested. When native inference was active, the local engine's cancelAndWait contract is part of that drain path.

It does not prove that:

- A remote provider stopped computing after an HTTP abort.
- A server-side GPU job was terminated.
- A durable East task was cancelled unless the East host propagated cancellation and awaited its provider.
- A request was authorized, signed, attested, or accepted as evidence.

A missing or false cancelled value must remain unconfirmed at the web-client boundary.

## Governance and evidence boundaries

This lifecycle does not create or modify APEX contracts, evidence signatures, runtime trust, attestation, authorization, or receipts. LlamaEngine output and cancellation state are not authority to approve actions. Existing Director/East governance and evidence handoffs remain separate.

## Validation requirements

The native follow-up must pass exact-head Swift compilation and XCTest, including:

- Cancellation during challenge consumption.
- Cancellation during post-challenge file verification.
- Cancellation during active native inference, with drain-before-release assertions.
- llama.cpp cancellation delivered before stream consumption, proving a new C decode cannot erase the request's cancellation flag.
- Navigation cancellation across preparation-stage requests.
- Session unload while preparation or inference is active.
- Cancellation delivered before the matching generation.
- Late cancellation after completed output.
- Dispatcher response shape and client handling of cancelled: false.

Hosted macOS/iOS-simulator CI is not proof of physical iPhone acceptance. Physical-device validation remains a separate release gate.
