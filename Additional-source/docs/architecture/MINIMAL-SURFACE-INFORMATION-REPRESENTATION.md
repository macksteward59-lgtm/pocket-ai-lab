# Minimal Surface Information Representation (MSIR)

## Status

Research and architecture proposal. This document does not change the production
message path, authorize latent transfers, or claim that a geometric model has
already improved compression. It defines a testable layer to evaluate between
model-specific latent extraction and the existing GIE sequence codec.

The current GIE1 implementation remains the baseline codec. MSIR is a proposed
representation/optimization layer, not a replacement for GIE1 or GCB1.

## 1. Design intent

The original Minimal Surface Theory concept was broader than reducing a tensor's
byte count. Its objective was to find a compact, stable representation that
preserves information and the relationships needed to reconstruct or use it.

The system should therefore optimize:

- information retained for the downstream task;
- relationships and ordering between information elements;
- storage and representation complexity;
- encoding/decoding energy and latency;
- stability when inputs are perturbed or distributions change.

The central research question is:

> What is the least costly representation that preserves the task-relevant
> information, relationships, and reconstruction behavior under explicit
> constraints?

"Minimal surface" is initially a conceptual and mathematical design principle.
A geometric surface, manifold, graph embedding, or curvature penalty must not
be assumed to be equivalent to semantic preservation. Each proposed geometric
quantity requires an explicit construction and an empirical test.

## 2. Notation and compatibility with the existing implementation

The current repository already defines the GIE sequence notation in
`PooledProductQuantizer.ts`. MSIR must use that notation rather than introduce
a conflicting meaning:

- **X — Source:** token-level source vectors.
- **Y — Structure:** ordered temporal segments and their pooled
  representatives.
- **Z — Compact code:** product-quantized codebook indices plus optional
  residual stages.

These meanings are grounded in the existing implementation. GIE's current
sequence codec preserves segment spans and order, but its decoded output is
pooled segment vectors—not the original token-by-token activation sequence.

The earlier Minimal Surface Theory notes also listed the symbols
`M, I, R, S, C, E, H, P, T, L, A, D` and the weighted objective:

`J = alpha*S + beta*C + gamma*E + delta*L + epsilon*D`

The available historical record does not establish a reliable, complete
definition for every symbol or establish that all of them were intended as
independent terms in this exact implementation. Therefore this document does
**not** assign speculative meanings to those symbols. Before implementing a
mathematical optimizer, the original glossary must be verified. For this
engineering proposal, use explicit names instead:

- `sourceVectors`: input activation sequence;
- `segments`: ordered temporal windows and their spans;
- `pooledRepresentatives`: vectors produced by the configured pooling rule;
- `codes`: codebook indices and residual-stage indices;
- `reconstruction`: decoded pooled representatives;
- `distortion`: separately measured numerical and task-level loss;
- `relations`: explicit ordering, adjacency, and protected boundaries.

This prevents a guessed historical definition from silently becoming a
repository-wide contract. Any future mathematical objective must document each
term, its units, normalization, measurement procedure, and source.

## 2.1 Existing Pocket AI Lab contracts that MSIR must preserve

MSIR is subordinate to the existing architecture:

- `LatentChannel.ts` owns protocol-v1 capability negotiation, model identity,
  codec selection, bounded transfer-envelope validation, and route identity.
- `LatentChannelRuntime.ts` coordinates codec execution, host authorization,
  payload storage, digest verification, replay protection, expiry, and receive
  validation. Its in-memory store and replay guard remain test/demo adapters.
- `PooledProductQuantizer.ts` owns GIE sequence pooling and product/residual
  quantization. It is same-model and bound to its codebook identity.
- `GIECodebookArtifact.ts` and GCB1 define the canonical codebook artifact and
  digest contract.
- The agent message bus carries control-plane messages and references; latent
  bytes remain out-of-band.
- Director/APEX remains the authorization authority and East/e3 remains the
  durable execution authority. An MSIR representation is data, never a grant
  of permission or evidence of approval.

MSIR may add a versioned representation structure before GIE encoding, but it
must not redefine the existing GIE1 wire format, GCB1 artifact, protocol-v1
envelope, model identity, or authorization contract. Any wire-visible
extension requires a separately versioned schema and explicit capability
negotiation. Older peers must continue to use the existing codec or text
fallback; they must never guess how to parse MSIR metadata.

## 3. Representation pipeline

1. **Capture X:** obtain a bounded sequence of token-level vectors from a
   runtime that explicitly supports sequence export. Bind the capture to the
   exact model ID and immutable revision, layer/position metadata, dtype, shape,
   task scope, and configured resource ceilings.
2. **Construct Y:** use the existing GIE segmentation semantics first: ordered
   temporal windows, token spans, and pooled representatives. MSIR experiments
   may add a separately versioned relationship sidecar for explicit adjacency,
   protected boundaries, or task-provided dependencies. Do not infer hidden
   semantic relations from vector proximity and treat them as facts.
3. **Optimize Y:** evaluate bounded candidate segmentations/representations
   against measured distortion and downstream task quality. Do not modify the
   GIE1 encoder's current segment/index layout in this stage.
