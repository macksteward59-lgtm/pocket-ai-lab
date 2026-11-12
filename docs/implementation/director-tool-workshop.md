# Director Tool Workshop

## Purpose

The Director Tool Workshop gives the Pocket AI Lab Director a governed lifecycle for tools it needs during a project. It can ask an injected builder to create a tool, extend or revise a Director-managed tool, submit the candidate to an injected test sandbox, and request activation or retirement.

The API is exposed as `Orchestrator.tooling`. The same `ToolRegistry` instance is shared with `SecurityDivision`, so an approved managed tool becomes visible to the existing specialist request checks.

## Lifecycle

1. **Discover/plan:** The Director identifies a missing capability and submits a typed `ToolBuildSpec` with a stable kebab-case id, purpose, allowed specialist templates, and concrete requirements.
2. **Build:** An injected `ToolBuilder` returns a source-file map. The output is treated as untrusted data.
3. **Fingerprint:** The workshop calculates a SHA-256 digest over a canonical, sorted file representation.
4. **Test:** An injected `ToolSandbox` evaluates the candidate. The adapter must use a disposable, network-denied, resource-limited environment with no host secrets or production credentials.
5. **Quarantine or ready:** Any failed, incomplete, or throwing test run leaves the artifact quarantined. A successful test run must report at least one test and every test passing.
6. **Activate:** A separate `ToolApprovalVerifier` must validate a human approval bound to the exact task, tool id, version, and digest. Activation registers metadata only.
7. **Use:** The host separately installs/detects an execution adapter. Every generated tool is classified as `active`, so SecurityDivision requires a fresh per-use approval and DelegationGate voucher. APEX/East authorization remains independent.
8. **Revise/retire:** Revisions create a new immutable version linked to the prior digest. Retirement requires independent approval and removes only Director-managed registry metadata; artifact history remains.

## Trust boundaries

- The workshop does not use `eval`, spawn processes, install packages, execute generated source, or directly access the network.
- The builder, sandbox, durable artifact store, approval verifier, and runtime adapter are host-injected ports. If the builder or sandbox is missing, development fails closed. If the approval verifier is missing, activation and retirement fail closed.
- The default artifact store is in-memory for tests and prototypes. A production host should inject a durable, access-controlled store.
- A registry entry is metadata, not an installed adapter and not permission to run it.
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
