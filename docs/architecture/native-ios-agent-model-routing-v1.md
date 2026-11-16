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
- This increment does not yet change NativeAgentCoordinator's sequential single-lease execution path. Integration requires safe per-role lease acquisition/release and tests for cancellation, durable message persistence, and memory pressure.

## Validation

The XCTest suite covers full capability matching, deterministic tie-breaking, refusal of partial matches, duplicate model rejection, and malformed input. The repository iOS workflow must pass on the resulting branch before this foundation is treated as validated.
