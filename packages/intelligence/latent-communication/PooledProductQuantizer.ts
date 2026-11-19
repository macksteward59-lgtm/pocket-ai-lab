/**
 * Geometric Information Encoding (GIE) sequence codec proof of concept.
 *
 * X: token-level source vectors.
 * Y: ordered temporal segments and their pooled representatives.
 * Z: product-quantized codebook indices plus optional residual stages.
 *
 * Codebooks are trained offline on calibration activations and identified by
 * an immutable SHA-256 digest. This implementation is same-model only.
 */
export interface LatentSequence {
  tokenEmbeddings: Float32Array;
  tokenCount: number;
  embeddingDimension: number;
}

export interface ProductQuantizerOptions {
  subspaces: number;
  codebookSize: number;
  residualStages: number;
  maxTokensPerSegment: number;
  iterations?: number;
}

export interface ProductQuantizerCodebook {
  codebookId: string;
  modelId: string;
  modelRevision: string;
  embeddingDimension: number;
  subspaces: number;
  codebookSize: number;
  residualStages: number;
  maxTokensPerSegment: number;
  /** [residual stage][subspace], each flattened as [codeword][subspace dimension]. */
  stages: readonly (readonly Float64Array[])[];
}

export interface EncodedLatentSequence {
  bytes: Uint8Array;
  tokenCount: number;
  segmentCount: number;
  embeddingDimension: number;
  segmentTokenCounts: readonly number[];
  poolingRmse: number;
  quantizationRmse: number;
  sequenceRmse: number;
  rawFloat32Bytes: number;
}

export interface DecodedLatentSequence {
  tokenCount: number;
  embeddingDimension: number;
  segmentTokenCounts: readonly number[];
  /** Ordered pooled segment vectors; this is not a token-by-token reconstruction. */
  segmentEmbeddings: Float32Array;
}

const MAGIC = [0x47, 0x49, 0x45, 0x31] as const; // "GIE1"
const HEADER_BYTES = 50;
const MAX_TOKENS = 65_535;
const MAX_DIMENSION = 8_192;
const MAX_SEGMENTS = 4_096;
const MAX_ELEMENTS = 16 * 1024 * 1024;

export class PooledProductQuantizer {
  readonly codecId = "pocket-gie-product-quantizer";
  readonly codecVersion = "1";

  constructor(readonly codebook: ProductQuantizerCodebook) {
    validateCodebook(codebook);
  }

  /**
   * Train deterministic codebooks. The caller must hash the canonical
   * serialized codebook artifact with SHA-256 and pass that digest as
   * codebookId; artifact loading must independently verify the same digest.
   */
  static train(
    calibrationSequences: readonly LatentSequence[],
    identity: { modelId: string; modelRevision: string },
    options: ProductQuantizerOptions,
    codebookId: string
  ): PooledProductQuantizer {
    if (!/^[a-f0-9]{64}$/i.test(codebookId)) {
      throw new Error("Codebook ID must be a SHA-256 digest");
    }
    if (!identity.modelId.trim() || !identity.modelRevision.trim()) {
      throw new Error("A model ID and immutable model revision are required");
    }
    if (calibrationSequences.length === 0) {
      throw new Error("At least one calibration sequence is required");
    }

    const dimension = calibrationSequences[0].embeddingDimension;
    validateOptions(options, dimension);
    const pooled: Float64Array[] = [];
    for (const sequence of calibrationSequences) {
      if (sequence.embeddingDimension !== dimension) {
        throw new Error("Calibration sequences must have one embedding dimension");
      }
      pooled.push(...poolSequence(sequence, options.maxTokensPerSegment).vectors);
    }
    if (pooled.length < options.codebookSize) {
      throw new Error("Calibration must contain at least codebookSize pooled segments");
    }

    const subspaceDimension = dimension / options.subspaces;
    const stages: Float64Array[][] = [];
    let residuals = pooled.map(vector => vector.slice());

    for (let stage = 0; stage < options.residualStages; stage += 1) {
      const stageCodebooks: Float64Array[] = [];
      for (let subspace = 0; subspace < options.subspaces; subspace += 1) {
        const offset = subspace * subspaceDimension;
        const samples = residuals.map(vector => vector.slice(offset, offset + subspaceDimension));
        stageCodebooks.push(trainKMeans(
          samples,
          options.codebookSize,
          options.iterations ?? 20
        ));
      }
      stages.push(stageCodebooks);

      residuals = residuals.map(vector => {
        const next = vector.slice();
        for (let subspace = 0; subspace < options.subspaces; subspace += 1) {
          const offset = subspace * subspaceDimension;
          const codebook = stageCodebooks[subspace];
          const index = nearestCodeword(next, offset, subspaceDimension, codebook, options.codebookSize);
          const centroidOffset = index * subspaceDimension;
          for (let j = 0; j < subspaceDimension; j += 1) {
            next[offset + j] -= codebook[centroidOffset + j];
          }
        }
        return next;
      });
    }

    return new PooledProductQuantizer({
      codebookId: codebookId.toLowerCase(),
      modelId: identity.modelId,
      modelRevision: identity.modelRevision,
      embeddingDimension: dimension,
      subspaces: options.subspaces,
      codebookSize: options.codebookSize,
      residualStages: options.residualStages,
      maxTokensPerSegment: options.maxTokensPerSegment,
      stages
    });
  }

