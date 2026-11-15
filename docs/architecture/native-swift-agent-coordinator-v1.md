# Native Swift Agent Coordinator v1

## Current behavior

`NativeAgentCoordinator` runs a caller-supplied ordered plan of logical agent roles over one injected `LlamaEngine` and one loaded `RuntimeSession`. Each role receives the original task plus bounded prior role outputs, then emits a versioned `AgentMessageEnvelope`. Messages are linked by parent message ID and monotonically increasing per-task sequence.

The native iOS Local AI screen exposes an Agent Team mode. Its default plan runs six sequential roles—Reasoner, Researcher, Engineer, Security Analyst, Critic, and Validator—over the same loaded local model session. The app displays each role's actual model response. These are logical roles, not six independent agents or models.

## Bounded execution

The coordinator enforces explicit limits:

- Task objective: at most 4,000 UTF-8 bytes.
- Required capabilities: at most 16 entries, each at most 64 UTF-8 bytes.
- Plan: 1–8 roles, unique IDs of at most 64 UTF-8 bytes, and instructions of at most 1,000 UTF-8 bytes.
- Generation: 1–512 tokens per role and finite temperature from 0 through 2.
- Prompt: at most 12,000 UTF-8 bytes.
- Prior context: at most the last four role messages, each truncated to 1,200 UTF-8 bytes with a visible truncation marker.
- Model response: at most 8,000 UTF-8 bytes per role; oversized output is cancelled and rejected.

These are safety/resource bounds for this coordinator, not a guarantee that a model's tokenizer or context window has a matching character ratio.

## Safety and cancellation

- The coordinator is not an authorization service and exposes no APEX/East methods.
- Agent output is explicitly treated as untrusted proposal text in subsequent prompts.
- It does not execute tools, modify files, approve actions, validate evidence, issue receipts, perform external research, or persist memory.
- One task may run at a time per coordinator instance.
- Each decode has a request UUID; cancellation is sent only for the active request.
- The underlying runtime rejects overlapping generation on one session and ignores stale cancellation IDs.
- Empty plans, duplicate role IDs, invalid generation settings, oversized tasks/prompts/responses, and empty model output are rejected.
- Cancellation or inference errors propagate; the coordinator does not synthesize a successful result.
- Role labels are descriptive prompt context only. A role called `Director`, `Security Analyst`, or `Validator` gains no additional authority or trust from its name.

## Core and specialist plans

The caller supplies the plan. This permits permanent roles (Director as planner, Reasoner, Researcher, Engineer, Security Analyst, Critic, Validator, Archivist) and dynamic specialists (for example Swift/iOS, Python, cryptography, database, or performance) without hard-coding a closed roster. The initial iOS plan is a fixed safe subset; dynamic specialist selection and per-role model routing are future work.

## Remaining integration gates

1. Bind the coordinator's session to a verified model ID and exact file hash only after trusted-key provisioning and runtime proof validation are complete. Until then, app trust stays `Unverified`.
2. Introduce a model pool and per-role model routing, with resource reservations tied to actual loaded sessions.
3. Add durable message-bus persistence and replay protection; current coordinator results are in-memory.
4. Add bounded parallelism only when the runtime supports independent sessions and resource accounting.
5. Integrate tool proposals through existing APEX/East exact-scope authorization; never let model output invoke tools directly.
6. Validate on a physical iPhone and record the exact device/build/model/hash/generation evidence.

The iOS Agent Team UI is a functional sequential local-model workflow, not production multi-agent independence, verified runtime readiness, or full device acceptance.
