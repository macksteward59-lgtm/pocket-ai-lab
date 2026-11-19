import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  loadGIECodebookArtifact,
  serializeGIECodebookArtifact
} from "../latent-communication/GIECodebookArtifact";
import type { ProductQuantizerCodebook } from "../latent-communication/PooledProductQuantizer";

interface SharedFixture {
  artifactLength: number;
  artifactHex: string;
  sha256: string;
  modelId: string;
  modelRevision: string;
  embeddingDimension: number;
  subspaces: number;
  codebookSize: number;
  residualStages: number;
  maxTokensPerSegment: number;
  stages: number[][][];
}

const fixture = JSON.parse(readFileSync(
  new URL("../../../runtime/ios/Tests/LlamaEngineTests/Fixtures/gie-codebook-artifact-v1.json", import.meta.url),
  "utf8"
)) as SharedFixture;

function fixtureCodebook(): ProductQuantizerCodebook {
  return {
    codebookId: fixture.sha256,
    modelId: fixture.modelId,
    modelRevision: fixture.modelRevision,
    embeddingDimension: fixture.embeddingDimension,
    subspaces: fixture.subspaces,
    codebookSize: fixture.codebookSize,
    residualStages: fixture.residualStages,
    maxTokensPerSegment: fixture.maxTokensPerSegment,
    stages: fixture.stages.map(stage => stage.map(table => Float64Array.from(table)))
  };
}

describe("GCB1 canonical codebook artifact", () => {
  it("serializes and reloads the exact fixture shared with Swift", async () => {
    const encoded = await serializeGIECodebookArtifact(fixtureCodebook());
    expect(encoded.bytes.byteLength).toBe(fixture.artifactLength);
    expect(Array.from(encoded.bytes, byte => byte.toString(16).padStart(2, "0")).join(""))
      .toBe(fixture.artifactHex);
    expect(encoded.sha256).toBe(fixture.sha256);

    const decoded = await loadGIECodebookArtifact(
      encoded.bytes,
      fixture.sha256,
      { modelId: fixture.modelId, modelRevision: fixture.modelRevision }
    );
    expect(decoded.codebookId).toBe(fixture.sha256);
    expect(decoded.stages[0][0]).toEqual([1.25, -2.5, 3.75, 4.5]);
    expect(decoded.embeddingDimension).toBe(2);
  });

  it("rejects a mismatched digest and model identity", async () => {
    const encoded = await serializeGIECodebookArtifact(fixtureCodebook());
    await expect(loadGIECodebookArtifact(
      encoded.bytes,
      "0".repeat(64),
      { modelId: fixture.modelId, modelRevision: fixture.modelRevision }
    )).rejects.toThrow("SHA-256 mismatch");
    await expect(loadGIECodebookArtifact(
      encoded.bytes,
      fixture.sha256,
      { modelId: "other-model", modelRevision: fixture.modelRevision }
    )).rejects.toThrow("model identity");
  });
});
