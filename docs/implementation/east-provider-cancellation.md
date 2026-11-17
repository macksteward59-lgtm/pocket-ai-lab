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


## Durable East lifecycle integration

The durable `runEastTaskWithLifecycle` adapter accepts a caller-owned signal
and forwards it to each inference-bearing East operation. If cancellation is
requested during a provider call, East awaits the provider's settlement first.
Only then does the adapter persist the durable lifecycle as cancelled and
invalidate the active step attempt. If cancellation arrives between steps, the
adapter persists cancellation before claiming more work. A cancellation that
arrives after the durable task has already completed does not rewrite the
completed task as cancelled.

`TaskLifecycleCoordinator.cancelTask` is a state-store operation; it has no
worker handle and cannot stop a model/provider. Hosts must signal and drain
workers before invoking it. Calling it directly while a provider is still
running only invalidates the durable attempt and is not a substitute for
cancellation propagation. The East lifecycle adapter is the integrated path. The PostgreSQL store regression uses a transactional fake database adapter to prove the persisted terminal state survives coordinator recreation; it is not a live PostgreSQL service test.

## Provider adapter coverage

- llama.cpp already combines the caller signal with its timeout signal and
  passes it to HTTP completion and streaming body readers. Those readers
  cancel their response stream and settle before the provider promise rejects.
- The opt-in remote HTTP provider now forwards the caller signal alongside its
  own timeout and distinguishes caller cancellation from timeout. It remains
  opt-in and is not enabled by the consumer app.
- Neither adapter can guarantee that a remote inference server has terminated
  GPU work merely because its HTTP request was aborted. The guarantee is local:
  the adapter's request/response work has settled before East releases its
  in-process route/session lease.

## Compiled e3 entrypoint boundary — integration remains open

The src/east/index.ts entrypoint currently declares:

- executeAgent as East.asyncPlatform("executeAgent", [StringType, StringType], StringType).
- runDeliberation as East.asyncPlatform("runDeliberation", [StringType], ...).
- Their .implement(...) callbacks receive only the declared task/agent identifiers and call runtime.executeAgent(taskId, agentId) / runtime.runDeliberation(taskId) without options.

The compiled pocketAILabTaskFunction also has only the objective input. It does not receive a host cancellation token, and bindEastPlatform has no documented runtime context from which to obtain one. Consequently, the optional signal on EastPlatformRuntime and EastTaskLifecycleAdapter is proven only for direct callers that already own an AbortSignal. This source does not prove that cancelling an e3 workspace/task execution aborts an active platform-function invocation or reaches the provider.

The upstream e3 SDK guide describes workspace function calls as cancellable, but that description alone does not specify that cancellation is exposed to an East.asyncPlatform(...).implement(...) callback, nor does it establish the behavior of this repository's e3.task / e3.dataflow run path. The repository currently declares semver ranges for @elaraai/east and @elaraai/e3 and has no checked-in npm/yarn/pnpm lockfile at this branch, so the exact installed e3 implementation cannot be pinned from this source snapshot. Reference: https://github.com/elaraai/east-workspace/blob/main/libs/e3/SKILL.md.

**Required follow-up before claiming end-to-end e3 cancellation:**

1. Pin and inspect the exact e3 package version used by the deployed workspace/runtime, including its task runner and platform binding types/implementation.
2. Identify a documented host cancellation callback or execution handle that is actually delivered to the platform implementation (or establish an explicit outer host-owned AbortController/worker registry).
3. Wire that supported host signal into the EastTaskLifecycleAdapter and preserve the signal → provider drain → durable cancellation ordering.
4. Add an integration test that starts the real compiled e3 task, cancels it through the same host API used in production while inference is blocked, and proves provider settlement precedes lease release and durable cancellation.
5. Verify restart/recovery behavior against the real e3 execution store/runner, not only the separate lifecycle coordinator store.

Until those conditions are met, classify compiled e3 cancellation as **not integrated / unverified**. Do not add an undeclared argument to the East platform schema, assume an undocumented callback parameter, or treat a cancelled client request as proof that the worker/provider stopped. This gap does not alter APEX authorization, evidence validation, or task ownership contracts.

### Additional upstream e3 cancellation findings (not a pinned dependency contract)

A source-level review of the upstream e3-workspace main branch found a real dataflow cancellation mechanism: OrchestratorStartOptions carries an AbortSignal, DataflowOrchestrator exposes cancel(handle), and the local orchestrator propagates its run-owned abort signal to in-flight task executions. Its stopLaunched path awaits the launched task promises before the local run finishes. The local task runner passes the signal into task execution; the process execution helpers document cancellation as stopping the spawned process group. Relevant upstream references: [orchestrator interfaces](https://github.com/elaraai/east-workspace/blob/main/libs/e3/packages/e3-core/src/dataflow/orchestrator/interfaces.ts), [local orchestrator](https://github.com/elaraai/east-workspace/blob/main/libs/e3/packages/e3-core/src/dataflow/orchestrator/LocalOrchestrator.ts), and [process execution](https://github.com/elaraai/east-workspace/blob/main/libs/e3/packages/e3-core/src/execution/processExec.ts).

This establishes that e3 has an execution-level cancellation surface in the upstream source, but it does not establish a graceful AbortSignal delivered inside this repository's East platform implementation. The local runner's process-group stop is not the same as the in-process provider's drain-before-release protocol: process termination may prevent JavaScript cleanup from running, and an already-dispatched remote inference request may continue on its server. For remote runners, the upstream interface explicitly allows cancellation to be recorded before remote tasks have stopped; status can remain stopping until they do. The exact deployed e3 version and runner topology still need to be pinned and tested.

The integration target is therefore refined: connect the production e3 execution handle/cancel API to a host-owned worker lifecycle that can signal the provider and await its drain before releasing leases and persisting Pocket AI Lab's durable cancellation. If the selected e3 runner only terminates a process group, document that as forced runner termination and do not represent it as provider-level graceful drain or remote GPU cancellation.
