import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import net from "node:net";
import { buildArchive } from "./package-archive.mjs";
import { listenAvailable } from "./launcher-lib.mjs";

test("extracted archive launcher, build, and tests work outside the repository", { timeout: 300000 }, async () => {
  const buildDir = await mkdtemp(path.join(tmpdir(), "pocket-zip-"));
  const extractDir = await mkdtemp(path.join(tmpdir(), "pocket-unpack-"));
  const home = await mkdtemp(path.join(tmpdir(), "pocket-home-"));
  const built = await buildArchive({ destDir: buildDir });
  const unzip = spawnSync("unzip", ["-q", built.archivePath, "-d", extractDir], { encoding: "utf8" });
  assert.equal(unzip.status, 0, unzip.stderr);
  const root = path.join(extractDir, "pocket-ai-lab");
  const installed = spawnSync("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund"], {
    cwd: root,
    env: childEnv(),
    encoding: "utf8",
    timeout: 180000
  });
  assert.equal(installed.status, 0, tail(installed.stderr));
  const compiled = spawnSync("npm", ["run", "build"], { cwd: root, env: childEnv(), encoding: "utf8", timeout: 120000 });
  assert.equal(compiled.status, 0, tail(compiled.stderr));

  const missing = spawnSync(process.execPath, ["scripts/desktop/require-tests.mjs", "apps/web/test/does-not-exist-*.test.mjs"], {
    cwd: root,
    env: childEnv(),
    encoding: "utf8"
  });
  assert.equal(missing.status, 1);

  const web = spawnSync(process.execPath, ["--import", "tsx", "--test", "apps/web/test/agents-scroll.test.mjs"], {
    cwd: root,
    env: childEnv(),
    encoding: "utf8",
    timeout: 60000
  });
  assert.equal(web.status, 0, tail(web.stdout + web.stderr));
  const webText = web.stdout + web.stderr;
  const webCount = Number((webText.match(/# tests (\d+)/) || [])[1] || 0);
  assert.ok(webCount > 0, tail(webText));

  const engine = spawnSync("npx", ["vitest", "run", "packages/intelligence/__tests__", "--reporter=dot"], {
    cwd: root,
    env: childEnv(),
    encoding: "utf8",
    timeout: 120000
  });
  assert.equal(engine.status, 0, tail(engine.stdout + engine.stderr));
  assert.match(engine.stdout, /Test Files\s+[1-9]/);

  const occupied = 46331;
  const blocker = net.createServer((socket) => socket.end("other"));
  await new Promise(resolve => blocker.listen(occupied, "127.0.0.1", resolve));
  const child = spawn("sh", ["start-pocket-ai-lab.sh", "--headless"], {
    cwd: root,
    env: childEnv({ HOME: home, PORT: String(occupied), POCKET_GGUF_PATH: "" }),
    stdio: ["ignore", "pipe", "pipe"]
  });
  let output = "";
  child.stdout.on("data", chunk => { output += chunk; });
  child.stderr.on("data", chunk => { output += chunk; });
  const started = Date.now();
  while (!output.includes("listening at") && Date.now() - started < 30000) {
    if (child.exitCode !== null) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  let launchedPort = 0;
  try {
    assert.match(output, /listening at http:\/\/127\.0\.0\.1:\d+\//, output);
    launchedPort = Number(output.match(/127\.0\.0\.1:(\d+)/)[1]);
    assert.notEqual(launchedPort, occupied);
    const health = await fetch("http://127.0.0.1:" + launchedPort + "/api/health");
    const body = await health.json();
    assert.equal(health.status, 200);
    assert.equal(body.provider, "llama.cpp");
    assert.equal(body.reachable, false);
    const probe = await connect(occupied);
    assert.equal(probe, "other");
  } finally {
    child.kill("SIGTERM");
    await new Promise(resolve => child.once("exit", resolve));
    await new Promise(resolve => blocker.close(resolve));
    await rm(buildDir, { recursive: true, force: true });
    await rm(extractDir, { recursive: true, force: true });
    await rm(home, { recursive: true, force: true });
  }
  if (launchedPort) {
    for (let attempt = 0; attempt < 20 && !(await listenAvailable(launchedPort)); attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.equal(await listenAvailable(launchedPort), true);
  }
});

function childEnv(extra = {}) {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith("NODE_TEST") || key.startsWith("NODE_CHANNEL")) continue;
    env[key] = value;
  }
  delete env.POCKET_GGUF_PATH;
  return { ...env, ...extra };
}

function tail(text) {
  return String(text || "").slice(-2000);
}

function connect(port) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, "127.0.0.1", () => {});
    let data = "";
    socket.on("data", chunk => { data += chunk; });
    socket.on("end", () => resolve(data));
    socket.on("error", reject);
  });
}
