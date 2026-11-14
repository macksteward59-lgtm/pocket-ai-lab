import { afterEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { FileToolArtifactStore } from "./FileToolArtifactStore";
import type { ToolArtifact } from "../../../packages/intelligence/tooling/ToolDirector";

const roots: string[] = [];
async function temporaryRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), "pocket-tool-artifacts-"));
  roots.push(root);
  return root;
}

const artifactSpec = {
  id: "artifact-inspector",
  name: "Artifact Inspector",
  purpose: "Inspect explicitly supplied project artifacts.",
  specialists: ["reverse-engineering" as const],
  change: "create" as const,
  requirements: ["Read only supplied files", "Return structured metadata"]
};
const artifactFiles: Record<string, string> = { "src/index.ts": "export const inspect = () => true;" };
function digestFor(spec: typeof artifactSpec, files: Record<string, string>) {
  const canonical = JSON.stringify({
    spec: {
      id: spec.id, name: spec.name, purpose: spec.purpose,
      specialists: [...spec.specialists], change: spec.change, requirements: [...spec.requirements]
    },
    files: Object.keys(files).sort().map(filePath => [filePath, files[filePath]])
  });
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}
const artifact: ToolArtifact = {
  toolId: "artifact-inspector",
  version: 1,
  spec: artifactSpec,
  digest: digestFor(artifactSpec, artifactFiles),
  files: artifactFiles,
  createdAt: new Date(0).toISOString(),
  status: "ready",
  testSummary: {
    passed: true, testsRun: 2, testsPassed: 2, findings: [], completedAt: new Date(0).toISOString()
  }
};

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

describe("FileToolArtifactStore", () => {
  it("persists version history across store instances", async () => {
    const root = await temporaryRoot();
    const first = new FileToolArtifactStore(root);
    await first.put(artifact);
    const nextSpec = { ...artifactSpec, requirements: [...artifactSpec.requirements, "Record provenance"] };
    await first.put({ ...artifact, version: 2, spec: nextSpec, digest: digestFor(nextSpec, artifactFiles), previousDigest: artifact.digest });
    const reopened = new FileToolArtifactStore(root);
    expect((await reopened.getLatest(artifact.toolId))?.version).toBe(2);
    expect((await reopened.list()).map(item => item.version)).toEqual([1, 2]);
  });

  it("returns detached copies so callers cannot mutate stored history", async () => {
    const store = new FileToolArtifactStore(await temporaryRoot());
    await store.put(artifact);
    const loaded = await store.getLatest(artifact.toolId);
    loaded!.files["src/index.ts"] = "tampered";
    loaded!.spec.requirements[0] = "tampered";
    const again = await store.getLatest(artifact.toolId);
    expect(again!.files["src/index.ts"]).toBe(artifact.files["src/index.ts"]);
    expect(again!.spec.requirements[0]).toBe(artifact.spec.requirements[0]);
  });

  it("rejects traversal ids and symlinked tool directories", async () => {
    const root = await temporaryRoot();
    const store = new FileToolArtifactStore(root);
    await expect(store.getLatest("../escape")).rejects.toThrow(/Invalid tool id/);
    const outside = await temporaryRoot();
    await symlink(outside, path.join(root, artifact.toolId), "dir");
    await expect(store.getLatest(artifact.toolId)).rejects.toThrow(/safe directory/);
  });

  it("fails closed on a corrupt artifact record", async () => {
    const root = await temporaryRoot();
    const directory = path.join(root, artifact.toolId);
    await mkdir(directory);
    await writeFile(path.join(directory, "1.json"), "{broken");
    const store = new FileToolArtifactStore(root);
    await expect(store.getLatest(artifact.toolId)).rejects.toThrow(/Corrupt artifact record/);
  });

  it("rejects source tampering even when the stored digest field is unchanged", async () => {
    const root = await temporaryRoot();
    const store = new FileToolArtifactStore(root);
    await store.put(artifact);
    const filename = path.join(root, artifact.toolId, "1.json");
    const record = JSON.parse(await readFile(filename, "utf8"));
    record.files["src/index.ts"] = "export const inspect = () => false;";
    await writeFile(filename, JSON.stringify(record));
    await expect(store.getLatest(artifact.toolId)).rejects.toThrow(/digest does not match/);
  });

  it("writes owner-only files and atomically replaces lifecycle state", async () => {
    const root = await temporaryRoot();
    const store = new FileToolArtifactStore(root);
    await store.put(artifact);
    await store.put({ ...artifact, status: "active" });
    const record = JSON.parse(await readFile(path.join(root, artifact.toolId, "1.json"), "utf8"));
    expect(record.status).toBe("active");
    expect((await store.getLatest(artifact.toolId))?.status).toBe("active");
    expect((await stat(path.join(root, artifact.toolId))).mode & 0o777).toBe(0o700);
    expect((await stat(path.join(root, artifact.toolId, "1.json"))).mode & 0o777).toBe(0o600);
  });
});
