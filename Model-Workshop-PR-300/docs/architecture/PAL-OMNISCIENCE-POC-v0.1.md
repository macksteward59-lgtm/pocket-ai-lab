# PAL Omniscience — Proof of Concept v0.1

**Status:** Experimental, synthetic-only research prototype  
**Branch:** `codex/pal-omniscience-poc`  
**Scope:** Security world-model foundation, finite-state invariant checking, hypothesis generation, and experiment prioritization.

## Objective

Demonstrate the first executable slice of the Research Intelligence direction without replacing the existing agent system or crossing the APEX/East trust boundary.

This POC turns an explicitly supplied synthetic application model into:

1. A validated, immutable security world model.
2. A finite-state check of a tenant-isolation invariant.
3. A traceable, explicitly unverified research hypothesis when the model contains a counterexample.
4. A deterministic, proposal-only experiment ranked by impact, uncertainty, information gain, cost, and risk.
5. A report that explicitly states that no target was authorized and no experiment was executed.

## Architecture

```
Synthetic fixture
      |
      v
SecurityWorldModel
  - schema and reference checks
  - bounded collections
  - immutable snapshot
      |
      v
FiniteStateSecurityChecker
  - enumerates identity/resource pairs
  - evaluates tenant-isolation guard state
  - returns counterexamples or inconclusive
      |
      v
HypothesisEngine
  - derives a traceable research hypothesis
  - preserves evidence references
  - never marks a hypothesis verified
      |
      v
ExperimentPlanner
  - ranks synthetic-only proposals
  - deterministic bounded score
  - proposal-only; no execution adapter
      |
      v
ResearchPocReport
  - unverified
  - authorized=false
  - executionPerformed=false
```

## First demonstration

The included fixture models two tenants, a document owned by tenant A, a member identity from tenant B, and a read operation whose modeled tenant-isolation guard is absent.

The finite-state checker produces a model counterexample: the supplied model predicts an allow decision for a cross-tenant read where the invariant requires denial.

The output is a **potential weakness in the synthetic model**, not a real vulnerability finding. It is deliberately labeled unverified. The evidence reference points only to a synthetic fixture fact and is not a signed evidence receipt.

## Run

Requires the repository's documented Node.js 22+ toolchain and installed dependencies.

```bash
npm run poc:research
npm run test:engine
npm run build
```

## Safety and trust boundaries

- The POC accepts fixture IDs beginning with `synthetic:` only.
- It has no network client, target connector, scanner, exploit runner, filesystem access, or tool-execution adapter.
- It does not call or replace APEX, East/e3, ExploitGym, BridgeGate, or the existing evidence system.
- A model counterexample is not a confirmed vulnerability.
- Hypotheses remain `unverified`.
- Experiment proposals remain `proposal-only`; authorization is `not-requested`.
- No POC output can set `authorized=true`, mint a voucher, approve an action, or manufacture trusted evidence.

## Known limitations

- The world model is manually supplied; source-code and runtime ingestion are not implemented.
- The finite-state checker currently handles tenant isolation only.
- Guard states are explicit model inputs; the checker does not independently inspect application code.
- The experiment planner ranks proposals but does not execute them.
- The POC is deterministic and model-based, not an autonomous LLM-driven research swarm.
- The in-memory model and report are not durable, signed, or production evidence.
- No physical iPhone integration is included.

## Next gates

1. Add provenance-aware ingestion adapters for static-analysis and administrator-supplied architecture data.
2. Extend invariant definitions and finite-state checking with property-based tests.
3. Add an independent counterexample minimizer and assurance pass.
4. Connect only through existing governed orchestration ports after a separate integration review.
5. Build PAL-X evaluation cases with hidden expected outcomes and negative controls.

The next gates must not weaken the existing APEX/East authorization and evidence contracts.
