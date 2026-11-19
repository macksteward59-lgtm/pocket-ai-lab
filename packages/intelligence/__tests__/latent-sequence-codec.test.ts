import { describe, expect, it } from "vitest";
import {
  chooseRateDistortionCandidate,
  PooledProductQuantizer,
  type LatentSequence
} from "../latent-communication/PooledProductQuantizer";

const identity = { modelId: "shared-model", modelRevision: "sha256:model-rev-1" };
const codebookId = "a".repeat(64);

function sequence(seed: number, tokenCount = 8): LatentSequence {
  const embeddingDimension = 4;
  const tokenEmbeddings = new Float32Array(tokenCount * embeddingDimension);
  for (let token = 0; token < tokenCount; token += 1) {
    for (let dimension = 0; dimension < embeddingDimension; dimension += 1) {
      tokenEmbeddings[token * embeddingDimension + dimension] =
        Math.sin((seed * 17 + token * 3 + dimension) / 7) +
        Math.cos((seed + token * 2 - dimension) / 5) * 0.25;
    }
  }
  return { tokenEmbeddings, tokenCount, embeddingDimension };
}

function train() {
  return PooledProductQuantizer.train(
    [sequence(0), sequence(1), sequence(2), sequence(3), sequence(4)],
    identity,
    {
      subspaces: 2,
      codebookSize: 4,
      residualStages: 2,
      maxTokensPerSegment: 2,
      iterations: 12
    },
    codebookId
  );
}

describe("GIE pooled product quantizer", () => {
  it("trains shared residual codebooks and round-trips ordered pooled segments", () => {
    const codec = train();
    const input = sequence(7, 7);
    const encoded = codec.encode(input, identity);
    const decoded = codec.decode(encoded.bytes, identity);

    expect(decoded.tokenCount).toBe(7);
    expect(decoded.embeddingDimension).toBe(4);
    expect(decoded.segmentTokenCounts).toEqual([2, 2, 2, 1]);
    expect(decoded.segmentEmbeddings).toHaveLength(16);
    expect(Array.from(decoded.segmentEmbeddings).every(Number.isFinite)).toBe(true);
    expect(encoded.bytes.byteLength).toBe(50 + 4 * 2 + 4 * 2 * 2);
    expect(encoded.poolingRmse).toBeGreaterThanOrEqual(0);
    expect(encoded.quantizationRmse).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(encoded.sequenceRmse)).toBe(true);
    expect(encoded.bytes.byteLength).toBeLessThan(encoded.rawFloat32Bytes);
  });

  it("binds a codebook to its immutable model revision", () => {
    const codec = train();
    expect(() => codec.encode(sequence(8), {
      ...identity,
      modelRevision: "sha256:other-revision"
    })).toThrow(/different model identity/);
  });

  it("rejects altered codebook identity and malformed segment metadata", () => {
    const codec = train();
    const encoded = codec.encode(sequence(9), identity);
    const tamperedDigest = encoded.bytes.slice();
    tamperedDigest[18] ^= 1;
    expect(() => codec.decode(tamperedDigest, identity)).toThrow(/negotiated codebook/);

    const malformedSpan = encoded.bytes.slice();
    new DataView(malformedSpan.buffer).setUint16(50, 0, true);
    expect(() => codec.decode(malformedSpan, identity)).toThrow(/segment span/);
  });

  it("rejects an input embedding dimension that differs from the codebook", () => {
    const codec = train();
    const incompatible = sequence(11);
    incompatible.embeddingDimension = 8;
    expect(() => codec.encode(incompatible, identity)).toThrow(/dimension does not match the codebook/);
  });

  it("rejects non-finite activations and incompatible training dimensions", () => {
    const codec = train();
    const invalid = sequence(10);
    invalid.tokenEmbeddings[0] = Number.NaN;
    expect(() => codec.encode(invalid, identity)).toThrow(/shape or values/);
    expect(() => PooledProductQuantizer.train(
      [sequence(0), { ...sequence(1), embeddingDimension: 8 }],
      identity,
      { subspaces: 2, codebookSize: 4, residualStages: 1, maxTokensPerSegment: 2 },
      codebookId
    )).toThrow(/one embedding dimension/);
  });

  it("selects the smallest candidate within the rate-distortion budget", () => {
    const candidates = [
      { ...codecCandidate(100, 0.03), tokenCount: 1, segmentCount: 1, embeddingDimension: 1, segmentTokenCounts: [1], poolingRmse: 0, quantizationRmse: 0, rawFloat32Bytes: 4 },
      { ...codecCandidate(60, 0.08), tokenCount: 1, segmentCount: 1, embeddingDimension: 1, segmentTokenCounts: [1], poolingRmse: 0, quantizationRmse: 0, rawFloat32Bytes: 4 },
      { ...codecCandidate(40, 0.2), tokenCount: 1, segmentCount: 1, embeddingDimension: 1, segmentTokenCounts: [1], poolingRmse: 0, quantizationRmse: 0, rawFloat32Bytes: 4 }
    ];
    expect(chooseRateDistortionCandidate(candidates, {
      maxSequenceRmse: 0.1,
      maxPayloadBytes: 128
    })?.bytes.byteLength).toBe(60);
    expect(chooseRateDistortionCandidate(candidates, {
      maxSequenceRmse: 0.01,
      maxPayloadBytes: 128
    })).toBeNull();
  });
});

function codecCandidate(byteLength: number, sequenceRmse: number) {
  return { bytes: new Uint8Array(byteLength), sequenceRmse };
}
