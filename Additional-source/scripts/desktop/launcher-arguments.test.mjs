import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), "pocket-launcher-args-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const rel = "nested project/scripts/desktop";
  const desktop = path.join(root, rel);
  await mkdir(desktop, { recursive: true });
  for (const name of ["launcher.mjs", "start-pocket-ai-lab.sh"]) {
    await copyFile(new URL(name, import.meta.url), path.join(desktop, name));
  }
  // No real app, model server, browser, or governance side effects.
  await writeFile(path.join(desktop, "launcher-lib.mjs"), `
export const redact = x => x;
export const statusText = x => x.options;
export async function launch({ headless, governance }) {
  return { status: { exitCode: 0, options: 'STUB:' + JSON.stringify({ headless, governance }) } };
}`);
  return { cwd: root, rel, env: { ...process.env, POCKET_LAUNCHER_HEADLESS: "", POCKET_NO_GOVERNANCE: "" },
    encoding: "utf8" };
}

test("launcher help does not launch services", async t => {
  const { rel, ...opts } = await fixture(t);
  for (const flag of ["--help", "-h"]) {
    const result = spawnSync(process.execPath, [path.join(rel, "launcher.mjs"), flag], opts);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Usage:/);
    assert.match(result.stdout, /--headless/);
    assert.doesNotMatch(result.stdout, /STUB:/);
  }
});

test("launcher rejects unknown options and positional arguments before launch", async t => {
  const { rel, ...opts } = await fixture(t);
  for (const arg of ["--headles", "unexpected"]) {
    const result = spawnSync(process.execPath, [path.join(rel, "launcher.mjs"), arg], opts);
    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stderr, /Usage:/);
    assert.doesNotMatch(result.stdout, /STUB:/);
  }
});

test("documented checkout-relative shell path forwards launcher flags", { skip: process.platform === "win32" }, async t => {
  const { rel, ...opts } = await fixture(t);
  const result = spawnSync("sh", [path.join(rel, "start-pocket-ai-lab.sh"), "--no-governance", "--headless"], opts);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), 'STUB:{"headless":true,"governance":false}');
});

test("known flags and existing environment controls keep their meaning", async t => {
  const { rel, ...opts } = await fixture(t);
  const module = path.join(rel, "launcher.mjs");
  for (const [args, env, expected] of [
    [[], {}, 'STUB:{"headless":false,"governance":true}'],
    [["--headless"], {}, 'STUB:{"headless":true,"governance":true}'],
    [["--no-governance"], {}, 'STUB:{"headless":false,"governance":false}'],
    [[], { POCKET_LAUNCHER_HEADLESS: "1", POCKET_NO_GOVERNANCE: "1" }, 'STUB:{"headless":true,"governance":false}']
  ]) {
    const result = spawnSync(process.execPath, [module, ...args], { ...opts, env: { ...opts.env, ...env } });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), expected);
  }
});
