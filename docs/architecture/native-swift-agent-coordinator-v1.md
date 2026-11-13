# Native Swift Agent Coordinator v1

## Current behavior

`NativeAgentCoordinator` runs a caller-supplied ordered plan of logical agent roles over one injected `LlamaEngine` and one loaded `RuntimeSession`. Each role receives the original task plus prior role outputs, then emits a versioned `AgentMessageEnvelope`. Messages are linked by parent message ID and monotonically increasing per-task sequence.

This is sequential multi-role orchestration, not parallel independent agents. In the current implementation all roles share the same inference session; role identity and instructions shape the prompts. A future model pool can route roles to different runtime sessions without changing the task/message envelope.

## Safety and cancellation

- The coordinator is not an authorization service and exposes no APEX/East methods.
- Agent output is explicitly treated as untrusted proposal text in subsequent prompts.
- It does not execute tools, modify files, approve actions, validate evidence, issue receipts, or persist memory.
- One task may run at a time per coordinator instance.
- Each decode has a request UUID; cancellation is sent only for the active request.
- The underlying runtime rejects overlapping generation on one session and ignores stale cancellation IDs.
- Empty plans, duplicate role IDs, invalid generation settings, and empty model output are rejected.
- Cancellation or inference errors propagate; the coordinator does not synthesize a successful result.

## Core and specialist plans

The caller supplies the plan. This permits permanent roles (Director as planner, Reasoner, Researcher, Engineer, Security Analyst, Critic, Validator, Archivist) and dynamic specialists (for example Swift/iOS, Python, cryptography, database, or performance) without hard-coding a closed roster.

Role labels are descriptive prompt context only. A role called `Director`, `Security Analyst`, or `Validator` gains no additional authority or trust from its name.

## Next integration gates

1. Add an actual runtime proof verifier and bind the coordinator's session to a verified model ID and file hash.
2. Introduce a model pool and per-role model routing, with resource reservations tied to actual loaded sessions.
3. Add durable message-bus persistence and replay protection; current coordinator results are in-memory.
4. Add bounded parallelism only when the runtime supports independent sessions and resource accounting.
5. Integrate tool proposals through existing APEX/East exact-scope authorization; never let model output invoke tools directly.
6. Validate on a physical iPhone and record the exact device/build/model/hash/generation evidence.

No physical-device readiness or full production multi-agent capability is claimed by this slice.
