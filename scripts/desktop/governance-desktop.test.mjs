import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
    const example = await readFile(path.join(root, ".env.example"), "utf8");
    const created = await setupEnv({ root });
    assert.equal(created.created, true);
    assert.equal(created.keyGenerated, true);
    const written = await readFile(created.path, "utf8");
    assert.match(written, /^GOVERNANCE_AUTHORIZED=false\s*$/m);
    assert.match(written, /^GOVERNANCE_FERNET_KEY=\S+/m);
    assert.equal(example.includes("GOVERNANCE_FERNET_KEY=\n") || example.endsWith("GOVERNANCE_FERNET_KEY="), true);
    assert.equal(example.includes(written.match(/^GOVERNANCE_FERNET_KEY=(\S+)/m)[1]), false);
    const again = await setupEnv({ root });
    assert.equal(again.created, false);
    assert.equal(again.keyGenerated, false);
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

test("sh keeps the sidecar alive while the watcher is running", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "governance-sh-"));
  const python = path.join(dir, "python3");
  const node = path.join(dir, "node");
  await writeFile(python, `#!/bin/sh
if [ "$1" = "-c" ]; then exit 0; fi
if [ "$1" = "-" ]; then cat >/dev/null; exit 0; fi
if [ "$1" = "-m" ]; then
  echo $$ > "$STUB_DIR/uvicorn.pid"
  trap 'exit 0' TERM INT
  while true; do sleep 1; done
fi
exit 0
`);
  await writeFile(node, `#!/bin/sh
echo $$ > "$STUB_DIR/watcher.pid"
trap 'exit 0' TERM INT
while true; do sleep 1; done
`);
  await chmod(python, 0o755);
  await chmod(node, 0o755);
  const child = spawn("sh", [path.join(repoRoot, "scripts/desktop/start-governance-pipeline.sh")], {
    cwd: repoRoot,
    env: {
      PATH: dir + ":/usr/bin:/bin",
      STUB_DIR: dir,
      HOME: dir,
      GOVERNANCE_SIDECAR_HOST: "127.0.0.1"
    },
    stdio: ["ignore", "pipe", "pipe"],
    detached: true
  });
  let output = "";
  child.stdout.on("data", chunk => { output += chunk; });
  child.stderr.on("data", chunk => { output += chunk; });
  const pidFile = path.join(dir, "uvicorn.pid");
  const started = Date.now();
  let sidecarPid = "";
  try {
    while (!sidecarPid && Date.now() - started < 4000) {
      try {
        sidecarPid = (await readFile(pidFile, "utf8")).trim();
      } catch {
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    }
    assert.ok(sidecarPid, output);
    await new Promise(resolve => setTimeout(resolve, 400));
    process.kill(Number(sidecarPid), 0);
    const watcherPid = (await readFile(path.join(dir, "watcher.pid"), "utf8")).trim();
    process.kill(Number(watcherPid), 0);
  } finally {
    try { process.kill(-child.pid, "SIGTERM"); } catch { child.kill("SIGTERM"); }
    await new Promise(resolve => child.once("exit", resolve));
    await rm(dir, { recursive: true, force: true });
  }
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
