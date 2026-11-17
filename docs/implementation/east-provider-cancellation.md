# East provider cancellation and lease-drain contract

## Scope

East exposes an optional caller-owned AbortSignal on executeAgent and runDeliberation. The signal is forwarded through the Orchestrator's InferenceProvider.generate(request, { signal }) boundary to providers that support cooperative cancellation.

Cancellation is not an authorization decision and does not change Director, APEX, Evidence, model-readiness, or task ownership rules.

## Drain-before-release invariant

An active inference call is awaited to settlement. East and Orchestrator do not race the provider promise against an abort promise and do not release the agent session or model-router lease merely because the signal was aborted. The provider adapter is responsible for aborting its transport/runtime work when it supports cancellation. If an adapter ignores the signal, the caller continues waiting for that adapter to settle; this is slower, but avoids pretending that work has stopped while it may still consume the model/runtime.

After the provider promise settles, the orchestrator checks the signal again. A result returned after cancellation is discarded and is not published to the MessageBus. The deliberation is not written to episodic memory after that cancellation check. The finally path then releases the session and router lease.

## Provider obligations

- A provider that supports cancellation must pass the signal to its underlying request or runtime and reject/settle only after that work has drained.
- A provider that cannot cancel may ignore the optional signal, but must not claim cancellation or fabricate a cancelled result while backend work is still running.
- Abort errors are propagated as cancellation; other provider failures remain ordinary inference failures.
- Callers should treat cancellation as cooperative. It is not a hard kill or a guarantee that an arbitrary third-party backend honors the signal.

## Verification

The focused East regression aborts while a provider promise is unresolved, asserts that the caller remains pending until the provider settles, then verifies the late result is not published and no deliberation memory is written. Hosted CI is required before this contract is considered validated. Physical iPhone acceptance and production RLS remain separate gates.
