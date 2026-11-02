# Consumer Prototype Acceptance Criteria

This document defines the minimum bar for a usable Pocket AI Lab prototype. A passing TypeScript build alone is not product acceptance.

## User experience
- Responsive browser interface usable on current iOS Safari and desktop browsers.
- Installable PWA shell with offline access to the application shell.
- Clear navigation for Chat, Agent Team, Memory, Activity, and Settings.
- Conversation creation, prompt submission, readable responses, loading/error states, and accessible keyboard controls.
- No fabricated AI response when no inference provider is connected.

## Inference and privacy
- Local inference is the default path; llama.cpp server can be configured without changing orchestration code.
- Provider credentials are held server-side, never in browser storage or shipped JavaScript.
- Cloud inference is opt-in and explicitly disclosed before sending content to a remote provider.
- Requests have size limits, timeouts, safe error handling, and no prompt logging by default.
- UI accurately distinguishes configured, reachable, and unavailable model states.

## Collaboration and governance
- Agent roles are presented as active only when real inference calls have executed for those roles.
- Every agent output is attributable to an agent, model, task, and evidence references where available.
- Deliberation must preserve disagreement; no false consensus or fabricated verification.
- Model output is untrusted proposal data. It cannot authorize execution, grant permissions, or create APEX receipts.
- Consequential operations fail closed unless the existing APEX/East authorization path independently approves them.
- Repair actions require their own independent authorization.

## Memory
- Persistent memory is opt-in, inspectable, editable, deletable, and provenance-aware.
- No conversation is silently promoted to verified long-term memory.
- Storage is encrypted at rest where supported by the target platform; key handling must be documented.

## Release engineering
- Reproducible setup from a clean checkout.
- Automated unit/integration tests for server, inference adapter, orchestration, and governance boundaries.
- CI build and test jobs required on every pull request.
- Dependency and secret scanning; no credentials committed.
- A release build and tested install path for the intended target devices.
- Documented limitations, supported model formats, memory requirements, and recovery steps.

## Current prototype slice
The web shell on this tree loads without reading missing settings fields. Chat and Agent Team call the llama.cpp `InferenceProvider` and fail closed when the server is unreachable or the payload is rejected. "Local model ready" requires a successful loopback `/health` check. Memory, activity, cloud-provider consent, and APEX/East runtime integration remain explicit about what is not connected. Model text is still not an authorization receipt.
