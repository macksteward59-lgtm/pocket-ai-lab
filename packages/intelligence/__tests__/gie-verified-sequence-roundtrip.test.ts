import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadGIECodebookArtifact } from "../latent-communication/GIECodebookArtifact";
import { PooledProductQuantizer } from "../latent-communication/PooledProductQuantizer";

type ArtifactFixture = {
  artifactHex: string;
  sha256: string;
  modelId: string;
  modelRevision: string;
};
type SequenceFixture = {
  sourceArtifact: string;
  codebookSha256: string;
  modelId: string;
  modelRevision: string;
  tokenCount: number;
  embeddingDimension: number;
  tokenEmbeddings: number[];
  payloadByteLength: number;
  payloadHex: string;
  segmentTokenCounts: number[];
  decodedSegmentEmbeddings: number[];
};

const fixtureDir = "runtime/ios/Tests/LlamaEngineTests/Fixtures/";
const artifact = JSON.parse(readFileSync(
  fixtureDir + "gie-codebook-artifact-v1.json", "utf8"
)) as ArtifactFixture;
const sequence = JSON.parse(readFileSync(
  fixtureDir + "gie-verified-sequence-v1.json", "utf8"
)) as SequenceFixture;

function hexBytes(value: string): Uint8Array {
  if (!/^(?:[a-f0-9]{2})+$/i.test(value)) throw new Error("Invalid fixture hex");
  return Uint8Array.from(value.match(/../g)!, byte => Number.parseInt(byte, 16));
}

describe("GIE1 encoder/decoder with verified canonical GCB1 artifact", () => {
  it("agrees byte-for-byte with the native Swift encoder's shared GIE1 fixture", async () => {
    expect(sequence.sourceArtifact).toBe("gie-codebook-artifact-v1.json");
    expect(sequence.codebookSha256).toBe(artifact.sha256);
    expect(sequence.modelId).toBe(artifact.modelId);
    expect(sequence.modelRevision).toBe(artifact.modelRevision);

    const identity = { modelId: artifact.modelId, modelRevision: artifact.modelRevision };
    const codebook = await loadGIECodebookArtifact(
      hexBytes(artifact.artifactHex), artifact.sha256, identity
    );
    const codec = new PooledProductQuantizer(codebook);
    const encoded = codec.encode({
      tokenEmbeddings: Float32Array.from(sequence.tokenEmbeddings),
      tokenCount: sequence.tokenCount,
      embeddingDimension: sequence.embeddingDimension
    }, identity);

    expect(codebook.codebookId).toBe(sequence.codebookSha256);
    expect(encoded.bytes.byteLength).toBe(sequence.payloadByteLength);
    expect(encoded.bytes).toEqual(hexBytes(sequence.payloadHex));
    const decoded = codec.decode(encoded.bytes, identity);
    expect(decoded.tokenCount).toBe(sequence.tokenCount);
    expect(decoded.embeddingDimension).toBe(sequence.embeddingDimension);
    expect(decoded.segmentTokenCounts).toEqual(sequence.segmentTokenCounts);
    expect(Array.from(decoded.segmentEmbeddings)).toEqual(sequence.decodedSegmentEmbeddings);

    const tampered = encoded.bytes.slice();
    tampered[18] ^= 1;
    expect(() => codec.decode(tampered, identity)).toThrow(/negotiated codebook/);
    expect(() => codec.encode({
      tokenEmbeddings: Float32Array.from(sequence.tokenEmbeddings),
      tokenCount: sequence.tokenCount,
      embeddingDimension: sequence.embeddingDimension
    }, { ...identity, modelRevision: "another-revision" })).toThrow(/different model identity/);
  });
});
