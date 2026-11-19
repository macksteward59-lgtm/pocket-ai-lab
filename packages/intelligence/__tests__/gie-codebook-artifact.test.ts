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
  "runtime/ios/Tests/LlamaEngineTests/Fixtures/gie-codebook-artifact-v1.json",
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
    expect(Array.from(decoded.stages[0][0])).toEqual([1.25, -2.5, 3.75, 4.5]);
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

  it("rejects unsupported versions and reserved flags after digest verification", async () => {
    const encoded = await serializeGIECodebookArtifact(fixtureCodebook());
    for (const [offset, value] of [[4, 2], [5, 1], [13, 1]] as const) {
      const changed = encoded.bytes.slice();
      changed[offset] = value;
      const digest = await globalThis.crypto.subtle.digest("SHA-256", changed.slice().buffer as ArrayBuffer);
      const expected = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
      await expect(loadGIECodebookArtifact(changed, expected, { modelId: fixture.modelId, modelRevision: fixture.modelRevision })).rejects.toThrow("version or flags");
    }
  });

  it("rejects malformed UTF-8, noncanonical negative zero, and non-finite Float32 values", async () => {
    const encoded = await serializeGIECodebookArtifact(fixtureCodebook());
    const stringsEnd = 20 + new TextEncoder().encode(fixture.modelId).byteLength + new TextEncoder().encode(fixture.modelRevision).byteLength;
    const mutations = [
      { offset: 20, value: 0xff },
      { offset: stringsEnd, value: 0x00, tail: [0x00, 0x00, 0x80] },
      { offset: stringsEnd, value: 0x00, tail: [0x00, 0xc0, 0x7f] }
    ];
    for (const mutation of mutations) {
      const changed = encoded.bytes.slice();
      changed[mutation.offset] = mutation.value;
      if (mutation.tail) changed.set(mutation.tail, mutation.offset + 1);
      const digest = await globalThis.crypto.subtle.digest("SHA-256", changed.slice().buffer as ArrayBuffer);
      const expected = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
      await expect(loadGIECodebookArtifact(changed, expected, { modelId: fixture.modelId, modelRevision: fixture.modelRevision })).rejects.toThrow();
    }
  });
});