4. **Encode Z:** pass the compatible pooled representation to the existing
   GIE1 encoder and exact GCB1 artifact. The existing codec owns its binary
   format, codebook digest, identity binding, and decoder compatibility.
5. **Decode:** reconstruct the pooled segment representatives using the exact
   matching GIE1/GCB1 artifacts. Restore the declared spans and ordering.
6. **Validate:** compare reconstruction and any MSIR sidecar relations against
   the source fixture and measure downstream task behavior. Reject or fall
   back to the existing latent codec/text path when constraints are not met.

Current GIE1 decoding reconstructs ordered pooled segment vectors; it does not
reconstruct every original token vector. MSIR must preserve that distinction
and must not label pooled-segment reconstruction as lossless token recovery.

## 4. Objective and constraints

The earlier notes record a weighted objective in the form:

J = alpha*S + beta*C + gamma*E + delta*L + epsilon*D

The meanings, units, and normalization of every historical term must be
verified before this equation is used as executable optimization logic. In
particular, do not assume that a variable name such as `E` means measured
energy, or that `D` has one unambiguous meaning. For implementation and
benchmarking, use explicit metric names: payload bytes, peak memory, operation
count/compute time, measured energy (if available), encode/decode/transfer
latency, numerical reconstruction error, relation preservation, and downstream
task quality. Publish raw metrics before any weighted aggregate. The weighted
objective remains a research hypothesis until its terms and weights are
specified and validated.

The optimizer must enforce hard acceptance gates before comparing resource
costs. At minimum, define workload-specific floors for downstream task quality,
relationship/order preservation, and robustness, plus ceilings for payload
bytes, peak memory, compute, and latency. Exact model/codec/codebook
compatibility and host authorization are non-negotiable constraints, not
weighted objectives.

For every candidate, report explicit measured quantities:

- serialized payload bytes, including envelope and metadata;
- peak and temporary memory;
- operation counts and/or measured compute time;
- measured energy, if the hardware exposes a reliable measurement;
- encode, transfer, decode, and end-to-end latency;
- numerical reconstruction error;
- relationship/order/boundary preservation;
- downstream task accuracy, success, or quality;
- sensitivity under a documented perturbation suite.

Do not combine quantities with incompatible units until a normalization and
weight-selection policy is documented. Always publish raw measurements
alongside any aggregate score.

## 5. Relationships and topology

Relationship preservation is a distinct evaluation target. A representation
can have low vector RMSE while losing ordering, dependencies, references, or
important local changes.

The first MSIR prototype should represent relationships explicitly as a
bounded, typed structure over ordered segments. Candidate relation types may
include:

- temporal adjacency/order;
- same-span membership;
- declared dependency or reference;
- continuity between adjacent segments;
- task-defined importance or protected boundary.

Only relations supported by source metadata or an independently validated
derivation may be encoded as facts. Learned or inferred relations must carry
their provenance/confidence and must not silently become hard constraints.

Evaluate relationship preservation separately from vector reconstruction.
Possible metrics include edge precision/recall, order preservation, boundary
retention, and task-specific dependency preservation. The metric must match the
relation type; one generic graph score is not sufficient for every task.

A graph representation may be a practical first implementation for explicit
typed relations. A continuous surface/manifold representation is a later
experiment, not a prerequisite. If a geometric object is introduced, document
its construction, metric, boundary treatment, and numerical method.

## 6. Geometric hypotheses and perturbation stability

Curvature or minimal-surface-inspired regularization is an optional research
hypothesis, not an assumed property of the current codec. Before implementing
a geometric penalty, define the geometric object, coordinate system, metric,
neighborhood construction, boundary treatment, numerical estimator, and the
reason the proposed penalty should improve task-relevant preservation.

Compare any geometric candidate against a non-geometric baseline. Retain it
only if held-out experiments show a reproducible improvement.

Use a reproducible perturbation suite: controlled numerical noise, missing
elements, reordering only where order is not protected, distribution shift,
and corrupted metadata. Measure changes in the encoded representation,
reconstruction, preserved relations, and downstream task result. Protected
invariants must fail closed when violated.

## 7. Relationship to GIE1, GCB1, and latent channel

MSIR experiments sit between model-specific sequence extraction and the
existing GIE sequence encoder. The initial compatible path is:

model-specific sequence extraction -> X -> existing GIE segmentation/pooling
Y -> optional versioned MSIR relationship sidecar -> existing GIE1 encoder ->
Z -> existing authorized latent transport -> GIE1 decoder -> pooled
reconstruction.

The relationship sidecar is experimental and is not part of the current GIE1
wire payload. It must not be sent until a separately versioned protocol
extension and peer capability negotiation exist.

GCB1 remains the immutable, digest-verified codebook artifact used by the
quantizer. GIE1 remains responsible for compact sequence encoding/decoding.
The latent channel remains responsible for capability negotiation, model
identity, route binding, expiry, integrity, replay prevention, and host
authorization.

