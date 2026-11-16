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

A separate app integration must replace the duplicated six-role array in LocalChatView with a user-selectable bounded plan, expose specialist selection, and update acceptance tests. That integration must preserve preflight of every required route before the first model load/generation, sequential execution, cancellation, one-resident-model safety, and explicit disclosure when a specialist route is unavailable.
