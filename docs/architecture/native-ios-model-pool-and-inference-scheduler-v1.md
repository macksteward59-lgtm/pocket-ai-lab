# Native iOS Model Pool and Inference Scheduler v1

## Purpose

Provide native resource-accounting primitives for future multi-model and multi-agent execution without giving inference code any authorization authority.

## ModelPool

`ModelPool` is an actor-isolated cache of native `LlamaEngine` sessions.

- Acquisitions return unique `ModelPoolLease` values bound to one exact model descriptor and runtime session.
- Concurrent acquisitions for the same model ID and exact descriptor coalesce into one engine load.
- Reusing a model ID with a different path, context, quantization, or memory estimate is rejected.
- The pool reserves caller-supplied estimated memory before awaiting a load and enforces both a pool memory budget and a host-supplied current-available-memory snapshot with a configurable safety margin.
- A model cannot be unloaded while any lease is active or while its load is pending.
- Release is exact and idempotent; stale/double releases return false.
- Idle models remain cached until explicitly unloaded. `unloadIdleModels()` unloads idle entries and leaves leased sessions alone.
- Returned session IDs must match the requested model ID and must not collide with another pool-owned session.

Memory estimates are admission-control hints, not measured resident memory. The pool does not discover a trustworthy per-model memory estimate itself; the caller must derive it from model metadata and calibrate it on physical devices. The available-memory provider must report current system-available memory. The pool's own budget separately accounts for its active and pending reservations.

The pool does not currently implement automatic LRU eviction, model download, file hashing, device attestation, or native UI integration.

## InferenceScheduler

`InferenceScheduler` is a FIFO async admission controller.

- Configurable concurrency is bounded to 1–8 requests.
- `withPermit` holds one permit for the complete async operation.
- Permits are released on success, error, and cancellation.
- Queued waiters are resumed in arrival order.
- Cancelling a queued waiter removes it without consuming a permit.
- A cancellation racing with permit transfer is checked immediately after acquisition and releases the permit before propagating.

The scheduler does not cancel an operation that ignores task cancellation. The operation itself and the underlying inference engine must cooperate with cancellation.

## Composition and integration status

These are core package primitives. They are not yet wired into `LocalChatModel`, `NativeAgentCoordinator`, APEX, East/e3, or the UI. The current Agent Team workflow remains sequential on one loaded model session.

Next integration gates:

1. Connect `ModelPool` to the model registry and exact file-hash inventory.
2. Feed estimates from verified GGUF metadata; retain an explicit safety margin and fail closed on missing estimates.
3. Inject one `InferenceScheduler` into every caller sharing the same device inference resources.
4. Bind each agent request to a pool lease and release it only after generation/cancellation has drained.
5. Add memory-pressure handling and controlled idle eviction.
6. Validate load, lease, unload, cancellation, memory, thermal, and battery behavior on a physical iPhone.

## Trust boundary

A pool lease means only that the local engine returned a session for a requested model descriptor. It is not a trusted runtime proof, a device attestation, an authorization grant, or an evidence receipt.

llama.cpp still produces tokens only. APEX/Director retains approval authority; East/e3 retains durable workflow execution; BridgeGate and signed evidence boundaries remain unchanged. No model output can create, renew, or release authorization.


## Host-memory admission accounting

Before admitting a new model, `ModelPool` subtracts all existing resident, pending-load, and unloading reservations from the host's reported available-memory snapshot, then preserves the configured minimum-free-memory margin. This is conservative admission control based on estimates and a potentially stale OS snapshot; it is not measured RSS or a substitute for physical-device memory-pressure testing. A deterministic regression test holds the host snapshot constant while a first model reserves memory and verifies that a second model cannot over-admit the remaining budget.
