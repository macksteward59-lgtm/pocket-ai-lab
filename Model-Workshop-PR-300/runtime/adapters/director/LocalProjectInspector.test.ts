import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalProjectInspector } from "./LocalProjectInspector";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});

describe("LocalProjectInspector", () => {
  it("inspects only selected text files and reports bounded TODO evidence", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pocket-inspector-"));
    directories.push(root);
    await writeFile(path.join(root, "README.md"), "# Project\nTODO: document runtime");
    await writeFile(path.join(root, "image.png"), "not text");
    const inspector = await LocalProjectInspector.open(root);
    const result = await inspector.inspect({ objective: "inspect project" });

    expect(result.summary).toContain("README.md");
    expect(result.findings).toEqual([expect.objectContaining({
      id: "README.md:2",
      title: "Unresolved TODO/FIXME marker",
      evidenceRefs: ["README.md:2"]
    })]);
  });

  it("rejects traversal and symlink escapes", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pocket-inspector-root-"));
    const outside = await mkdtemp(path.join(os.tmpdir(), "pocket-inspector-outside-"));
    directories.push(root, outside);
    await writeFile(path.join(outside, "secret.md"), "secret");
    await mkdir(path.join(root, "nested"));
    const inspector = await LocalProjectInspector.open(root);
    await expect(inspector.inspect({ objective: "inspect", paths: ["../secret.md"] })).rejects.toThrow(/relative paths/);
    const link = path.join(root, "escape.md");
    const { symlink } = await import("node:fs/promises");
    await symlink(path.join(outside, "secret.md"), link);
    await expect(inspector.inspect({ objective: "inspect", paths: ["escape.md"] })).rejects.toThrow(/symlink escaped/);
  });
});