  encode(input: LatentSequence, identity: { modelId: string; modelRevision: string }): EncodedLatentSequence {
    this.assertIdentity(identity);
    const pooled = poolSequence(input, this.codebook.maxTokensPerSegment);
    const { embeddingDimension: dimension, subspaces, codebookSize, residualStages } = this.codebook;
    const segmentCount = pooled.vectors.length;
    if (segmentCount > MAX_SEGMENTS) throw new Error("Sequence has too many pooled segments");

    const subspaceDimension = dimension / subspaces;
    const indexBytes = new Uint8Array(segmentCount * residualStages * subspaces);
    const reconstructed = new Float64Array(segmentCount * dimension);

    for (let segment = 0; segment < segmentCount; segment += 1) {
      const residual = pooled.vectors[segment].slice();
      const outputOffset = segment * dimension;
      for (let stage = 0; stage < residualStages; stage += 1) {
        for (let subspace = 0; subspace < subspaces; subspace += 1) {
          const offset = subspace * subspaceDimension;
          const codebook = this.codebook.stages[stage][subspace];
          const index = nearestCodeword(residual, offset, subspaceDimension, codebook, codebookSize);
          indexBytes[(segment * residualStages + stage) * subspaces + subspace] = index;
          const centroidOffset = index * subspaceDimension;
          for (let j = 0; j < subspaceDimension; j += 1) {
            const value = codebook[centroidOffset + j];
            reconstructed[outputOffset + offset + j] += value;
            residual[offset + j] -= value;
          }
        }
      }
    }

    let quantizationSquaredError = 0;
    for (let i = 0; i < reconstructed.length; i += 1) {
      const delta = pooled.flat[i] - reconstructed[i];
      quantizationSquaredError += delta * delta;
    }
    const quantizationRmse = Math.sqrt(quantizationSquaredError / reconstructed.length);
    const sequenceSquaredError = sequenceErrorAgainstSegments(
      input,
      reconstructed,
      pooled.segmentTokenCounts,
      dimension
    );
    const sequenceRmse = Math.sqrt(sequenceSquaredError / (input.tokenCount * dimension));

    const codebookDigest = hexToBytes(this.codebook.codebookId);
    const segmentMetadataBytes = segmentCount * 2;
    const payload = new Uint8Array(HEADER_BYTES + segmentMetadataBytes + indexBytes.length);
    payload.set(MAGIC, 0);
    const view = new DataView(payload.buffer);
    payload[4] = 1;
    view.setUint16(5, dimension, true);
    view.setUint16(7, subspaces, true);
    payload[9] = residualStages;
    view.setUint16(10, codebookSize, true);
    view.setUint32(12, input.tokenCount, true);
    view.setUint16(16, segmentCount, true);
    payload.set(codebookDigest, 18);

    let cursor = HEADER_BYTES;
    for (const count of pooled.segmentTokenCounts) {
      view.setUint16(cursor, count, true);
      cursor += 2;
    }
    payload.set(indexBytes, cursor);

    return {
      bytes: payload,
      tokenCount: input.tokenCount,
      segmentCount,
      embeddingDimension: dimension,
      segmentTokenCounts: pooled.segmentTokenCounts,
      poolingRmse: pooled.poolingRmse,
      quantizationRmse,
      sequenceRmse,
      rawFloat32Bytes: input.tokenEmbeddings.byteLength
    };
  }

