import type { ProductQuantizerCodebook } from "./PooledProductQuantizer";

const MAGIC = [0x47, 0x43, 0x42, 0x31] as const;
const HEADER_BYTES = 20;
const MAX_ARTIFACT_BYTES = 25 * 1024 * 1024;

export interface GIECodebookArtifact {
  bytes: Uint8Array;
  sha256: string;
}

function assertIdentityString(value: string, label: string): Uint8Array {
  if (!value.trim() || value.normalize("NFC") !== value) {
    throw new Error(`${label} must be non-empty NFC text`);
  }
  const bytes = new TextEncoder().encode(value);
  if (bytes.byteLength < 1 || bytes.byteLength > 1024) {
    throw new Error(`${label} UTF-8 length is outside the supported range`);
  }
  return bytes;
}

function canonicalFloat32(value: number): number {
  const rounded = Math.fround(value);
  if (!Number.isFinite(rounded)) {
    throw new Error("Codebook value is not representable as finite Float32");
  }
  return Object.is(rounded, -0) ? 0 : rounded;
}

function validateDimensions(codebook: ProductQuantizerCodebook): number {
  const {
    embeddingDimension: dimension,
    subspaces,
    codebookSize,
    residualStages,
    maxTokensPerSegment
  } = codebook;
  if (!Number.isInteger(dimension) || dimension < 1 || dimension > 8192 ||
      !Number.isInteger(subspaces) || subspaces < 1 || dimension % subspaces !== 0 ||
      !Number.isInteger(codebookSize) || codebookSize < 2 || codebookSize > 256 ||
      !Number.isInteger(residualStages) || residualStages < 1 || residualStages > 3 ||
      !Number.isInteger(maxTokensPerSegment) || maxTokensPerSegment < 1 || maxTokensPerSegment > 65535 ||
      codebook.stages.length !== residualStages ||
      codebook.stages.some(stage => stage.length !== subspaces)) {
    throw new Error("GCB1 codebook dimensions are invalid");
  }
  const tableLength = codebookSize * (dimension / subspaces);
  if (codebook.stages.some(stage => stage.some(table => table.length !== tableLength))) {
    throw new Error("GCB1 codebook table length is invalid");
  }
  return tableLength;
}

export async function serializeGIECodebookArtifact(
  codebook: ProductQuantizerCodebook
): Promise<GIECodebookArtifact> {
  const tableLength = validateDimensions(codebook);
  const modelId = assertIdentityString(codebook.modelId, "modelId");
  const revision = assertIdentityString(codebook.modelRevision, "modelRevision");
  const valueCount = codebook.residualStages * codebook.subspaces * tableLength;
  const byteLength = HEADER_BYTES + modelId.byteLength + revision.byteLength + valueCount * 4;
  if (byteLength > MAX_ARTIFACT_BYTES) throw new Error("GCB1 artifact exceeds 25 MiB");

  const bytes = new Uint8Array(byteLength);
  bytes.set(MAGIC, 0);
  const view = new DataView(bytes.buffer);
  bytes[4] = 1;
  bytes[5] = 0;
  view.setUint16(6, codebook.embeddingDimension, true);
  view.setUint16(8, codebook.subspaces, true);
  view.setUint16(10, codebook.codebookSize, true);
  bytes[12] = codebook.residualStages;
  bytes[13] = 0;
  view.setUint16(14, codebook.maxTokensPerSegment, true);
  view.setUint16(16, modelId.byteLength, true);
  view.setUint16(18, revision.byteLength, true);
  let cursor = HEADER_BYTES;
  bytes.set(modelId, cursor);
  cursor += modelId.byteLength;
  bytes.set(revision, cursor);
  cursor += revision.byteLength;

  for (const stage of codebook.stages) {
    for (const table of stage) {
      for (let index = 0; index < table.length; index += 1) {
        view.setFloat32(cursor, canonicalFloat32(table[index]), true);
        cursor += 4;
      }
    }
  }

  const digestInput = bytes.slice().buffer as ArrayBuffer;
  const digest = await globalThis.crypto.subtle.digest("SHA-256", digestInput);
  const sha256 = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, "0")).join("");
  return { bytes, sha256 };
}

