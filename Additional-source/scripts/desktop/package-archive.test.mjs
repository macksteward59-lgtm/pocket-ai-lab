import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { lstat, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { collectFiles } from "./package-archive.mjs";

test("archive file collection excludes submodule gitlinks and symlinks", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "pocket-archive-index-"));
  const outside = path.join(os.tmpdir(), "pocket-archive-outside-secret.txt");
  try {
    await mkdir(path.join(root, "scripts/local-gguf"), { recursive: true });
    await mkdir(path.join(root, "scripts/desktop"), { recursive: true });
    await mkdir(path.join(root, "packages/exploitgym"), { recursive: true });
    await writeFile(path.join(root, "scripts/local-gguf/lib.mjs"), "export {}\n");
    await writeFile(path.join(root, "scripts/desktop/launcher-lib.mjs"), "export {}\n");
    await writeFile(path.join(root, "fixture.test.mjs"), "import test from 'node:test';\n");
    await writeFile(path.join(root, "tsconfig.json"), "{}\n");
    await writeFile(path.join(root, "package.json"), "{}\n");
    await writeFile(outside, "must not be followed or packaged\n");
    await symlink(outside, path.join(root, "linked-secret.txt"));

    execFileSync("git", ["init", "--quiet"], { cwd: root });
    execFileSync("git", ["config", "user.email", "archive-test@example.invalid"], { cwd: root });
    execFileSync("git", ["config", "user.name", "Archive Test"], { cwd: root });
    execFileSync("git", ["add", "-A"], { cwd: root });
    execFileSync("git", [
      "update-index", "--add", "--cacheinfo",
      "160000,a8029e47135a29f1c1a6e79109bf86fba379b3f3,packages/exploitgym"
    ], { cwd: root });

    const entries = await collectFiles(root);
    assert.ok(entries.includes("package.json"));
    assert.ok(entries.includes("fixture.test.mjs"));
    assert.equal(entries.includes("packages/exploitgym"), false);
    assert.equal(entries.includes("linked-secret.txt"), false);
    const linkInfo = await lstat(path.join(root, "linked-secret.txt"));
    assert.equal(linkInfo.isSymbolicLink(), true);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { force: true });
  }
});
