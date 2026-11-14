# PAL Cross-file Python Data-flow POC v0.1

## Purpose

Add the first real cross-file source-to-sink analysis stage after the multi-file evidence contract. The sidecar parses a bounded submitted Python project, resolves exact in-manifest absolute imports, summarizes simple imported function parameters that reach selected sinks, and connects caller-side request input to those summaries.

## Supported path

1. Parse each submitted file independently with Python AST; never import, compile, evaluate, or execute it.
2. Index submitted `.py` modules by their relative project paths, including a conventional source-root alias.
3. Resolve exact absolute `import` and `from module import symbol` references only when one exact module match exists.
4. Summarize simple positional function parameters that reach recognized sinks in imported modules.
5. Follow direct imported function calls and module-qualified imported function calls.
6. Emit source and sink paths, lines, expressions, and exact excerpts; the TypeScript multi-file evidence binder can bind each endpoint to its own SHA-256 digest.

## Bounds

- 1–50 files, 1 MB per file, 5 MB aggregate.
- 20,000 AST nodes per file, 100,000 aggregate.
- 500 import edges and 100 observations.
- No dynamic import, runtime sys.path inspection, package installation, network, or filesystem access to resolve project imports.

## Explicit limitations

- Absolute imports only; relative imports, star imports, ambiguous and external modules remain unresolved.
- Direct imported function calls only; no cross-module helper-chain propagation in this first increment.
- Simple positional argument propagation only; keyword/starred arguments are not mapped.
- No object/container/attribute alias analysis, decorators, dynamic dispatch, monkey-patching, sanitizers, path feasibility, or framework semantics.
- Branches and loops are traversed conservatively but are not path-verified.
- A resolved import edge is not proof that a call is reachable.
- All observations remain unverified review leads, not vulnerability findings.

## Trust boundaries

The endpoint accepts source text supplied by the caller. It does not read local paths, import project code, execute code, contact targets, authorize testing, or issue trusted receipts. APEX/Director and existing evidence authority remain unchanged. The output always reports `authorized: false` and `executes: false`.
