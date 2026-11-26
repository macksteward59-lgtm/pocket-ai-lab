# PAL Omniscience — Integrated Proof of Concept v0.2

**Status:** Working, CI-validated synthetic research proof of concept  
**Pull request:** [#71 — Integrated PAL Omniscience and source evidence POC](https://github.com/macksteward59-lgtm/pocket-ai-lab/pull/71)  
**Scope:** Local, synthetic model checking plus non-executing static-source evidence ingestion

## What this proves

The repository now contains an executable, tested research loop that:

1. Represents a synthetic application as components, identities, resources, operations, invariants, and provenance facts.
2. Enumerates cross-tenant identity/resource combinations in a bounded finite-state model.
3. Produces a counterexample, no-counterexample, or inconclusive result.
4. Converts counterexamples into explicitly unverified hypotheses.
5. Ranks synthetic experiment proposals without executing them.
6. Sends source text to the existing loopback-only static-analysis sidecar.
7. Binds sidecar observations to the exact submitted source digest, filename, line, and excerpt.
8. Preserves truncation and uncertainty rather than treating missing observations as proof of safety.
9. Benchmarks vulnerable, secure, and unknown synthetic states against hand-authored expected outcomes.

This is a working foundation for application-aware security research. It is not yet a real-world autonomous bug bounty researcher.

## Architecture

```
                         PAL Research POC
                               |
                +--------------+--------------+
                |                             |
                v                             v
       Security World Model           Source Research Pipeline
                |                             |
                v                             v
       Finite-State Checker        Loopback Static Analysis Bridge
                |                             |
                v                             v
       Counterexample /              Existing non-executing
       No counterexample /           static-analysis sidecar
       Inconclusive                            |
                |                              v
                v                     Source Evidence Adapter
       Hypothesis Engine                       |
                |                              v
                v                     Immutable unverified
       Experiment Planner             source-review candidates
       (proposal only)                         |
                |                              |
                +---------------+--------------+
                                |
                                v
                    Independent review required
                                |
                                v
                    Future validation milestones
```

## Main components

| Component | Responsibility |
|---|---|
| `SecurityWorldModel.ts` | Validates and freezes the synthetic application model |
| `FiniteStateSecurityChecker.ts` | Enumerates bounded tenant-isolation states |
| `HypothesisEngine.ts` | Turns counterexamples into unverified research hypotheses |
| `ExperimentPlanner.ts` | Ranks synthetic, proposal-only experiments |
| `ResearchPoc.ts` | Runs the synthetic research loop |
| `StaticAnalysisOrchestratorBridge.ts` | Calls the existing loopback-only static-analysis sidecar |
| `SourceEvidenceAdapter.ts` | Verifies digest, path, line, excerpt, limits, and provenance |
| `SourceResearchPipeline.ts` | Connects sidecar analysis to immutable evidence candidates |
| `ResearchBenchmark.ts` | Scores deterministic expected outcomes on synthetic fixtures |

## Run it

From the repository root:

```bash
npm install
npm run poc:research
npm run benchmark:research
npm test
```

The source research pipeline expects the existing static-analysis sidecar to be available on loopback. It does not open a public listener or contact a remote target.

## Benchmark cases

The current benchmark contains three deliberately small synthetic cases:

| Case | Expected result | Purpose |
|---|---|---|
| Vulnerable tenant boundary | Counterexample | Detect a modeled cross-tenant allow |
| Enforced tenant boundary | No counterexample | Avoid flagging a modeled enforced guard |
| Unknown tenant boundary | Inconclusive | Preserve uncertainty instead of assuming safe or vulnerable |

Latest CI benchmark output: **3/3 expected outcomes matched**. This measures agreement with hand-authored fixtures only; it is not real-world precision, recall, or bug bounty performance.

## Latest validation

At commit `a85fa0c6580a68f00af74e2ed4edece5d9e9b2b4`:

- TypeScript build passed.
- Intelligence: 62 test files, 510 tests passed.
- Research POC CLI completed.
- Synthetic benchmark: 3 passed, 0 failed, 1 inconclusive case.
- Adapter/runtime: 26 test files, 300 passed, 2 skipped.
- Local GGUF tests: 10 passed.
- Eagle Python tests: 10 passed, 4 skipped.
- Custom GGUF Python tests: 7 passed.
- Desktop tests: 16 passed.
- Consumer prototype CI passed.
- Governance sidecar CI passed.
- Cursor collaboration plugin CI passed.

See the [integrated PR and its Actions checks](https://github.com/macksteward59-lgtm/pocket-ai-lab/pull/71).

## Safety and evidence contract

- Synthetic model checking is restricted to fixture identifiers beginning with `synthetic:`.
- Static analysis is non-executing and loopback-only.
- No live target is contacted and no source code is executed.
- Sidecar output is untrusted input and must match the submitted source.
- Every source candidate remains low-confidence and unverified.
- Truncated analysis remains partial.
- A model counterexample is not a real-world finding.
- Experiment proposals are never executed by this POC.
- No authorization, signed receipt, or trusted evidence attestation is minted here.
- APEX, East/e3, ExploitGym, BridgeGate, RuntimeController, LlamaEngine, and existing trusted evidence semantics remain unchanged.

## Known limitations

Not yet implemented:

- AST parsing and interprocedural call graphs.
- Taint propagation from sources to sensitive sinks.
- Framework-aware authentication and authorization modeling.
- Multi-file dependency and data-flow reasoning.
- Dynamic testing against explicitly authorized targets.
- Stateful workflow and race-condition analysis.
- Independent agent critique and evidence adjudication.
- Signed production evidence and durable case management.
- Physical iPhone app integration and on-device inference for this research workflow.

## Next engineering milestones

1. **AST and program graph:** parse supported languages into bounded syntax, symbol, call, and data-flow graphs.
2. **Taint analysis:** model untrusted sources, transformations, sanitizers, and sensitive sinks with path evidence.
3. **Authorization semantics:** map routes, middleware, identity, tenant, role, ownership, and resource decisions.
4. **Temporal reasoning:** model multi-step business workflows, state transitions, and invariants.
5. **Differential validation:** compare explicitly authorized test identities and roles with safe, non-destructive test plans.
6. **Independent review:** require separate agents and deterministic validators to challenge hypotheses before a human-approved finding is produced.
7. **Benchmark expansion:** add larger, versioned, reproducible synthetic and public training-lab cases with ground truth and regression tracking.

The goal is not to maximize alert volume. It is to maximize verified security insight while measuring false positives, uncertainty, reproducibility, and scope compliance.