  decode(
    bytes: Uint8Array,
    identity: { modelId: string; modelRevision: string }
  ): DecodedLatentSequence {
    this.assertIdentity(identity);
    if (!(bytes instanceof Uint8Array) || bytes.byteLength < HEADER_BYTES) {
      throw new Error("GIE payload is truncated");
    }
    if (MAGIC.some((value, index) => bytes[index] !== value)) {
      throw new Error("GIE payload magic is invalid");
    }
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const version = bytes[4];
    const dimension = view.getUint16(5, true);
    const subspaces = view.getUint16(7, true);
    const stages = bytes[9];
    const codebookSize = view.getUint16(10, true);
    const tokenCount = view.getUint32(12, true);
    const segmentCount = view.getUint16(16, true);
    const digest = bytesToHex(bytes.subarray(18, 50));

    if (version !== 1 || digest !== this.codebook.codebookId ||
        dimension !== this.codebook.embeddingDimension ||
        subspaces !== this.codebook.subspaces ||
        stages !== this.codebook.residualStages ||
        codebookSize !== this.codebook.codebookSize ||
        tokenCount < 1 || tokenCount > MAX_TOKENS ||
        segmentCount < 1 || segmentCount > MAX_SEGMENTS) {
      throw new Error("GIE payload does not match the negotiated codebook");
    }

    const expectedLength = HEADER_BYTES + segmentCount * 2 + segmentCount * stages * subspaces;
    if (bytes.byteLength !== expectedLength) throw new Error("GIE payload length is invalid");

    const segmentTokenCounts: number[] = [];
    let cursor = HEADER_BYTES;
    let totalTokens = 0;
    for (let i = 0; i < segmentCount; i += 1) {
      const count = view.getUint16(cursor, true);
      cursor += 2;
      if (count < 1 || count > this.codebook.maxTokensPerSegment) {
        throw new Error("GIE segment span is invalid");
      }
      segmentTokenCounts.push(count);
      totalTokens += count;
    }
    if (totalTokens !== tokenCount) throw new Error("GIE segment spans do not cover the sequence");

    const dimensionPerSubspace = dimension / subspaces;
    const segmentEmbeddings = new Float32Array(segmentCount * dimension);
    for (let segment = 0; segment < segmentCount; segment += 1) {
      const outputOffset = segment * dimension;
      for (let stage = 0; stage < stages; stage += 1) {
        for (let subspace = 0; subspace < subspaces; subspace += 1) {
          const index = bytes[cursor++];
          if (index >= codebookSize) throw new Error("GIE codeword index is out of range");
          const codebook = this.codebook.stages[stage][subspace];
          const centroidOffset = index * dimensionPerSubspace;
          const output = segmentEmbeddings;
          for (let j = 0; j < dimensionPerSubspace; j += 1) {
            const target = outputOffset + subspace * dimensionPerSubspace + j;
            output[target] += codebook[centroidOffset + j];
          }
        }
      }
    }
    if (!Array.from(segmentEmbeddings).every(Number.isFinite)) {
      throw new Error("GIE reconstruction contains non-finite values");
    }
    return { tokenCount, embeddingDimension: dimension, segmentTokenCounts, segmentEmbeddings };
  }

  private assertIdentity(identity: { modelId: string; modelRevision: string }): void {
    if (identity.modelId !== this.codebook.modelId ||
        identity.modelRevision !== this.codebook.modelRevision) {
      throw new Error("GIE codebook is bound to a different model identity or revision");
    }
  }
}

