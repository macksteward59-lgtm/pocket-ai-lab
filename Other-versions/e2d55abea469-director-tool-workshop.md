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

The TypeScript orchestration API is wired to `Orchestrator.tooling`, and its registry is shared with `Orchestrator.security`. A provider-neutral structured command contract now exists through `DirectorCommandProvider`, `DirectorCommandRouter`, and `Orchestrator.requestDirectorCommand(taskId, objective)`. The repository still needs a concrete provider-specific adapter that maps the selected inference provider's native function/tool-call format to that contract. Do not interpret arbitrary model text as an executable command.

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

## Competitor baseline and measurable evaluation plan

### Public capability baseline

The Director workshop is a cross-project capability manager, not itself an autonomous penetration-testing product. The closest adjacent public systems provide useful design baselines:

- **HackerOne Agentic Testing / H1 Agentic Pentest:** program-context-aware multi-agent testing, access and asset characterization, reconnaissance, planning, parallel specialist testing, synthesis and reporting. Its public documentation emphasizes engagement context, scope, rate limits and constraints.
- **Bugcrowd Savant Pathseeker:** autonomous testing against approved assets, continuous web/API coverage, human oversight, an in-run stop control, and evidence-backed findings.
- **XBOW:** coordinator-led exploration, short-lived specialist agents, steerable browser/tooling, parallel testing, independent exploit validation and reproducible evidence.
- **Wiz AI Cyber Model Arena:** a public evaluation model using real-world cyber tasks and reporting pass@1, category results, time and cost.

These are adjacent baselines: HackerOne/Bugcrowd are customer-authorized testing platforms, XBOW is an autonomous offensive-testing platform, and Wiz is a benchmark. None is a directly comparable implementation of this Director tool/memory/device capability hub. Vendor descriptions are not independently verified here.

References:
- https://docs.hackerone.com/en/articles/14499410-h1-continuous-testing-agentic-pentest-reasoning-and-context
- https://www.hackerone.com/product/pentest
- https://www.bugcrowd.com/press-release/bugcrowd-introduces-savant-pathseeker-delivering-continuous-agentic-pentesting-across-the-attack-surface/
- https://docs.bugcrowd.com/customers/asset-management/start-an-autonomous-pentest/
- https://xbow.com/platform
- https://www.wiz.io/blog/introducing-ai-cyber-model-arena-a-real-world-benchmark-for-ai-agents-in-cybersec
- https://www.wiz.io/cyber-model-arena

### Benchmark design

Do not claim the workshop surpasses competitors until a reproducible comparison is run. Create a separate held-out 50-task corpus (10 tasks per capability family) covering:
1. Research and tool discovery.
2. Project inspection and missing-capability diagnosis.
3. Tool specification, generation, testing, revision and retirement.
4. Memory proposal, exact-change approval and safe application.
5. Device permission requests, resource binding, action integrity and recovery.

Run each task with at least three seeds against (a) a human-only reference workflow, (b) a strong general coding-agent workflow with equivalent repository/tools, and (c) the Director. For public competitor products that cannot be run on the same harness, record a clearly labeled feature-level comparison rather than inventing benchmark scores. Preserve identical task inputs, scope, time budgets, model budgets and allowed tools.

### Required metrics

- **Task quality:** completion rate, rubric score, tool-selection precision/recall, defect-detection precision/recall, and independent reproduction rate.
- **Research quality:** source validity, freshness, claim-to-source support, duplicate rate and citation coverage.
- **Tool lifecycle:** generated artifact test-pass rate, digest reproducibility, revision correctness, rollback success and time-to-ready.
- **Memory quality:** proposal acceptance precision, stale-memory rate, provenance completeness, unverified-memory containment and successful rollback.
- **Device safety:** permission-check coverage, action/resource digest match, unauthorized-action count, destructive-action confirmation coverage and mutation/replay resistance.
- **Efficiency:** median/p95 completion time, model/tool calls, tokens, external cost and human intervention minutes.

### Acceptance gates before a superiority claim

- Zero unauthorized device actions, zero action/resource mismatches, zero approval replay across operation types, and 100% approval enforcement in the held-out safety suite.
- 100% digest agreement between approved and activated tool artifacts; failed persistence must leave registry and artifact-store state consistent.
- At least 95% valid source citations and at least 90% task completion on the held-out Director corpus.
- To claim the Director outperforms the strongest runnable baseline, it must exceed that baseline by at least 10 percentage points on the same quality rubric without a safety regression, and report time/cost separately.
- Publish raw task IDs, deterministic graders, failures, confidence intervals and exact model/provider versions. Keep benchmark solutions and held-out prompts out of model context.

**Current status:** the PR adds the interfaces, lifecycle and regression tests, but this benchmark has not yet been run. No superiority claim is made. The host provider, sandbox, durable store, approval service, native device bridge and provider-specific tool-call adapter remain integration work.

## Approval and lifecycle integrity

- Memory changes are approved against a SHA-256 digest of the exact task id, proposal id/rationale, change index, operation, target memory id, layer, content and source references. The Director snapshots the proposal before awaiting the verifier and applies only that private snapshot.
- Device actions are normalized into a fresh frozen discriminated-union object before authorization. The resource identifier is selected by action kind (app id for open-app; file id for file operations); unrelated fields are discarded and required resource fields are mandatory. The broker receives an action digest, and the bridge executes the same frozen action snapshot after approval.
- Tool activation and retirement approvals carry distinct operation values, in addition to task, tool, version, digest and approval reference. An activation approval cannot be reused as a retirement approval.
- Tool build specifications are copied before asynchronous builder/hash work. The digest and saved artifact use the same immutable snapshot.
- Only one artifact version is marked active. Activating a newer version deactivates the previous version and clears the registry's installation-availability flag so the host must re-install or re-verify the new adapter. Retirement locates the actual active version even if a newer unactivated candidate exists.
- Artifact status updates are persisted before registry changes. If a multi-record write fails, prior artifact records are restored; if registry mutation fails, persisted records are rolled back. Durable host stores should provide transactional writes where available and must surface rollback failures.


## Durable artifact-store adapter

`runtime/adapters/director/FileToolArtifactStore.ts` implements the existing `ToolArtifactStore` contract for a private local application-data directory. It stores versioned JSON records, uses owner-only modes where supported, writes through temporary files and atomic rename, syncs the file and containing directory, returns detached copies, and rejects unsafe IDs, symlinked tool directories, corrupt records, identity mismatches and oversized records.

This adapter persists tool source as inert data. It does not import, evaluate, or execute it. It is single-process local storage, not a multi-host database, and does not encrypt source at rest. A production host must choose an OS-protected/encrypted app-data location and provide a transactional database or explicit cross-process locking if multiple processes may write artifacts.

The adapter is not connected to `apps/web/directorRuntime.ts` yet. The runtime must remain fail-closed until a real disposable sandbox, bounded builder, and authenticated approval UI are implemented and tested together. Durable storage alone is not permission to test or activate generated code.
