# PAL Source Evidence Ingestion v0.1

**Status:** Experimental; non-executing source-review adapter  
**Branch:** `codex/pal-source-evidence-ingestion`  
**Depends on:** PAL Omniscience POC PR #69

## Purpose

The existing Python sidecar can return static pattern observations for a supplied source file. This adapter makes those observations usable by the research-science package without promoting them to vulnerability findings.

## Data flow

```
Operator-supplied source text
        |
        v
Existing non-executing static analyzer
        |
        v
StaticAnalysisReport
  authorized = false
  executes = false
        |
        v
SourceEvidenceAdapter
  - validate relative filename
  - enforce source/observation bounds
  - verify claimed line and excerpt against exact source
  - calculate SHA-256 of exact source bytes
  - deduplicate repeated signals
        |
        v
Unverified SourceEvidenceCandidate[]
  - source digest
  - source line
  - stable evidence reference
  - conservative confidence (0.2)
  - classification = static-review-signal
        |
        v
Human / independent analysis
```

## Epistemic contract

A regex or static pattern match is not a vulnerability. In particular:

- A dangerous-looking call may be unreachable, guarded, or fed only trusted data.
- A source excerpt does not establish data flow, exploitability, impact, or affected deployment.
- A truncated analysis is explicitly marked partial; no-result does not mean clean.
- Candidate confidence is deliberately low and cannot be raised by this adapter.
- The adapter cannot set authorization, execute source, contact a target, or confirm a vulnerability.

## Evidence binding

Each candidate is tied to:
- exact SHA-256 of the supplied UTF-8 source text;
- relative filename;
- validated one-based line number;
- excerpt checked against that exact line;
- stable source evidence URI.

The URI is a provenance pointer, not a signed receipt or cryptographic attestation. It does not replace APEX/East evidence.

## Bounds

- Source input: 1,000,000 UTF-8 bytes.
- Observations: 100 maximum.
- Filename: 200 characters, relative path only, no traversal segments.
- Excerpt: 180 characters.
- Remediation: 500 characters.

## Tests

```bash
npm run test:engine
npm run build
```

The adapter is tested for source digest binding, excerpt/line mismatch, out-of-range references, unsupported labels, authorization/execution claims, path traversal, deduplication, truncation, bounds, and immutability.

## Not implemented

- AST or interprocedural data-flow analysis.
- Framework-aware authentication/authorization semantics.
- Call-graph or dependency graph construction.
- Live application testing or exploit validation.
- Signed evidence receipts or durable evidence storage.
- Integration that automatically elevates candidates into the Security World Model.

These remain separate research milestones.


## Integrated research pipeline

`SourceResearchPipeline` now connects the existing loopback-only static-analysis bridge to this adapter. It rejects a sidecar filename that differs from the submitted filename, binds the returned observations to the exact submitted source, and preserves the upstream truncation flag. Its result contains source-review context and immutable unverified candidates only; it does not promote them to findings or authorize tests.
