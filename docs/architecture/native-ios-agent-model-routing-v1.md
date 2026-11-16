# Native Agent Model Routing Foundation

## Purpose

The native iOS runtime now has a deterministic local model-candidate selector for logical agent roles. A route request declares an agent identity and required capability labels. The router selects only a profile whose capability set contains every requested capability.

## Selection order

1. Reject malformed requests, invalid profiles, and duplicate model identifiers.
2. Require a complete capability-set match; partial matches are not eligible.
3. Prefer the highest explicit profile priority.
4. Break ties by lower declared memory estimate, then lexicographic model ID.

The result carries the exact model descriptor and declared memory estimate so a caller can request an exact NativeInferenceRuntime lease.

## Safety and integration boundary

- This is candidate selection, not proof that a model file exists or can be loaded.
- The caller must acquire the exact selected descriptor through NativeInferenceRuntime; model-pool memory admission remains authoritative.
- A failed acquisition does not silently route to another provider or model.
- Capability labels are routing metadata, not tool permissions.
- Model outputs remain untrusted proposals.
- This router does not issue Evidence, attest runtime readiness, authorize actions, or bypass APEX/Director, East/e3, BridgeGate, or human approval.
- The routed coordinator initializer now accepts explicit local profiles. Each step may declare its own required capability labels; an empty step set inherits the task's required capabilities.
- The coordinator resolves every step's route before loading the first model. A missing or malformed specialist route fails the plan before partial inference.
- Each routed role acquires the exact selected descriptor through NativeInferenceRuntime, generates under the shared scheduler, and releases that exact lease after generation or cancellation drain. No silent model/provider fallback is performed.
- The original fixed-lease initializer remains available for existing callers. Role messages continue to be sequential, linked, and untrusted proposals.
- Capability labels remain routing metadata only. They do not grant tools, approvals, Evidence authority, runtime attestation, or APEX/East permissions.
- Cancellation requested while a routed model is loading is latched by the coordinator. Once the exact lease arrives, it is released without starting generation; a focused XCTest covers this path.
- Remaining integration gates include durable message persistence, memory-pressure behavior with multiple resident profiles, and physical-device validation.

## Validation

The XCTest suite covers full capability matching, deterministic tie-breaking, refusal of partial matches, duplicate model rejection, malformed input, exact per-agent lease acquisition/release, preflight rejection when a specialist route is missing, and cancellation during a pending routed model load. The repository iOS workflow must pass on the resulting branch before this foundation is treated as validated.
