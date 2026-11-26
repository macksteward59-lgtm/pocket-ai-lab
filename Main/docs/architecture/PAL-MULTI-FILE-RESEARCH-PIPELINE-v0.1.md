# PAL Multi-file Research Pipeline v0.1

## Purpose

Connect the bounded Python project analyzer to the TypeScript research layer and independently bind its claims to immutable source provenance.

## End-to-end flow

1. A caller supplies an in-memory manifest of relative paths and source text to `MultiFileSourceResearchPipeline`.
2. The TypeScript bridge sends the manifest only to the loopback sidecar endpoint `POST /api/v1/governance/analyze-project`.
3. The sidecar parses Python source without importing or executing it and returns bounded import edges, unresolved imports, source/sink observations, parser status, and limitations.
4. The bridge rejects any response that claims authorization or execution and validates every response field and collection bound.
5. `bindMultiFileEvidence` independently validates that both endpoint excerpts match the exact submitted file and line, verifies a directed path exists in the returned import graph, and calculates a separate SHA-256 digest for each file.
6. The final report preserves upstream partial-analysis status, unresolved imports, per-file digests, evidence references, and unverified classification.

## Security properties

- The sidecar URL must be loopback.
- The bridge does not call any target URL; only the local sidecar endpoint is contacted.
- No source is imported, compiled, evaluated, or executed.
- Sidecar output is treated as untrusted input.
- Fabricated source/sink excerpts, out-of-manifest graph edges, invalid paths, malformed imports, and authorization/execution claims are rejected.
- Any non-parsed analyzer status or unresolved imports make the bound evidence report partial.
- Every candidate remains `unverified`; no vulnerability confirmation or trusted receipt is created.

## Scope

This pipeline composes the multi-file evidence binder and direct-import Python analyzer. It does not add cross-module helper-chain propagation, relative import resolution, keyword/starred argument mapping, alias analysis, object/container flow, sanitizers, framework semantics, or path feasibility. Import reachability does not prove runtime call reachability.

## Governance

APEX/Director remains the authority for policy and approvals. East/e3 remains responsible for durable workflow execution. The analyzer and bridge have no authority to authorize tests or modify targets. Existing ExploitGym, BridgeGate, RuntimeController, LlamaEngine, and signed evidence boundaries are unchanged.
