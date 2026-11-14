# PAL Interprocedural Python Data-Flow POC v0.1

## Purpose

Extend the existing Python AST source-to-sink research analyzer beyond a single function. This implementation computes bounded local function summaries and follows simple positional argument flow through helper calls within one source file.

## Analysis model

1. Parse source with Python's standard AST parser. Submitted source is never imported, compiled, evaluated, or executed.
2. Build a bounded map of local function definitions.
3. Compute fixed-point summaries mapping a function's positional parameter indexes to selected sensitive sink sites reachable through that parameter.
4. Propagate summaries through local helper calls for a bounded number of rounds.
5. At call sites, connect known source origins in the caller to sink sites in the callee.
6. Emit a distinct `analysis_scope=interprocedural` signal. The existing TypeScript bridge preserves that scope and the source research pipeline independently binds both source and sink excerpts to the source digest.

## Bounds

- Source remains capped at 1 MB.
- At most 200 local functions are summarized.
- Summary propagation is capped at 8 rounds.
- Output remains capped by the existing 100-signal limit.
- No dynamic import, reflection, source execution, network, or target interaction.

## Unsupported or incomplete semantics

- Cross-file calls and imported function summaries.
- Keyword arguments and starred arguments; these cause partial/inconclusive analysis rather than positional misbinding.
- Attribute/object/container flows, alias analysis, closures, decorators, dynamic dispatch, monkey patching, reflection, and framework semantics.
- Sanitizers, validation semantics, branch/path feasibility, exception behavior, and precise recursion handling.
- Complex control flow is marked partial; a missing signal does not establish safety.

## Interpretation

A cross-function source-to-sink signal is a review lead, not a vulnerability verdict. It does not prove the call is reachable, that the source is attacker-controlled in deployment, that a guard is absent, or that the sink is exploitable. All outputs remain unverified, unauthorized, and non-executing.

## Trust boundaries

The analyzer has no authority to authorize actions or issue trusted receipts. APEX/Director, East/e3, ExploitGym, BridgeGate, RuntimeController, LlamaEngine, signed evidence, and approval semantics are unchanged.
