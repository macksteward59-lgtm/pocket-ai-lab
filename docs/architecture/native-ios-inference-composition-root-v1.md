# Native iOS inference composition root v1

## Purpose

Provide one native composition root for model ownership and inference admission. Native chat and the logical Agent Team must use the same ModelPool and InferenceScheduler rather than creating independent engines or independent concurrency limits.

## Ownership

- `NativeInferenceRuntime` owns one injected `LlamaEngine`, one `ModelPool`, and one `InferenceScheduler`.
- Model acquisition returns an exact `ModelPoolLease`. The lease must remain active while any operation can still use its session.
- `withLease` releases only after its awaited operation returns. The operation must not detach work that continues using the session after returning.
- Native chat retains its lease while the selected model is loaded. The explicit unload action releases the lease and then awaits native unload.
- Agent Team coordinators are created from the same runtime and lease as chat.

## Inference and cancellation drain

- The scheduler permit covers the complete async token stream, not merely the call that creates the stream.
- Output limits are enforced while collecting UTF-8 bytes.
- On stream failure, cancellation, or output-limit rejection, the runtime awaits `LlamaEngine.cancelAndWait` before releasing the scheduler permit.
- `cancelAndWait` is a required engine contract. It must return only after the matching request has stopped using the native session.
- The llama.cpp implementation retains the producer Task for each exact request ID, requests native cancellation, and awaits that producer Task. Stale request IDs cannot cancel a newer generation.
- The loopback implementation binds cancellation to the exact request ID and awaits the URLSession task.
- Unload first drains an active generation before closing the native session.

A plain cancellation request is not a drain acknowledgment. New engine adapters must implement the same wait contract; a best-effort cancel method is not sufficient.

## Memory admission

The iOS host samples `os_proc_available_memory()` when a new model is admitted. This is advisory app-allocatable headroom, not device-wide free RAM. A zero/negative or insufficient snapshot fails closed.

The current app estimate is a heuristic based on GGUF file size plus a 25% / 256 MB working margin. It is an admission hint, not measured resident memory, GGUF metadata-derived KV-cache sizing, or a guarantee of safe loading. Physical-device calibration is required before tuning these values or claiming production readiness.

## Validation

The package tests cover:
- Scheduler capacity held through stream completion.
- FIFO admission for requests sharing the runtime.
- Lease retention while cancellation drain is blocked.
- Lease release only after cancellation drain returns.
- Successful operation lease release.

CI simulator tests do not establish physical-device memory, thermal, battery, or latency behavior.

## Trust boundaries

The runtime composition root is resource management only. A model lease, scheduler permit, generated text, or cancellation result does not grant permission.

- APEX/Director remains the approval authority.
- East/e3 remains the durable workflow execution layer.
- ExploitGym isolation, BridgeGate trusted-origin/message authorization, RuntimeController lifecycle boundaries, and signed Evidence verification remain unchanged.
- Model output remains untrusted proposal data. No inference path may approve actions, execute tools, create evidence receipts, or bypass authorization.


## Import validation boundary

The staged importer checks the 24-byte minimum GGUF header: magic, little-endian version (currently v1-v3), tensor count field, and metadata-entry count field. It rejects truncated headers and unsupported versions before replacing the last known-good file. This is a structural header check only; it is not a full GGUF metadata/tensor parser, checksum, provenance check, or model authenticity guarantee.


## Lease-bound generation and in-flight use pins

Every public generation call must present the exact active `ModelPoolLease` returned by the same runtime's pool. A `RuntimeSession` identifier by itself is not authority to begin generation.

- `NativeInferenceRuntime.generate(lease:request:maxOutputBytes:)` first asks ModelPool to create a unique in-flight use pin for that exact lease, session, and model descriptor.
- The pin is acquired before scheduler admission. This protects the session even while a request is waiting for a FIFO scheduler permit.
- The pin remains active through stream completion, stream failure, output-limit rejection, and the engine's awaited cancellation drain. It is released on every success/error exit.
- Releasing a caller's lease does not invalidate an already-pinned operation, but it prevents any new operation from starting with that lease.
- Explicit unload fails while either active leases or active use pins exist. Idle-model eviction skips entries with either kind of ownership.
- A lease from another ModelPool/runtime, a stale lease, or a lease released before generation begins is rejected before the engine is called.
- The raw engine reference is internal to the package composition boundary. Production Agent Team and chat call sites use the same runtime and exact lease.

The use pin is a resource-lifetime guard only. It is not an authorization token for tools, workflow execution, or evidence creation. A caller must still obey the established APEX/Director, BridgeGate, East/e3, and signed-evidence controls.

Regression tests cover: generation rejected after lease release; cross-runtime/foreign-pool lease rejection; a session remaining non-unloadable after its lease is released during active generation; pin release after successful stream completion; and cancellation drain retaining both the pin and scheduler permit until the engine acknowledges drain.


## Bounded multi-turn chat context

The native chat surface carries a small rolling transcript into each new generation instead of sending only the latest message.

- Only prior `You` and `Pocket AI` chat turns are included. Agent Team role output and runtime diagnostics are not silently promoted into the chat transcript.
- At most the eight most recent chat messages are considered before the current user message.
- The assembled prompt is capped at 6,000 UTF-8 bytes, including framing. Oldest entries are dropped first; if the newest single entry is oversized, its text is truncated at a Unicode-scalar boundary.
- The prompt labels the transcript as untrusted context and asks the model to answer the latest user message. This is prompt hygiene, not a security boundary or instruction hierarchy guarantee.
- This first implementation is in-memory only. It does not persist conversations across app restarts, create long-term agent memory, or share context between different models.
- The 1,500-byte ceiling is a conservative input bound intended to leave room for the configured 256-token response within the app's 2,048-token context, but byte count is not tokenizer output and cannot guarantee a token budget. Physical-device/model-specific tokenizer calibration remains future work.
