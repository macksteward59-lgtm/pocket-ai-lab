# Neuralese Sequence Compression — Geometric Information Encoding

## Purpose

This document extends the same-model latent-channel POC toward compact sequence-level representations. The target is not merely to shrink a final embedding's bytes. It is to preserve the information and relationships an agent needs while reducing repeated natural-language serialization and unnecessary intermediate data movement.

## Existing baseline

The current native path exports the final generated token's last-layer output embedding. The first codec is affine int8 scalar quantization, restricted to an exact model ID and immutable revision. For a 1,024-value float32 fixture, the TypeScript codec emits 1,032 bytes versus 4,096 raw bytes (about 3.97x smaller before envelope overhead). This is a codec fixture result only; it is not an end-to-end agent, latency, energy, model-memory, or KV-cache result.

## Geometric Information Encoding (GIE)

Use three conceptual layers:

- **X — Source:** a bounded sequence of token-level latent vectors, with model identity, layer/position metadata, and task scope.
- **Y — Structure:** temporal segments, pooled summaries, ordering, boundaries, and residual relationships needed to reconstruct task-relevant information.
- **Z — Compact code:** shared codebook indices, residual code indices, segment metadata, and only the minimum correction data required by the rate-distortion target.

The representation must preserve sequence order. A single global mean vector is a useful low-cost baseline but can erase order and local relationships; it must not be the only candidate.

## Candidate sequence codec

1. Capture a bounded sequence of final-layer token embeddings from the native inference runtime. The current final-token-only API is the first stepping stone; sequence capture is a separate native capability and must have a strict token and byte ceiling.
2. Divide the sequence into ordered temporal windows. Pool each window to a representative vector, retaining its token span and order. Compare mean pooling with weighted pooling; do not introduce attention weights unless they are actually available from the runtime.
3. Train product-quantization codebooks on calibration representations. Split each pooled vector into subspaces and encode each subspace with a nearest codeword index.
4. Apply residual vector quantization as an optional second stage: quantize the first reconstruction's residual and transmit the additional code indices only when the measured distortion warrants the extra bits.
5. Adapt the representation to a rate-distortion budget: vary the number of segments, subspaces, and residual stages while enforcing a task-quality floor. Keep an escape path to the current affine-int8 codec or text when the budget cannot preserve quality.
6. Reconstruct using the exact versioned codebook artifact and restore segment order. The codebook ID, version, digest, tensor shape, sequence spans, model identity, and codec version are part of the compatibility contract.

## Model compatibility

Initially train and evaluate codebooks for one exact model revision. A shared codebook is not automatically model-independent: heterogeneous model spaces require a separately trained and validated alignment/projection stage using paired or otherwise aligned calibration data. Similar dimensions, matching dtypes, or matching codec names are not proof of semantic compatibility. Unknown model pairs must use text fallback.

## Training and artifact requirements

- Calibration data must cover the actual activation distribution, sequence lengths, and task types expected in the runtime.
- Codebook training must be deterministic and reproducible from a recorded dataset/version, seed, algorithm, and hyperparameters.
- Export immutable codebook artifacts with a cryptographic digest; bind the digest into codec negotiation and cache keys.
- Keep codebook artifacts separate from per-transfer payloads. Do not retransmit a large codebook with each message.
- Evaluate distribution shift and out-of-range activations; reject or use a higher-fidelity fallback rather than silently clipping.

## Acceptance measurements

Compare text, raw float32, affine int8, pooled-only, product quantization, and residual product quantization on identical tasks and hardware:

- payload bytes including envelope and segment metadata;
- reconstruction RMSE and task-level semantic distortion;
- downstream agent task success and answer consistency;
- encode/decode and total transfer latency (median and p95);
- peak resident memory and temporary allocations;
- CPU/GPU/NPU time and energy where measurable;
- model-load and inference memory separately from communication buffers.

Do not infer model-weight reduction, lower parameter count, lower KV-cache use, or lower generation compute from a smaller inter-agent payload. Those are separate optimization targets requiring separate measurements.

## Implementation sequence

1. Finish the pinned-GGUF native final-token smoke test and keep the one-output-row capture bound.
2. Add bounded sequence-embedding capture in the native bridge, with explicit cancellation and memory ceilings.
3. Implement pooled-sequence and product-quantization experiments in TypeScript against recorded activation fixtures.
4. Add cross-runtime byte fixtures and Swift decoding only after the TypeScript format stabilizes.
5. Benchmark rate-distortion and task quality; retain affine int8/text fallback.
6. Only then investigate paired-data cross-model alignment and possible KV-cache or activation-memory savings as separate projects.
