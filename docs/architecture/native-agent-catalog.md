# Native agent catalogue and specialist templates

## Permanent team

The native catalogue defines eight permanent logical roles in a stable sequence: Director, Reasoner, Researcher, Engineer, Security Analyst, Critic, Validator, and Archivist. The catalogue maps each role to a bounded instruction, message type, and required model-routing labels.

These are logical roles, not eight resident models or eight independent processes. The native coordinator executes roles sequentially and the ModelPool may reuse one local model or load different local profiles as leases permit. Capability labels select candidate models only; they do not grant tools, permissions, trust, quality, or runtime readiness.

## Dynamic specialists

The first specialist template set includes Swift/iOS, Python debugging, network security, database optimization, cryptography, performance, mathematics, and documentation. A caller must explicitly select a known template and supply a bounded task-scoped instance ID. Unknown templates and malformed IDs fail closed.

A specialist replaces a selected role in a plan; it is not silently appended. The native coordinator currently accepts at most eight steps, so the catalogue enforces the same maximum. No LLM-generated agent definition is executed or activated by this catalogue.

## Execution and trust limits

The catalogue only produces NativeAgentStep values. It does not call an inference provider, load a model, select permissions, invoke tools, persist memory, or authorize consequential actions. A role is not considered active until the coordinator reports an actual model call. All model outputs remain untrusted proposals and existing APEX/East authorization remains independent.

## Follow-on integration

The native Local AI screen now uses this catalogue for its default eight-role plan and exposes operator-controlled role selection plus specialist replacement. The app derives required routing labels from the selected plan and sends the plan through the existing coordinator, which preflights every route before the first model load/generation. The one-resident-model pool, sequential execution, cancellation, and durable task-history message sink remain the execution path. A specialist is not shown as active until its actual local model call completes. The app integration is in draft PR #156 and remains subject to exact-head iOS CI and physical iPhone Air acceptance.
