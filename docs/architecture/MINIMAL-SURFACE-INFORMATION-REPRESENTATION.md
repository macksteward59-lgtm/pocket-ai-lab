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

## 2. Recovered variable glossary

The following glossary restores the variables from the earlier theory and
separates names that were overloaded in the source notes.

| Symbol | Meaning | Implementation interpretation |
| --- | --- | --- |
| M | Memory structure | Organization of stored representations, indexes, and relationships |
| I | Information | Source content or latent information to preserve |
| R | Relationships | Edges, ordering, dependencies, and contextual relations among elements |
| S | Storage | Bytes and memory occupied by the representation |
| C | Complexity | Structural/algorithmic complexity of representation and operations |
| E | Energy or cost | Measured compute/energy cost of encode, transmit, decode, and use |
| H | Mean curvature | Optional geometric diagnostic/regularizer, only after a surface is defined |
| P | Perturbation | Controlled input noise, distribution shift, deletion, or corruption |
| T | Stability | Bounded change in representation/output under specified perturbations |
| L | Latency | Encode, transfer, decode, and end-to-end task latency |
| A | Accuracy | Downstream task correctness or quality |
| D_dist | Information distortion | Loss between source and reconstructed/task-relevant information |

A second notation describes the representation path:

- X: original/source information;
- Y: intermediate structure derived from X;
- Z: encoded compact representation;
- D_dec: decoded/reconstructed information;
- B: boundary conditions and invariants imposed on the representation.

The historical notes used D for both decoded information and distortion.
This specification disambiguates them as D_dec and D_dist. Y was previously
left undefined; here Y is defined as the structured intermediate representation
that captures segments, topology, ordering, boundaries, and task-relevant
relationships before compact coding.

## 3. Representation pipeline

1. **Capture X:** obtain a bounded latent sequence or other model output, with
   model ID, immutable revision, layer, token positions, dtype, shape, and task
   scope. Hidden-state access remains runtime-specific.
2. **Construct Y:** create an explicit structure over the source elements.
   The first implementation should preserve token/segment order and may attach
   typed relationships such as adjacency, dependency, reference, or temporal
   continuity. Do not infer relationships that the source runtime did not
   provide or a validated algorithm did not derive.
3. **Optimize Y:** select a representation under storage, complexity, compute,
   latency, stability, and task-quality constraints.
4. **Encode Z:** pass the optimized representation to a versioned codec such as
   GIE1. The codec remains responsible for its own wire format, codebook
   identity, integrity checks, and bounded decoding.
5. **Decode D_dec:** reconstruct the structured representation from Z using
   the exact compatible artifact and codec version.
6. **Validate:** compare reconstructed content and relationships with the
   source and measure downstream task behavior. Reject, increase fidelity, or
   fall back to an established channel when acceptance constraints are not met.

Current GIE1 decoding reconstructs ordered pooled segment vectors; it does not
reconstruct every original token vector. MSIR must preserve that distinction
and must not label pooled-segment reconstruction as lossless token recovery.

## 4. Objective and constraints

The recovered conceptual objective is:

J = alpha*S + beta*C + gamma*E + delta*L + epsilon*D_dist

where the coefficients are non-negative policy weights selected for a workload.
All terms must be measured or explicitly normalized before they are combined.
The objective is a design target, not an established physical law.

The optimization is constrained by:

- A >= A_min: downstream task quality must remain above its accepted floor;
- T >= T_min: stability under the defined perturbation set must meet its floor;
- R_preserved >= R_min: required relationships must remain recoverable;
- resource ceilings for payload bytes, peak memory, compute, and latency;
- exact model/codec/codebook compatibility and protocol authorization.

A weighted objective alone is not sufficient: it could trade away critical
semantic quality for a smaller payload. Hard quality and safety constraints
must be applied before selecting the lowest-cost candidate.

For a given candidate representation Z, measure at least:

- S(Z): serialized bytes plus separately reported peak/temporary memory;
- C(Z): operation counts and/or measured algorithmic cost;
- E(Z): measured energy where available, otherwise report compute time as a
  separate proxy rather than calling it energy;
- L(Z): encode, transfer, decode, and end-to-end latency;
- D_dist(X, D_dec): numerical and task-relevant distortion;
- A(Z): downstream task accuracy/success;
- T(Z, P): sensitivity under a documented perturbation suite.

Do not combine quantities with incompatible units until a normalization and
weight-selection policy is documented. Always publish the raw measurements
alongside any aggregate score.

## 5. Relationships and topology

The relationship term R is central to the original idea. A representation can
have low vector RMSE while losing ordering, dependencies, references, or
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

A graph or simplicial-complex representation may be a practical first
implementation. A continuous surface/manifold representation is a later
experiment, not a prerequisite. If a surface is introduced, document its
construction, metric, boundary conditions B, and numerical method.

## 6. Curvature, minimality, and stability

H denotes mean curvature in the recovered theory. It should not be added as a
decorative penalty. Before using H, the implementation must define:

1. what points or features form the surface;
2. how neighborhoods and adjacency are selected;
3. the metric and coordinate system;
4. boundary conditions B;
5. how curvature is estimated and normalized;
6. why lower curvature should preserve or improve task-relevant information.

A minimal-surface-inspired regularizer can then be compared against non-geometric
baselines. It must not be presumed to improve semantic quality.

Perturbation P should be a reproducible suite, including controlled numerical
noise, missing elements, reordered elements where order is not protected,
distribution-shift samples, and corrupted metadata. Stability T should measure
how much the representation, decoded structure, and downstream result change
under each permitted perturbation. Protected invariants must fail closed when
violated.

## 7. Relationship to GIE1, GCB1, and latent channel

MSIR belongs before GIE1:

Model-specific latent extraction -> X -> MSIR structure Y and optimization ->
GIE1 encoder -> Z -> authorized latent transport -> GIE1 decoder -> D_dec.

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

- Freeze the glossary and X/Y/Z/D_dec/B notation.
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

- deterministic X -> Y -> Z -> D_dec fixtures pass;
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
