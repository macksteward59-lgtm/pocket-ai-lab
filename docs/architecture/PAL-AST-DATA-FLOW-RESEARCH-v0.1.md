# PAL AST Data-Flow Research v0.1

**Status:** Implemented and CI-validated on `codex/pal-ast-dataflow-poc`  
**Parent POC:** [PAL Omniscience integrated POC](./PAL-OMNISCIENCE-INTEGRATED-POC-v0.2.md)

## Purpose

Replace regex-only suspicion with a bounded Python AST pass that can trace selected untrusted input expressions through simple local assignments to selected security-sensitive calls. The analyzer parses source text only; it does not import, compile, evaluate, or execute it.

## Pipeline

```
Submitted source + relative filename
             |
             v
Loopback-only FastAPI sidecar
             |
             +--> Existing text observations
             |
             +--> Python ast.parse (Python files only)
                         |
                         v
              Bounded AST node walk
                         |
                         v
              Simple local-name propagation
                         |
                         v
              Source-to-sink candidates
                         |
                         v
       Sidecar bridge schema / trust validation
                         |
                         v
       Verify exact source and sink line excerpts
                         |
                         v
       Bind both lines to source SHA-256 + filename
                         |
                         v
          Unverified research signal only
```

## Initial source and sink vocabulary

Sources currently recognized include Python expressions rooted at:

- `request.args`, `request.form`, `request.json`, `request.data`
- `request.values`, `request.cookies`, `request.headers`
- `flask.request.args/form/json`
- `input()`, `get_json()`, and `get_data()`

Sinks currently recognized include:

- Dynamic evaluation: `eval`, `exec`
- Process execution: selected `os` and `subprocess` calls
- Deserialization: selected `pickle`, `yaml`, and `marshal` calls
- SQL execution: `execute`, `executemany`
- Selected outbound HTTP clients: `requests` and `httpx` get/post calls

This vocabulary is intentionally small and explicit. It is not a complete source/sink catalog.

## Propagation model

The first implementation tracks simple assignments inside a single function or module scope:

```python
raw = request.args.get("query")
normalized = raw.strip()
payload = normalized
eval(payload)
```

The candidate records the input expression, sink expression, source and sink line numbers, relevant local variable names, and exact line excerpts. The TypeScript pipeline independently checks both excerpts against the submitted source and binds the path to the source SHA-256.

## Conservative outcomes

- `parsed`: supported straight-line statements were analyzed.
- `unsupported`: control-flow or statement constructs require more precise semantics; any emitted signals remain leads only.
- `syntax-error`: Python parsing failed; no conclusion about safety is made.
- `truncated`: source or analysis bounds were exceeded; no completeness claim is made.

Branches and loops are explored as isolated possible paths, without merging their resulting variable state. Their presence makes the report partial/unsupported. Signal count and AST node count are bounded.

## Explicit limitations

- No interprocedural or cross-file propagation.
- No attribute/container/heap alias analysis.
- No import alias or reflection resolution.
- No framework-specific request lifecycle or route binding.
- No sanitizer or validator semantics.
- No path feasibility or symbolic execution.
- No concurrency, async scheduling, race, or temporal business-logic analysis.
- No exploitability, impact, or vulnerability confirmation.
- No live target contact, dynamic test, or source execution.

A missing signal is not evidence that a program is safe. A reported flow is not a vulnerability finding.

## Validation cases

The tests cover direct request-to-eval flow, local assignment propagation into process execution, SQL and deserialization sinks, comments/string literals, branch partiality, parser errors, node/source limits, truncation, sidecar API exposure, and source excerpt tampering.

Run:

```bash
cd services/ai-integrator-automator
python -m pytest
```

Then from the repository root:

```bash
npm test
```


## CI validation

Validated head: `a1f2acea4d4f11f602b43d2e86a00a407d1e67bd`.

All four repository workflows passed:

- [Pocket AI Lab CI #862](https://github.com/macksteward59-lgtm/pocket-ai-lab/actions/runs/43629453423): TypeScript build; 62 intelligence test files / 512 tests; research POC and 3-case synthetic benchmark; 26 adapter/runtime test files / 300 passed / 2 skipped; remaining local GGUF, Eagle Python, custom GGUF, and desktop checks.
- [Governance sidecar CI #164](https://github.com/macksteward59-lgtm/pocket-ai-lab/actions/runs/43629453441): 27 Python tests passed and offline simulation passed (3 cases).
- [Consumer prototype CI #269](https://github.com/macksteward59-lgtm/pocket-ai-lab/actions/runs/43629453364): 31 test files / 256 tests passed, 13 additional test files / 150 passed / 1 skipped, plus build.
- [Cursor collaboration plugin CI #214](https://github.com/macksteward59-lgtm/pocket-ai-lab/actions/runs/43629453403): passed.

CI validates the implemented bounded behavior and integration tests; it does not establish real-world detection accuracy or completeness.
