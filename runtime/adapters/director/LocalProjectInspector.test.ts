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

  it("verifies an exact source excerpt and its 1-based line range", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pocket-reference-"));
    directories.push(root);
    await writeFile(path.join(root, "README.md"), "# Example\r\nconst answer = 42;\r\nexport {}\r\n");
    const inspector = await LocalProjectInspector.open(root);

    await expect(inspector.verifySourceReference({
      path: "README.md", quote: "const answer = 42;", startLine: 2, endLine: 2
    })).resolves.toEqual({
      status: "verified", path: "README.md", occurrenceCount: 1, startLine: 2, endLine: 2
    });
    await expect(inspector.verifySourceReference({
      path: "./README.md", quote: "const answer = 42;", startLine: 2, endLine: 2
    })).resolves.toMatchObject({ status: "verified", path: "README.md", startLine: 2 });
  });

  it("rejects paraphrases and reports duplicate excerpts as ambiguous without a line hint", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pocket-reference-duplicates-"));
    directories.push(root);
    await writeFile(path.join(root, "README.md"), "const target = 1;\nconst target = 1;\n");
    const inspector = await LocalProjectInspector.open(root);

    await expect(inspector.verifySourceReference({
      path: "README.md", quote: "const target equals one"
    })).resolves.toMatchObject({ status: "unverified", occurrenceCount: 0, reason: "quote_not_found" });
    await expect(inspector.verifySourceReference({
      path: "README.md", quote: "const target = 1;"
    })).resolves.toMatchObject({ status: "unverified", occurrenceCount: 2, reason: "ambiguous_match" });
    await expect(inspector.verifySourceReference({
      path: "README.md", quote: "const target = 1;", startLine: 2, endLine: 2
    })).resolves.toMatchObject({ status: "verified", occurrenceCount: 2, startLine: 2, endLine: 2 });
  });

  it("fails closed for traversal, unsupported files, and symlink escapes", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pocket-reference-root-"));
    const outside = await mkdtemp(path.join(os.tmpdir(), "pocket-reference-outside-"));
    directories.push(root, outside);
    await writeFile(path.join(outside, "secret.md"), "secret text");
    await writeFile(path.join(root, "image.png"), "not text");
    const inspector = await LocalProjectInspector.open(root);
    const { symlink } = await import("node:fs/promises");
    await symlink(path.join(outside, "secret.md"), path.join(root, "escape.md"));

    await expect(inspector.verifySourceReference({
      path: "../secret.md", quote: "secret text"
    })).resolves.toMatchObject({ status: "unverified", reason: "invalid_reference" });
    await expect(inspector.verifySourceReference({
      path: "image.png", quote: "not text"
    })).resolves.toMatchObject({ status: "unverified", reason: "unsupported_file_type" });
    await expect(inspector.verifySourceReference({
      path: "escape.md", quote: "secret text"
    })).rejects.toThrow(/symlink escaped/);
  });


  it("counts dense duplicate matches without requiring a retained match list", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pocket-reference-dense-"));
    directories.push(root);
    await writeFile(path.join(root, "README.md"), "x".repeat(60000));
    const inspector = await LocalProjectInspector.open(root);

    await expect(inspector.verifySourceReference({
      path: "README.md", quote: "x"
    })).resolves.toMatchObject({
      status: "unverified", occurrenceCount: 60000, reason: "ambiguous_match"
    });
  });

  it("rejects malformed runtime input without throwing", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pocket-reference-invalid-"));
    directories.push(root);
    const inspector = await LocalProjectInspector.open(root);

    await expect(inspector.verifySourceReference(null as never)).resolves.toMatchObject({
      status: "unverified", occurrenceCount: 0, reason: "invalid_reference"
    });
  });


  it("fails closed when the selected source file exceeds the per-file byte bound", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pocket-reference-oversized-"));
    directories.push(root);
    await writeFile(path.join(root, "README.md"), "a".repeat(65537));
    const inspector = await LocalProjectInspector.open(root);

    await expect(inspector.verifySourceReference({
      path: "README.md", quote: "a"
    })).resolves.toMatchObject({
      status: "unverified", occurrenceCount: 0, reason: "file_too_large"
    });
  });

  it("rejects oversized excerpts before reading the source file", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "pocket-reference-long-quote-"));
    directories.push(root);
    const inspector = await LocalProjectInspector.open(root);

    await expect(inspector.verifySourceReference({
      path: "README.md", quote: "x".repeat(8193)
    })).resolves.toMatchObject({
      status: "unverified", occurrenceCount: 0, reason: "invalid_reference"
    });
  });

});
