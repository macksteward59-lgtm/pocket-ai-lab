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
The upstream main-branch package manifest currently reports @elaraai/e3 version 1.0.108, while Pocket AI Lab declares the range ^1.0.98. That makes the inspected upstream implementation relevant to the declared range, but without a lockfile or deployed dependency inventory it still does not identify the exact version actually used in a deployed workspace. Treat 1.0.108 as the inspected upstream source version, not as proof of the installed production version.


## Local e3 runner process-boundary finding — graceful provider drain is not available through the stock stop path

A deeper inspection of upstream e3-core's local execution implementation materially narrows the integration options.

- The documented default task runner is `east-node`; the local `LocalTaskRunner` starts task runners as child processes. The e3 skill describes project-owned Node platform functions as a scoped package export supplied to that runner.
- `TaskExecuteOptions.signal` is forwarded by `LocalTaskRunner.execute` to the local task execution path. That signal reaches `spawnAndCapture`.
- In the inspected upstream `processExec.ts`, the abort listener calls `stopProcessGroup`, which calls `killProcessGroup`. On POSIX, `killProcessGroup` sends **SIGKILL** to the process group (negative child PID). On Windows, the stop ends the job launcher/job object; without the optional launcher it invokes `taskkill /T /F`. This is not a graceful SIGTERM callback into the East Node process. The runner's stdout/stderr pipes are drained/closed with a bounded 5-second post-exit drain; that is pipe cleanup, not provider settlement.
- Therefore a module-level SIGTERM listener or process-signal-to-AbortController bridge inside `src/east/platform.ts` would be an incorrect integration assumption for the stock local runner: the inspected stop path does not provide SIGTERM as a graceful cancellation hook. It may forcibly terminate JavaScript before provider finally blocks, model-session release, or durable lifecycle cleanup execute.
- The orchestrator's `wait(handle)` still provides the correct e3 execution completion barrier: local stop waits for its launched task promises and the run completion promise resolves from the loop's finally path after locks are released. But that barrier proves the runner process has stopped; it does **not** prove an in-process provider gracefully settled if the runner was SIGKILLed. A remote provider may continue compute after its client process dies.

### Revised implementation direction

Do not add a signal listener to the platform module and do not claim graceful provider drain from the stock runner's process-group kill.

The next design decision is between:

1. **Host-owned inference service / worker supervisor (preferred for local provider lifecycle):** inference runs outside the e3 task process group under a separately supervised service. The e3 task sends an execution/attempt identity to that service. The host that owns the e3 run handle receives cancellation, sends an explicit authenticated cancel command to the inference service, waits for provider settlement and lease release, and only then completes its own cancellation path. Client disconnect or e3 process death alone is not accepted as remote cancellation evidence.
2. **A custom e3 TaskRunner / execution adapter:** only if the selected runner API can be implemented and tested so its AbortSignal is handled by a supervisor that performs cooperative cancellation before terminating task processes. The stock LocalTaskRunner path is not sufficient for this guarantee because its abort path kills the process group.

The host must also own durable correlation between e3 run ID, task execution ID, provider generation ID, and model/session lease. Cancellation must be idempotent; a late result must be rejected by attempt fencing; and recovery must query the supervisor's durable state rather than infer that a provider stopped because the e3 task process disappeared.

### Acceptance test changes

The real-runner test must distinguish these facts:
- e3 cancellation requested;
- task process terminated;
- inference service received authenticated cancellation;
- provider generation settled (or was explicitly classified as unconfirmed);
- model/session lease released;
- durable Pocket AI Lab attempt marked cancelled;
- restart/recovery did not replay or publish the stale attempt.

A passing process-exit assertion alone is insufficient. For a remote backend, the system must report remote compute termination as unknown unless the backend supplies authoritative completion/cancellation evidence.

