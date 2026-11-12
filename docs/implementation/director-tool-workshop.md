# Director Tool Workshop

## Purpose

The Director Tool Workshop gives the Pocket AI Lab Director a governed lifecycle for tools it needs during a project. It can ask an injected builder to create a tool, extend or revise a Director-managed tool, submit the candidate to an injected test sandbox, and request activation or retirement.

The API is exposed as `Orchestrator.tooling`. The same `ToolRegistry` instance is shared with `SecurityDivision`, so an approved managed tool becomes visible to the existing specialist request checks.

## Lifecycle

1. **Discover/plan:** The Director identifies a missing capability and submits a typed `ToolBuildSpec` with a stable kebab-case id, purpose, allowed specialist templates, and concrete requirements.
2. **Build:** An injected `ToolBuilder` returns a source-file map. The output is treated as untrusted data.
3. **Fingerprint:** The workshop calculates a SHA-256 digest over the canonical manifest (including specialist allowlists and requirements) and sorted source files.
4. **Test:** An injected `ToolSandbox` evaluates the candidate. The adapter must use a disposable, network-denied, resource-limited environment with no host secrets or production credentials.
5. **Quarantine or ready:** Any failed, incomplete, or throwing test run leaves the artifact quarantined. A successful test run must report at least one test and every test passing.
6. **Activate:** A separate `ToolApprovalVerifier` must validate a human approval bound to the exact task, tool id, version, and digest. Activation registers metadata only.
7. **Use:** The host separately installs/detects an execution adapter. Every generated tool is classified as `active`, so SecurityDivision requires a fresh per-use approval and DelegationGate voucher. APEX/East authorization remains independent.
8. **Revise/retire:** Revisions create a new immutable version linked to the prior digest. Retirement requires independent approval and removes only Director-managed registry metadata; artifact history remains.

## Trust boundaries

- The workshop does not use `eval`, spawn processes, install packages, execute generated source, or directly access the network.
- The builder, sandbox, durable artifact store, approval verifier, and runtime adapter are host-injected ports. If the builder or sandbox is missing, development fails closed. If the approval verifier is missing, activation and retirement fail closed.
- The default artifact store is in-memory for tests and prototypes. Its version writes are upserts for lifecycle status transitions. A production host should inject a durable, access-controlled store.
- A registry entry is metadata, not an installed adapter and not permission to run it. SecurityDivision also denies requests until the host declares the adapter available.
- Generated tools cannot approve themselves, grant permissions, mint APEX evidence, change scope, or bypass East.
- Built-in catalog tools cannot be revised or retired through the Director-managed lifecycle.

## Current integration boundary

The TypeScript orchestration API is wired to `Orchestrator.tooling`, and its registry is shared with `Orchestrator.security`. The repository's inference-provider contract still accepts a prompt and returns a payload; it does not yet define a provider-neutral model tool-call protocol. A host adapter must translate a validated Director tool-management intent into the `ToolDirector` API. Do not interpret arbitrary model text as an executable command.

## Required host adapters before production use

- A code-generation provider that emits bounded source bundles.
- A real isolated sandbox implementation with resource, filesystem, and network controls.
- A durable artifact store with integrity and access controls.
- An independent approval verifier backed by the application's human approval system.
- A separate runtime adapter installer and executor that re-checks the exact active artifact digest and passes every invocation through SecurityDivision, DelegationGate, and applicable APEX/East controls.

The workshop is a capability-management foundation, not a claim that arbitrary generated tools can safely execute on the user's device today.

## Director-wide capabilities

The capability hub is exposed as `Orchestrator.capabilities`. It adds host-injected ports for:

- **Internet research:** submit bounded queries and optional domain allowlists; receive source records with URLs, excerpts, and retrieval timestamps. The host research provider is responsible for web access, source verification, and rate limits. Retrieved text remains untrusted input.
- **Project analysis:** inspect an explicitly supplied workspace or project scope and return evidence-linked findings for missing capabilities, defects, risks, optimizations, and dependencies.
- **Memory improvement:** ask an injected advisor to propose additions, revisions, or retirement of working, episodic, semantic, and procedural memories. Each individual change requires independent approval. New or revised memories return to unverified status; research claims do not become trusted memory merely because the Director proposed them.
- **Device operations:** use a host device bridge for app listing/opening, storage inspection, and file read/write/delete. Every action requires a fresh, narrowly scoped permission decision tied to the task and resource. File deletion additionally requires explicit destructive confirmation.

### Device access limits

The intelligence package does not bypass operating-system permissions or app sandboxing. The device bridge must expose only APIs the host platform permits. On iOS, for example, an app cannot freely browse another app's private container, silently manage arbitrary app data, or launch every installed app; access is constrained to supported document pickers, Files/document-provider APIs, app groups, approved URL schemes, and system permission flows. Storage cleanup should be recommendation-first and target-specific. Uninstalling apps, bulk deletion, credential access, permission changes, and other destructive or privileged operations are not granted by this capability contract.

### Self-improvement boundary

The Director can research improvements, inspect its own project components, propose tool or memory changes, test candidates, and request approvals. It cannot silently rewrite its governing policies, approval verifier, trust roots, security gates, or its own permissions. Tool and memory changes remain versioned/provenanced and subject to the approval boundaries above. The host must supply the actual model tool-call adapter and capability providers; arbitrary model text is never treated as a command.

## Structured command bridge

`Orchestrator.directorCommands` is the finite structured-command dispatcher for model/provider adapters. It accepts only the explicit command kinds `research`, `analyze-project`, `propose-memory-improvements`, `apply-memory-improvement`, `develop-tool`, `activate-tool`, `retire-tool`, and `use-device`. Unknown commands, free-form shell/code requests, malformed fields, excessive limits, and unsafe relative project paths are rejected before dispatch.

The bridge is not itself a model-native function-calling implementation. A provider adapter must still translate provider-specific structured tool calls into this typed command vocabulary and pass model output as untrusted data. The bridge never evaluates code or treats prose as an instruction. Task identity is supplied by the orchestrator, not trusted from model output. Activation, retirement, memory mutations, and device operations retain their independent approval checks.

### Provider handoff

The optional `DirectorCommandProvider` port is the model-facing handoff. A host adapter implements `propose({ taskId, objective, availableCommands })` using the provider's native structured function/tool-call feature, and returns the raw proposal for validation. `Orchestrator.requestDirectorCommand(taskId, objective)` then validates and dispatches exactly one allowlisted command. The task ID is supplied by the host/orchestrator and is not accepted from model output. If no provider adapter is configured, the request fails closed. Provider-specific API schemas, credentials, retries, and streaming remain host adapter responsibilities.