export async function loadGIECodebookArtifact(
  bytes: Uint8Array,
  expectedSHA256: string,
  expectedIdentity: { modelId: string; modelRevision: string }
): Promise<ProductQuantizerCodebook> {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < HEADER_BYTES ||
      bytes.byteLength > MAX_ARTIFACT_BYTES || !/^[a-f0-9]{64}$/.test(expectedSHA256)) {
    throw new Error("GCB1 artifact bounds or expected digest are invalid");
  }
  const digestInput = bytes.slice().buffer as ArrayBuffer;
  const digest = await globalThis.crypto.subtle.digest("SHA-256", digestInput);
  const actual = Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, "0")).join("");
  if (actual !== expectedSHA256) throw new Error("GCB1 artifact SHA-256 mismatch");

  if (MAGIC.some((value, index) => bytes[index] !== value)) throw new Error("GCB1 magic is invalid");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes[4] !== 1 || bytes[5] !== 0 || bytes[13] !== 0) throw new Error("GCB1 version or flags are invalid");
  const embeddingDimension = view.getUint16(6, true);
  const subspaces = view.getUint16(8, true);
  const codebookSize = view.getUint16(10, true);
  const residualStages = bytes[12];
  const maxTokensPerSegment = view.getUint16(14, true);
  const modelIdLength = view.getUint16(16, true);
  const revisionLength = view.getUint16(18, true);
  if (embeddingDimension < 1 || embeddingDimension > 8192 ||
      subspaces < 1 || embeddingDimension % subspaces !== 0 ||
      codebookSize < 2 || codebookSize > 256 ||
      residualStages < 1 || residualStages > 3 ||
      maxTokensPerSegment < 1 || modelIdLength < 1 || modelIdLength > 1024 ||
      revisionLength < 1 || revisionLength > 1024) {
    throw new Error("GCB1 dimensions or string lengths are invalid");
  }

  const stringsEnd = HEADER_BYTES + modelIdLength + revisionLength;
  const tableLength = codebookSize * (embeddingDimension / subspaces);
  const valueCount = residualStages * subspaces * tableLength;
  const expectedLength = stringsEnd + valueCount * 4;
  if (!Number.isSafeInteger(expectedLength) || expectedLength !== bytes.byteLength) {
    throw new Error("GCB1 artifact length is invalid");
  }
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const modelId = decoder.decode(bytes.subarray(HEADER_BYTES, HEADER_BYTES + modelIdLength));
  const modelRevision = decoder.decode(bytes.subarray(HEADER_BYTES + modelIdLength, stringsEnd));
  if (!modelId.trim() || !modelRevision.trim() ||
      modelId.normalize("NFC") !== modelId || modelRevision.normalize("NFC") !== modelRevision ||
      modelId !== expectedIdentity.modelId || modelRevision !== expectedIdentity.modelRevision) {
    throw new Error("GCB1 model identity is invalid or mismatched");
  }

  let cursor = stringsEnd;
  const stages: Float64Array[][] = [];
  for (let stageIndex = 0; stageIndex < residualStages; stageIndex += 1) {
    const stage: Float64Array[] = [];
    for (let subspace = 0; subspace < subspaces; subspace += 1) {
      const table = new Float64Array(tableLength);
      for (let index = 0; index < tableLength; index += 1) {
        const bits = view.getUint32(cursor, true);
        const value = view.getFloat32(cursor, true);
        cursor += 4;
        if (!Number.isFinite(value) || bits === 0x80000000) {
          throw new Error("GCB1 contains a non-finite value or noncanonical negative zero");
        }
        table[index] = value;
      }
      stage.push(table);
    }
    stages.push(stage);
  }

  return {
    codebookId: actual,
    modelId,
    modelRevision,
    embeddingDimension,
    subspaces,
    codebookSize,
    residualStages,
    maxTokensPerSegment,
    stages
  };
}
