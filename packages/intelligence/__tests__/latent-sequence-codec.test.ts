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
  it("decodes the shared GIE1 fixture used by the Swift implementation", () => {
    const fixtureHex =
      "474945310104000200020200030000000200" +
      "a".repeat(64) +
      "02000100" +
      "01000001" +
      "00010100";
    const bytes = Uint8Array.from(
      fixtureHex.match(/.{2}/g)!.map(byte => Number.parseInt(byte, 16))
    );
    const codec = new PooledProductQuantizer({
      codebookId,
      modelId: identity.modelId,
      modelRevision: identity.modelRevision,
      embeddingDimension: 4,
      subspaces: 2,
      codebookSize: 2,
      residualStages: 2,
      maxTokensPerSegment: 2,
      stages: [
        [new Float64Array([1, 2, 3, 4]), new Float64Array([10, 20, 30, 40])],
        [new Float64Array([0.5, 0.25, -0.5, -0.25]), new Float64Array([1, 2, -1, -2])]
      ]
    });
    const decoded = codec.decode(bytes, identity);
    expect(decoded.tokenCount).toBe(3);
    expect(decoded.embeddingDimension).toBe(4);
    expect(decoded.segmentTokenCounts).toEqual([2, 1]);
    expect(Array.from(decoded.segmentEmbeddings)).toEqual([3.5, 4.25, 10, 18, 0.5, 1.75, 31, 42]);
  });

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
    const original = incompatible.tokenEmbeddings;
    incompatible.embeddingDimension = 8;
    incompatible.tokenEmbeddings = new Float32Array(incompatible.tokenCount * 8);
    incompatible.tokenEmbeddings.set(original);
    expect(() => codec.encode(incompatible, identity)).toThrow(/dimension does not match the codebook/);
  });

  it("rejects decoded tensor dimensions above the allocation ceiling", () => {
    const dimension = 8_192;
    const segmentCount = 2_049;
    const oversizedCodebook = new PooledProductQuantizer({
      codebookId,
      modelId: identity.modelId,
      modelRevision: identity.modelRevision,
      embeddingDimension: dimension,
      subspaces: dimension,
      codebookSize: 2,
      residualStages: 1,
      maxTokensPerSegment: 1,
      stages: [Array.from({ length: dimension }, () => new Float64Array(2))]
    });
    const payload = new Uint8Array(50 + segmentCount * 2 + segmentCount * dimension);
    payload.set([0x47, 0x49, 0x45, 0x31], 0);
    const view = new DataView(payload.buffer);
    payload[4] = 1;
    view.setUint16(5, dimension, true);
    view.setUint16(7, dimension, true);
    payload[9] = 1;
    view.setUint16(10, 2, true);
    view.setUint32(12, segmentCount, true);
    view.setUint16(16, segmentCount, true);
    payload.fill(0xaa, 18, 50);
    for (let i = 0; i < segmentCount; i += 1) {
      view.setUint16(50 + i * 2, 1, true);
    }
    expect(() => oversizedCodebook.decode(payload, identity)).toThrow(/element bound/);
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
    expect(() => chooseRateDistortionCandidate(candidates, {
      maxSequenceRmse: Number.POSITIVE_INFINITY,
      maxPayloadBytes: 128
    })).toThrow(/limits must be finite/);
    expect(() => chooseRateDistortionCandidate(candidates, {
      maxSequenceRmse: 0.1,
      maxPayloadBytes: Number.MAX_SAFE_INTEGER + 1
    })).toThrow(/safely bounded/);
    expect(() => chooseRateDistortionCandidate(candidates, {
      maxSequenceRmse: -0.1,
      maxPayloadBytes: 128
    })).toThrow(/non-negative/);
  });
});

function codecCandidate(byteLength: number, sequenceRmse: number) {
  return { bytes: new Uint8Array(byteLength), sequenceRmse };
}