/** Select the smallest payload satisfying a measured sequence-level distortion budget. */
export function chooseRateDistortionCandidate(
  candidates: readonly EncodedLatentSequence[],
  limits: { maxSequenceRmse: number; maxPayloadBytes: number }
): EncodedLatentSequence | null {
  return candidates
    .filter(candidate =>
      Number.isFinite(candidate.sequenceRmse) &&
      candidate.sequenceRmse <= limits.maxSequenceRmse &&
      candidate.bytes.byteLength <= limits.maxPayloadBytes
    )
    .slice()
    .sort((left, right) =>
      left.bytes.byteLength - right.bytes.byteLength ||
      left.sequenceRmse - right.sequenceRmse
    )[0] ?? null;
}

function validateOptions(options: ProductQuantizerOptions, dimension: number): void {
  if (!Number.isSafeInteger(dimension) || dimension < 1 || dimension > MAX_DIMENSION ||
      !Number.isSafeInteger(options.subspaces) || options.subspaces < 1 ||
      dimension % options.subspaces !== 0 ||
      !Number.isSafeInteger(options.codebookSize) || options.codebookSize < 2 || options.codebookSize > 256 ||
      !Number.isSafeInteger(options.residualStages) || options.residualStages < 1 || options.residualStages > 3 ||
      !Number.isSafeInteger(options.maxTokensPerSegment) || options.maxTokensPerSegment < 1 || options.maxTokensPerSegment > 65_535 ||
      !Number.isSafeInteger(options.iterations ?? 20) || (options.iterations ?? 20) < 1 || (options.iterations ?? 20) > 100) {
    throw new Error("Product quantizer options are outside supported bounds");
  }
}

function validateCodebook(codebook: ProductQuantizerCodebook): void {
  if (!/^[a-f0-9]{64}$/.test(codebook.codebookId) ||
      !codebook.modelId.trim() || !codebook.modelRevision.trim()) {
    throw new Error("GIE codebook identity is invalid");
  }
  validateOptions(codebook, codebook.embeddingDimension);
  if (codebook.stages.length !== codebook.residualStages ||
      codebook.stages.some(stage => stage.length !== codebook.subspaces)) {
    throw new Error("GIE codebook stage layout is invalid");
  }
  const subspaceDimension = codebook.embeddingDimension / codebook.subspaces;
  for (const stage of codebook.stages) {
    for (const table of stage) {
      if (table.length !== codebook.codebookSize * subspaceDimension ||
          !Array.from(table).every(Number.isFinite)) {
        throw new Error("GIE codebook table is malformed");
      }
    }
  }
}

function poolSequence(
  sequence: LatentSequence,
  maxTokensPerSegment: number
): { vectors: Float64Array[]; flat: Float64Array; segmentTokenCounts: number[]; poolingRmse: number } {
  const { tokenEmbeddings, tokenCount, embeddingDimension: dimension } = sequence;
  if (!(tokenEmbeddings instanceof Float32Array) ||
      !Number.isSafeInteger(tokenCount) || tokenCount < 1 || tokenCount > MAX_TOKENS ||
      !Number.isSafeInteger(dimension) || dimension < 1 || dimension > MAX_DIMENSION ||
      tokenCount * dimension > MAX_ELEMENTS ||
      tokenEmbeddings.length !== tokenCount * dimension ||
      !Array.from(tokenEmbeddings).every(Number.isFinite)) {
    throw new Error("Latent sequence shape or values are invalid");
  }
  if (Math.ceil(tokenCount / maxTokensPerSegment) > MAX_SEGMENTS) {
    throw new Error("Latent sequence has too many temporal segments");
  }
  const vectors: Float64Array[] = [];
  const spans: number[] = [];
  let squaredError = 0;
  for (let start = 0; start < tokenCount; start += maxTokensPerSegment) {
    const end = Math.min(tokenCount, start + maxTokensPerSegment);
    const span = end - start;
    const mean = new Float64Array(dimension);
    for (let token = start; token < end; token += 1) {
      for (let d = 0; d < dimension; d += 1) {
        mean[d] += tokenEmbeddings[token * dimension + d];
      }
    }
    for (let d = 0; d < dimension; d += 1) mean[d] /= span;
    for (let token = start; token < end; token += 1) {
      for (let d = 0; d < dimension; d += 1) {
        const delta = tokenEmbeddings[token * dimension + d] - mean[d];
        squaredError += delta * delta;
      }
    }
    vectors.push(mean);
    spans.push(span);
  }
  const flat = new Float64Array(vectors.length * dimension);
  vectors.forEach((vector, index) => flat.set(vector, index * dimension));
  return {
    vectors,
    flat,
    segmentTokenCounts: spans,
    poolingRmse: Math.sqrt(squaredError / (tokenCount * dimension))
  };
}