MSIR must not bypass Director/APEX or East/e3 governance. It cannot authorize
a transfer, select an agent recipient, or change production routing. Unknown
model pairs continue to use the established text fallback. A shared codebook
does not establish cross-model semantic alignment.

## 8. Multi-model compatibility

Keep each model's internal latent space model-specific unless a separately
trained and validated adapter proves compatibility. Use explicit adapters:

- model-specific extractor: maps runtime output into a documented X schema;
- optional alignment adapter: maps between model-specific spaces using paired
  calibration data and a versioned artifact;
- MSIR structure: represents task-relevant relationships independently of
  assumptions that raw coordinates are interchangeable;
- codec adapter: encodes/decodes the structured representation.

An alignment adapter must be evaluated on held-out tasks and distributions.
Matching dimensions, tensor types, or codebook format is not evidence of
semantic alignment. Until an exact model pair and adapter pass validation,
negotiate no latent route and use text fallback.

## 9. Experimental baselines

Run identical tasks, models, and hardware through these baselines:

1. natural-language message exchange;
2. raw uncompressed latent sequence;
3. affine int8 latent codec;
4. GIE1 pooled/product-quantized sequence;
5. GIE1 plus MSIR relationship-aware representation;
6. optional geometric regularizer only after its surface construction is defined.

For each run, report:

- payload bytes, including envelope and metadata;
- numerical reconstruction error;
- relationship/order/boundary preservation;
- downstream task success, answer consistency, and semantic quality;
- median and p95 encode/decode/transfer/end-to-end latency;
- peak resident memory and temporary allocations;
- CPU/GPU/NPU time and measured energy where available;
- model weights, inference working memory, and KV cache as separate quantities.

Use held-out calibration and evaluation sets. Record model revisions, prompts or
task definitions, random seeds, codebook digests, codec versions, hardware,
runtime versions, and benchmark scripts. Report confidence intervals or
variation across repeated runs where meaningful.

A smaller communication payload does not prove smaller model weights, fewer
parameters, lower attention compute, reduced KV cache, or lower generation
memory. Those require independent experiments.

## 10. Incremental implementation plan

### MSIR-0: specification and fixtures

- Freeze the repository-compatible X/Y/Z notation and explicit measured metric names. Do not assign speculative meanings to M/I/R/S/C/E/H/P/T/L/A/D.
- Define a versioned structured-representation schema for ordered segments and
  typed relations.
- Create deterministic fixtures where vector values are similar but ordering
  or relationships differ, so tests catch relationship loss.
- Keep this stage independent of production routing.

### MSIR-1: relationship-aware baseline

- Add a pure TypeScript representation builder over GIE pooled segments.
- Preserve source span, ordering, and explicit relation metadata.
- Add bounded validation and canonical serialization.
- Measure metadata overhead and relation preservation against GIE1 alone.

### MSIR-2: constrained optimizer

- Implement candidate selection with hard task-quality, stability, relation,
  payload, and resource constraints.
- Start with deterministic non-geometric candidates: segment merging/splitting,
  protected boundaries, and importance-aware retention.
- Compare against the current GIE rate-distortion selector.

### MSIR-3: perturbation and stability evaluation

- Add reproducible perturbation fixtures.
- Measure reconstruction, relation, and task degradation.
- Ensure invalid protected boundaries or incompatible metadata trigger a
  rejection/fallback rather than silent acceptance.

### MSIR-4: geometric experiment

- Only after the graph/relationship baseline is measured, define a geometric
  embedding and boundary conditions.
- Compare curvature/minimal-surface-inspired regularization against the
  non-geometric baseline on held-out tasks.
- Retain it only if it improves the quality/resource frontier reproducibly.

### MSIR-5: runtime integration

- Add native Swift parity only after the structured schema and TypeScript
  behavior stabilize.
- Preserve exact-head CI and cross-runtime fixtures.
- Integrate with agent exchange behind an experimental feature gate.
- Keep Director/APEX authorization and East/e3 execution controls unchanged.

## 11. Initial acceptance gates

MSIR is not ready for runtime adoption until all of the following are true:

- deterministic X -> Y -> Z -> decoded-pooled-representation fixtures pass;
- source order and protected relationships survive encode/decode;
- payload and memory bounds are checked before allocation;
- model, schema, codec, and codebook identities are validated;
- perturbation tests establish the documented stability floor;
- downstream task quality meets a pre-registered floor against the text and
  uncompressed-latent baselines;
- MSIR demonstrates a reproducible improvement in the quality/resource
  frontier over GIE1 alone;
- fallback behavior is tested and production routing remains unchanged.

## 12. Non-goals and cautions

- This is not a claim that information can be compressed without loss.
- This is not a claim that a minimal surface is equivalent to semantic meaning.
- This is not a universal latent space shared by arbitrary models.
- This does not modify model weights, attention, or KV cache.
- This does not bypass authorization or make latent data trusted by default.
- This does not replace GIE1; it tests whether a relationship-aware layer can
  improve the representation presented to GIE1.

The success criterion is not the smallest possible payload. It is the best
measured task-quality/resource tradeoff while preserving the required
information, relationships, and safety invariants.
