# GIE Canonical Codebook Artifact v1

Status: implementation specification for the follow-up to PR #221. This document does not claim that the current GIE1 decoder authenticates codebook artifacts.

## Goals

A TypeScript encoder and Swift decoder must load the same immutable codebook values from exactly the same bytes. The SHA-256 identifier is the digest of the complete canonical artifact. The GIE1 sequence payload continues to carry that 32-byte digest in its existing header.

This artifact format is same-model only. It is not a cross-model latent alignment format.

## Canonical byte layout

All integers and Float32 values are little-endian. The artifact has no optional fields, padding, trailing bytes, or embedded digest.

| Offset | Width | Field | Required value / interpretation |
|---:|---:|---|---|
| 0 | 4 | magic | ASCII GCB1 |
| 4 | 1 | version | 1 |
| 5 | 1 | flags | 0 |
| 6 | 2 | embeddingDimension | unsigned integer, 1…8192 |
| 8 | 2 | subspaces | unsigned integer; divides embeddingDimension |
| 10 | 2 | codebookSize | unsigned integer, 2…256 |
| 12 | 1 | residualStages | unsigned integer, 1…3 |
| 13 | 1 | reserved | 0 |
| 14 | 2 | maxTokensPerSegment | unsigned integer, 1…65535 |
| 16 | 2 | modelIdByteLength | unsigned integer, 1…1024 |
| 18 | 2 | modelRevisionByteLength | unsigned integer, 1…1024 |
| 20 | variable | modelId | UTF-8, NFC-normalized |
| next | variable | modelRevision | UTF-8, NFC-normalized |
| next | variable | codebook values | IEEE-754 binary32 little-endian |

The codebook values are serialized in this exact nested order:

1. residual stage, ascending from zero;
2. subspace, ascending from zero;
3. codeword, ascending from zero;
4. component within that subspace, ascending from zero.

The expected number of Float32 values is:

residualStages × subspaces × codebookSize × (embeddingDimension / subspaces).

The total artifact size must not exceed 25 MiB. The parser must reject truncation, trailing bytes, unknown versions, nonzero flags/reserved fields, invalid bounds, invalid UTF-8, strings that are not already NFC, and any non-finite Float32 value.

## Floating-point canonicalization

The canonical representation is Float32, not Float64. Training may use Float64 intermediates, but before a codebook stage is used for residual training or published, every centroid component must be rounded to Float32 (Math.fround in TypeScript). Later residual stages must be trained against those rounded values, not the pre-rounded Float64 centroids.

Serialization writes the exact Float32 bit pattern in little-endian order. Negative zero is normalized to positive zero before serialization. Values that overflow to infinity or become non-finite during Float32 conversion are rejected.

Both runtimes must use the canonical Float32 values for reconstruction. TypeScript may retain Float64 containers internally only if every stored value is exactly representable as Float32; the Swift representation is native Float.

## Identity and integrity

- codebookId is the lowercase hexadecimal SHA-256 digest of every artifact byte, from magic through the final Float32 component.
- The digest is not stored inside the artifact, avoiding a self-referential hash.
- A loader computes SHA-256 over the original bytes and compares it with the expected digest before exposing the codebook.
- A GIE1 payload's embedded digest is only an identity reference. It is not a substitute for artifact-byte verification.
- The artifact's model ID and immutable model revision are bound to the codebook and must match the inference runtime identity exactly.
- Cross-model use remains rejected unless a separately versioned and evaluated alignment layer is introduced.

## Reference fixture

This minimal fixture has dimension 2, one subspace, two codewords, one residual stage, four tokens per segment, model ID fixture-model, revision rev-1, and values [1.25, -2.5, 3.75, 4.5].

- Artifact length: 54 bytes
- Canonical artifact hex:

    474342310100020001000200010004000d000500666978747572652d6d6f64656c7265762d310000a03f000020c00000704000009040

- SHA-256: a8b04c0cc3b84740c40f2fa37ccc93a98d2454ed319c500d4cc3c9767dde28f6

The TypeScript and Swift tests must consume this same fixture artifact and verify the same digest and decoded table values. Negative tests must cover altered digest, bad magic/version, noncanonical strings, non-finite Float32, malformed dimensions, truncation, and trailing bytes.
