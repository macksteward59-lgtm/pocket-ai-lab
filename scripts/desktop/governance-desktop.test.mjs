import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setupEnv } from "./setup-env.mjs";
import { verifyGovernanceStack } from "./verify-governance-stack.mjs";
import { rotateIfNeeded } from "./LogRotator.ts";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

test("setup-env copies stubs and refuses a populated example key", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "governance-env-"));
  try {
    await writeFile(path.join(root, ".env.example"), "GOVERNANCE_AUTHORIZED=false\nGOVERNANCE_FERNET_KEY=\n");
    const created = await setupEnv({ root });
    assert.equal(created.created, true);
    assert.equal(await readFile(created.path, "utf8"), "GOVERNANCE_AUTHORIZED=false\nGOVERNANCE_FERNET_KEY=\n");
    const again = await setupEnv({ root });
    assert.equal(again.created, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("verify-governance-stack accepts this repository", async () => {
  const result = await verifyGovernanceStack(repoRoot);
  assert.deepEqual(result.failures, []);
  assert.equal(result.ok, true);
});

test("pipeline start refuses a non-loopback host", () => {
  const result = spawnSync("sh", ["scripts/desktop/start-governance-pipeline.sh"], {
    cwd: repoRoot,
    env: { ...process.env, GOVERNANCE_SIDECAR_HOST: "0.0.0.0" },
    encoding: "utf8"
  });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr + result.stdout, /loopback|127\.0\.0\.1/);
});

test("log rotation renames a large file", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "governance-log-"));
  const file = path.join(dir, "watcher.log");
  try {
    await writeFile(file, "x".repeat(20));
    await rotateIfNeeded(file, 10, 2);
    assert.equal(await readFile(file + ".1", "utf8"), "x".repeat(20));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
