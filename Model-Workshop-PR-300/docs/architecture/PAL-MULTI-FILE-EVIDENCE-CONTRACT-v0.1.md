# PAL Multi-file Evidence Contract v0.1

## Purpose

Introduce a bounded evidence contract needed before cross-file static analysis is implemented. This layer accepts proposed observations from a future resolver/analyzer and independently binds both endpoints to exact submitted files, line excerpts, and per-file SHA-256 digests.

## Contract

- Manifest: 1–200 unique relative source paths.
- Per-file source limit: 1 MB UTF-8; aggregate limit: 10 MB.
- Resolved import graph: at most 2,000 directed edges, both endpoints must exist in the submitted manifest.
- Unresolved imports are retained with a reason and force report completeness to `partial`.
- Cross-file observations: at most 100; each source and sink endpoint must match the exact submitted line excerpt.
- A cross-file observation is accepted only when a directed path exists in the submitted resolved-import graph from source file to sink file.
- Each candidate carries separate source and sink digests and a composite evidence URI.
- Duplicate edges and observations are deduplicated.

## Trust and interpretation

This is a provenance-binding contract, not a cross-file analyzer or import resolver. Import edges are supplied by the caller and are not independently proven to represent runtime calls. A graph path does not prove call reachability, taint propagation, authorization, exploitability, or impact. Candidates remain unverified static-review signals. The contract never authorizes actions, executes source, contacts targets, or creates trusted receipts.

## Deliberate limitations

- No import parsing or module resolution is performed here.
- No Python source is imported, compiled, evaluated, or executed.
- No cross-file taint propagation is implemented by this change.
- Cycles are bounded by visited-node tracking; ambiguous, dynamic, missing, external, and unsupported imports must be represented as unresolved.
- Missing observations are not evidence of absence.

## Next integration

A later analyzer can populate the manifest and import graph using a non-executing parser, then submit cross-file flow candidates to this binder. The pipeline should retain per-file digests and reject candidates that cannot be rebound exactly.