function sequenceErrorAgainstSegments(
  input: LatentSequence,
  reconstructed: Float64Array,
  spans: readonly number[],
  dimension: number
): number {
  let squaredError = 0;
  let token = 0;
  for (let segment = 0; segment < spans.length; segment += 1) {
    const span = spans[segment];
    for (let t = 0; t < span; t += 1, token += 1) {
      for (let d = 0; d < dimension; d += 1) {
        const delta = input.tokenEmbeddings[token * dimension + d] - reconstructed[segment * dimension + d];
        squaredError += delta * delta;
      }
    }
  }
  return squaredError;
}

function trainKMeans(samples: readonly Float64Array[], size: number, iterations: number): Float64Array {
  const dimension = samples[0].length;
  if (samples.length < size || samples.some(sample => sample.length !== dimension)) {
    throw new Error("K-means training data is insufficient or inconsistent");
  }
  const centroids: Float64Array[] = [samples[0].slice()];
  while (centroids.length < size) {
    let bestIndex = 0;
    let bestDistance = -1;
    for (let i = 0; i < samples.length; i += 1) {
      let nearest = Number.POSITIVE_INFINITY;
      for (const centroid of centroids) nearest = Math.min(nearest, squaredDistance(samples[i], centroid));
      if (nearest > bestDistance) {
        bestDistance = nearest;
        bestIndex = i;
      }
    }
    centroids.push(samples[bestIndex].slice());
  }

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const sums = Array.from({ length: size }, () => new Float64Array(dimension));
    const counts = new Uint32Array(size);
    for (const sample of samples) {
      const index = nearestVector(sample, centroids);
      counts[index] += 1;
      for (let d = 0; d < dimension; d += 1) sums[index][d] += sample[d];
    }
    for (let index = 0; index < size; index += 1) {
      if (counts[index] === 0) continue;
      for (let d = 0; d < dimension; d += 1) {
        centroids[index][d] = sums[index][d] / counts[index];
      }
    }
  }
  return Float64Array.from(centroids.flatMap(vector => Array.from(vector)));
}

function nearestVector(sample: Float64Array, centroids: readonly Float64Array[]): number {
  let best = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < centroids.length; index += 1) {
    const distance = squaredDistance(sample, centroids[index]);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = index;
    }
  }
  return best;
}

function nearestCodeword(
  vector: Float64Array,
  offset: number,
  dimension: number,
  codebook: Float64Array,
  codebookSize: number
): number {
  let best = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < codebookSize; index += 1) {
    const base = index * dimension;
    let distance = 0;
    for (let j = 0; j < dimension; j += 1) {
      const delta = vector[offset + j] - codebook[base + j];
      distance += delta * delta;
    }
    if (distance < bestDistance) {
      bestDistance = distance;
      best = index;
    }
  }
  return best;
}

function squaredDistance(left: Float64Array, right: Float64Array): number {
  let distance = 0;
  for (let i = 0; i < left.length; i += 1) {
    const delta = left[i] - right[i];
    distance += delta * delta;
  }
  return distance;
}

function hexToBytes(hex: string): Uint8Array {
  const output = new Uint8Array(hex.length / 2);
  for (let i = 0; i < output.length; i += 1) output[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return output;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
}