Upstream source references (main branch, not a pinned deployment contract):
- [e3 skill — task runners and platform functions](https://github.com/elaraai/east-workspace/blob/main/libs/e3/SKILL.md)
- [LocalTaskRunner](https://github.com/elaraai/east-workspace/blob/main/libs/e3/packages/e3-core/src/execution/LocalTaskRunner.ts)
- [processExec](https://github.com/elaraai/east-workspace/blob/main/libs/e3/packages/e3-core/src/execution/processExec.ts)
- [orchestrator interfaces](https://github.com/elaraai/east-workspace/blob/main/libs/e3/packages/e3-core/src/dataflow/orchestrator/interfaces.ts)
- [LocalOrchestrator](https://github.com/elaraai/east-workspace/blob/main/libs/e3/packages/e3-core/src/dataflow/orchestrator/LocalOrchestrator.ts)


### Existing Pocket AI Lab host-side cancellation building blocks

A repository scan found two existing host-side patterns that are useful references, but neither is yet the e3 execution supervisor:

- `runtime/lab/server.ts` binds to 127.0.0.1, creates an AbortController for `POST /api/tasks`, aborts it when the response closes before completion, and passes the signal to `runLabSession`.
- `apps/web/server.mjs` uses the same response-close-to-AbortController pattern for `POST /api/agent-tasks` and `POST /api/chat`, passing the signal into the llama.cpp-backed provider/session.

These are request-scoped cancellation paths. They do not expose a durable e3 run/task execution registry, an authenticated host-to-provider cancel command keyed by a stable generation ID, a provider-settlement query after the original HTTP client disappears, or restart recovery for outstanding provider generations. They are implementation precedents for a host-owned supervisor, not evidence that e3 cancellation is already integrated. Any internal cancellation endpoint must add explicit local-origin/authentication controls, per-attempt ownership, idempotency, and a durable settlement record; it must not trust a caller-supplied task ID alone.

### Deployment entrypoint versus runtime-bound compilation — additional source trace

A second pass compared the repository's actual package start command with the East exports:

- `package.json` starts e3 with `e3 workspace deploy . dev --from-source ./src/east/index.ts && e3 dataflow run . dev`.
- `src/east/index.ts` exports a default `e3.package(..., pocketAILabTask)`. That package contains `pocketAILabTaskFunction`, whose East platform declarations are `createAgentTask`, `assignAgent`, `executeAgent`, `runDeliberation`, and `commitTaskEvidence`.
- The concrete `.implement(...)` callbacks are assembled only inside the private `bindEastPlatform(runtime)` helper. That helper is called by the exported `compilePocketAILabTask(runtime)` function.
- The checked-in `start` command deploys the default e3 package from the source entrypoint; it does not invoke `createEastPlatform` or `compilePocketAILabTask`. Repository code search on the relevant branch found the compile helper used by its unit test, not by a production composition root.

This is a stronger, concrete integration gap than merely not finding a host-owned cancellation controller: the visible deploy path and the runtime-bound compile path are distinct. The source snapshot does not establish how the default e3 package's platform declarations receive concrete implementations at deployment/runtime. It may be supplied by external workspace configuration or a platform mechanism outside this repository, so do not conclude that deployment is broken solely from this absence. But do not claim that the runtime-bound implementation is active in the deployed e3 task until the external binding mechanism is identified and tested.

**Required verification:** inspect the deployed e3 workspace configuration and exact SDK version; identify how each declared platform function is bound; prove the binding resolves to the intended `EastPlatformRuntime` and provider instance; then prove the same host owns the e3 run handle and can coordinate cancellation/drain. The compiled-task integration test currently exercises `compilePocketAILabTask(runtime)` directly and does not exercise `npm start` / `e3 workspace deploy` / `e3 dataflow run`.

### Confirmed e3 custom-platform registration gap — exact project metadata

The upstream East project authoring guide provides the missing registration contract. For a project-owned Node platform function used inside an e3 task:

1. The package must expose a `./platform` subpath whose default export is the `PlatformFunction[]` implementation array.
2. The task must declare the project's custom platform in its runner: `{ runtime: "east-node", platforms: [{ custom: "<exact package.json name>" }] }`.
3. The custom package name must be scoped, and the platform function's dotted name must byte-match between its East declaration and implementation.
4. Existing projects must add the `./platform` package export and build it before `e3 dataflow run`.

Against that contract, the current Pocket AI Lab branch has these concrete omissions:

- Root `package.json` declares `"name": "pocket-ai-lab"` (unscoped), has no `exports` map, and the start script does not run a build before deploying/running.
- There is no `src/platform/index.ts` module or `./platform` subpath export in the root package metadata.
- `src/east/index.ts` creates five project-owned platform declarations (createAgentTask, assignAgent, executeAgent, runDeliberation, commitTaskEvidence), but `e3.task("pocketAILabTask", ..., pocketAILabTaskFunction)` has no runner configuration naming a custom platform.
- The concrete implementations exist in `bindEastPlatform(runtime)`, but they are not exported as a package-level `PlatformFunction[]` for the e3 Node runner. The separate `compilePocketAILabTask(runtime)` helper compiles in-process for tests; it is not a substitute for the e3 runner's custom-platform package contract.

This is now a source-confirmed deployment wiring gap, not merely an unknown external runtime composition root. Based on the inspected e3 authoring contract, the deployed task is at risk of failing at execution with a missing project platform function. I have not run the deploy against the user's actual environment, so this is a static source diagnosis rather than a reproduced runtime error.

**Implementation is held at a naming decision:** the e3 contract requires a scoped package name and exact self-reference. The repository currently uses the unscoped private package name `pocket-ai-lab`; selecting a scope and changing the root package identity affects package resolution and should not be guessed. Once that scope is approved, implement the standard project platform module, export it through `package.json#exports["./platform"]`, configure the task's `runner.platforms` entry with that exact package name, and ensure the build precedes deployment/run. Keep all five East function names identical across declarations and implementations. Add a smoke test that exercises the real e3 deploy/run path and asserts the platform functions resolve; retain the existing in-process compile tests as a separate layer.

Upstream authoring references: [East project skill](https://github.com/elaraai/east-workspace/blob/main/libs/east-plugin/skills/east-project/SKILL.md) and [East platform-function guidance](https://github.com/elaraai/east-workspace/blob/main/libs/east/SKILL.md). These are upstream main-branch docs, not a substitute for pinning the repository's actual installed e3/east package versions.

### Platform identifier audit

The upstream East project authoring guide requires project-owned platform function identifiers to use a dotted project.function form, with exactly matching identifiers in the East declaration and its implementation. The current declarations in src/east/index.ts use bare identifiers: createAgentTask, assignAgent, executeAgent, runDeliberation, and commitTaskEvidence. The current in-process binding uses the same declaration objects, so those identifiers match internally, but they do not follow the documented project-owned platform naming convention.

When the custom platform package is added, migrate declarations and exported implementations together to the agreed project-prefixed dotted identifiers. Do not rename only one side. The task body invokes createAgentTask, assignAgent, runDeliberation, and commitTaskEvidence; executeAgent is bound but not called directly by this task body. Confirm whether executeAgent is an intentional exported platform capability before retaining or removing it.

This is a static source audit against the upstream authoring guide. No runtime source was changed, and the existing in-process compile tests do not validate e3 runner package resolution.

### Provider-boundary audit — local transport drain versus remote generation cancellation

The provider implementations show two different cancellation guarantees, which must not be conflated:

| Provider path | Caller signal | What the code waits for | What remains unproven |
|---|---|---|---|
| `Orchestrator.executeTask` | Passes the same signal to each `InferenceProvider.generate` call | Awaits the provider promise; releases the agent session and model-router lease in `finally`; checks abort before publishing and before memory write | Does not make an e3 task runner deliver a signal into the East callback |
| `LlamaCppInferenceProvider` + `HttpLlamaCppBackend` | Combines caller signal with timeout and passes it through HTTP requests and body/stream readers | Awaits request/body reader settlement; stream reader is cancelled on abort; provider rejects after transport cleanup | Does not prove llama-server stopped generation or freed its model-side work |
| `RemoteInferenceProvider` | Converts caller abort into an AbortController passed to `fetch`; also has its own timeout | Awaits fetch/body response promise and removes listener/timer in `finally` | No stable generation ID, authenticated cancel endpoint, settlement query, or authoritative remote-compute stop receipt; remote server may continue generation after HTTP disconnect |

The `InferenceProvider` interface comment explicitly requires a provider to settle only after an aborted backend request has drained. `Orchestrator.executeTask` honors that contract by awaiting `generate` rather than racing it against an abort promise. Its `finally` releases the session and router lease only after `generate` settles. `EastPlatformRuntime.executeAgent` and `runDeliberation` pass the caller signal into that same orchestration path.

The checked-in East task declaration still has no cancellation parameter/context: `executeAgent` and `runDeliberation` are East platform functions whose implementations call the runtime methods without options, and the task function receives only `objective`. Therefore these provider and orchestrator guarantees are established for a direct caller that already owns an AbortSignal; they do not establish that e3 cancellation reaches the provider.

For remote inference, an aborted HTTP fetch is a local transport outcome, not a remote generation cancellation receipt. Until a host-owned supervisor and inference service support an authenticated, idempotent cancellation command keyed by a stable generation ID plus a settlement query, the durable attempt must report remote compute termination as **unconfirmed/unknown**. It must fence late results and must not replay or publish a stale attempt after restart.

### Focused test coverage and remaining acceptance gap

The East platform test suite currently demonstrates ordinary execution, compile-time binding, provider failure, and governance fail-closed behavior. The existing cancellation/drain contract describes a regression that blocks a provider promise, aborts the caller, confirms the caller remains pending until the provider settles, and then confirms no late MessageBus publication or deliberation memory write. That regression is valuable for the direct runtime API, but it is not a real e3 deployment/runner test.

The llama.cpp adapter tests cover caller cancellation at the provider boundary, and its HTTP backend explicitly cancels response bodies/readers. The remote provider has a fetch-level AbortController path, but this repository does not contain an inference-host cancel-by-generation API or remote settlement protocol. These tests therefore validate local request cancellation semantics only; none can establish that an arbitrary remote inference server terminated GPU work.

**Required next tests:** (1) direct East runtime blocked-provider drain test; (2) llama.cpp HTTP stream/body cancellation test with provider promise settlement; (3) remote provider fetch abort test with explicit classification that remote generation termination is unknown; (4) host-supervisor integration test correlating e3 run/task, generation ID, lease release, durable cancellation, and restart recovery; and (5) real e3 deploy/run cancellation test using the same production runner and host API. Do not claim (4) or (5) pass based on current unit tests.
