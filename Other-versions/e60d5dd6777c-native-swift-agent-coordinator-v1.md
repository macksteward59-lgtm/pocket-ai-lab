# Native Swift Agent Coordinator v1

## Current behavior

`NativeAgentCoordinator` runs a caller-supplied ordered plan of logical agent roles over one loaded native model session. The app obtains that session from the shared `NativeInferenceRuntime` and exact `ModelPoolLease`; every role's generation is routed through the same FIFO `InferenceScheduler` as ordinary chat.

The native iOS Local AI screen exposes Chat and Agent Team modes. The default Agent Team plan runs six sequential logical roles—Reasoner, Researcher, Engineer, Security Analyst, Critic, and Validator—over one local model session. The UI displays each actual role response. These are logical roles, not six independent agents or models. The Researcher is limited to supplied task/context; it does not perform web research.

## Resource and input bounds

The coordinator enforces explicit UTF-8 byte and work limits:

- Task ID and conversation ID: at most 512 bytes each.
- Task objective: at most 4,000 bytes.
- Required capabilities: at most 16 entries, each at most 64 bytes.
- Plan: 1–8 roles, unique role IDs of at most 64 bytes, and instructions of at most 1,000 bytes.
- Generation: 1–512 tokens per role and finite temperature from 0 through 2.
- Prompt: at most 12,000 bytes.
- Prior context: only the last four role outputs, each truncated to 1,200 bytes with a visible truncation marker.
- Model response: at most 8,000 UTF-8 bytes per role; oversized output is cancelled and rejected.
- Native chat and Agent Team share one scheduler permit domain; scheduler admission is held for the complete token stream and cancellation drain.

These are byte/resource bounds, not a guarantee that a model tokenizer or context window has a matching character ratio. Memory estimates for the loaded GGUF remain advisory and require physical-device calibration.

## Safety and cancellation

- The coordinator is not an authorization service and exposes no APEX/East methods.
- Agent output is explicitly treated as untrusted proposal text in subsequent prompts.
- It does not execute tools, modify files, approve actions, validate evidence, issue receipts, perform external research, or persist memory.
- One task may run at a time per coordinator instance.
- Each decode has a request UUID; cancellation targets only the active request and is drained before the scheduler permit is released.
- Empty/oversized tasks, invalid plans, duplicate role IDs, invalid generation settings, oversized prompts/responses, and empty model output are rejected.
- Cancellation or inference errors propagate; the coordinator does not synthesize a successful result.
- Role labels are descriptive prompt context only. A role called `Director`, `Security Analyst`, or `Validator` gains no additional authority or trust from its name.

## Core and specialist plans

The caller supplies the plan. This permits permanent roles (Director as planner, Reasoner, Researcher, Engineer, Security Analyst, Critic, Validator, Archivist) and dynamic specialists (for example Swift/iOS, Python, cryptography, database, or performance) without hard-coding a closed roster. The initial iOS UI exposes a fixed six-role safe subset; dynamic specialist selection and per-role model routing remain future work.

## Workspace navigation

The native Web Workspace restores its saved address only once, does not reload on ordinary SwiftUI updates or in-page navigation, and only reloads after an explicit Open request. Top-level navigation is restricted to HTTPS, plus HTTP loopback for local development; embedded credentials and non-web schemes are rejected. The remote workspace server must still enforce authentication and authorization. This client-side URL policy is not a server-side security boundary.

## Remaining integration gates

1. Bind the coordinator's session to a trusted runtime proof only after production key provisioning, signer, rotation/revocation, and replay-safe verification are available. Until then, app trust stays `Unverified`.
2. Add durable message-bus persistence and replay protection; current coordinator results are in-memory.
3. Add per-role model routing and bounded parallelism only when independent sessions and resource accounting are available.
4. Integrate tool proposals through existing APEX/East exact-scope authorization; never let model output invoke tools directly.
5. Validate on a physical iPhone and record exact device/build/model/hash/generation evidence, including memory, thermal, battery, and Metal behavior.

The native Agent Team UI is a bounded sequential local-model workflow, not production multi-agent independence, verified runtime readiness, durable memory, tool execution, or full device acceptance.
