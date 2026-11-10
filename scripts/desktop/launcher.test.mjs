import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer } from "../../apps/web/server.mjs";
import {
  EXPERIMENTAL_GGUF,
  OWNED_ARG,
  browserCommand,
  childEnv,
  choosePort,
  launch,
  listenAvailable,
  nodeIsNewEnough,
  ownsCommand,
  redact,
  resolveGgufSelection,
  stopOwnedFromState
} from "./launcher-lib.mjs";
import { buildArchive, isForbiddenRelative } from "./package-archive.mjs";

test("launcher helpers stay loopback and do not treat a missing model as ready", async () => {
  assert.equal(nodeIsNewEnough("22.1.0"), true);
  assert.equal(nodeIsNewEnough("20.0.0"), false);
  assert.equal(redact("Authorization: Bearer secret-token"), "Authorization: Bearer [redacted]");
  assert.deepEqual(browserCommand("linux", "http://127.0.0.1:4173/").file, "xdg-open");
  assert.equal(browserCommand("darwin", "http://localhost:4173/").file, "open");
  assert.equal(browserCommand("win32", "http://127.0.0.1:4173/").file, "cmd");
  assert.throws(() => browserCommand("linux", "http://example.com/"), /loopback/);
  const env = childEnv({ LLM_API_KEY: "hidden", HOST: "0.0.0.0", PORT: "9" }, {
    port: 4173,
    memoryDir: "/tmp/memory",
    llamaBaseUrl: "http://127.0.0.1:9"
  });
  assert.equal(env.HOST, "127.0.0.1");
  assert.equal(env.PORT, "4173");
  assert.equal(env.LLM_API_KEY, undefined);
  assert.equal(env.LLAMACPP_BASE_URL, "http://127.0.0.1:9");
  assert.equal(ownsCommand("node server.mjs " + OWNED_ARG, "web", ""), true);
  assert.equal(ownsCommand("node server.mjs", "web", ""), false);
  assert.equal(ownsCommand("llama-server -m /models/local.gguf --host 127.0.0.1", "llama", "/models/local.gguf"), true);
  assert.equal(ownsCommand("nginx", "llama", "/models/local.gguf"), false);

  const home = await mkdtemp(path.join(tmpdir(), "pocket-launcher-"));
  const missing = await resolveGgufSelection({
    env: {},
    home,
    readText: async () => "{}",
    fileExists: async () => false
  });
  assert.match(missing.error, /does not download weights/);
  const experimental = await resolveGgufSelection({
    env: { POCKET_GGUF_PATH: path.join(home, EXPERIMENTAL_GGUF) },
    home,
    readText: async () => "",
    fileExists: async () => false
  });
  assert.match(experimental.error, /not bundled/);
  await rm(home, { recursive: true, force: true });
});

test("a busy port is left alone and the launcher picks another", async () => {
  const blocker = createServer();
  await new Promise(resolve => blocker.listen(0, "127.0.0.1", resolve));
  const occupied = blocker.address().port;
  try {
    const chosen = await choosePort(occupied, listenAvailable);
    assert.notEqual(chosen, occupied);
    assert.equal(await listenAvailable(occupied), false);
  } finally {
    await new Promise(resolve => blocker.close(resolve));
  }
});

test("shutdown stops an owned process and leaves a foreign process running", async () => {
  const owned = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)", "server.mjs", OWNED_ARG], { stdio: "ignore" });
  const foreign = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
  const home = await mkdtemp(path.join(tmpdir(), "pocket-owned-"));
  const state = path.join(home, "state.json");
  await writeFile(state, JSON.stringify({
    web: { pid: owned.pid, port: 4173 },
    llama: { pid: foreign.pid, port: 8080, model: "not-in-command.gguf" }
  }));
  try {
    const result = await stopOwnedFromState(state, pid => {
      try { process.kill(pid, "SIGTERM"); } catch { /* already gone */ }
    });
    assert.deepEqual(result.stopped, ["web"]);
    assert.deepEqual(result.skipped, ["llama"]);
    await new Promise(resolve => setTimeout(resolve, 200));
    assert.equal(alive(owned.pid), false);
    assert.equal(alive(foreign.pid), true);
  } finally {
    try { foreign.kill("SIGTERM"); } catch { /* already gone */ }
    await rm(home, { recursive: true, force: true });
  }
});

test("the launcher starts the loopback app, preserves memory, and does not invent a model", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "pocket-launch-"));
  const opened = [];
  let server;
  const handle = await launch({
    home,
    env: { PORT: "46011", LLM_API_KEY: "do-not-pass" },
    nodeVersion: "22.0.0",
    appRoot: path.resolve(path.dirname(new URL(import.meta.url).pathname), "../.."),
    deps: {
      fileExists: async file => file.endsWith("package.json") || file.endsWith("server.mjs"),
      readText: async () => "",
      existsSync: () => true,
      listenAvailable: async () => true,
      openBrowser: async (_command, url) => { opened.push(url); },
      spawnLlama: () => { throw new Error("llama-server should not start without a selected GGUF"); },
      spawnWeb: (_file, _args, options) => {
        assert.equal(options.env.HOST, "127.0.0.1");
        assert.equal(options.env.LLM_API_KEY, undefined);
        assert.equal(options.env.POCKET_MEMORY_DIR, path.join(home, ".pocket-ai-lab", "memory"));
        assert.equal(options.env.LLAMACPP_BASE_URL, "http://127.0.0.1:9");
        process.env.HOST = "127.0.0.1";
        process.env.POCKET_MEMORY_DIR = options.env.POCKET_MEMORY_DIR;
        process.env.LLAMACPP_BASE_URL = options.env.LLAMACPP_BASE_URL;
        delete process.env.POCKET_RATE_LIMIT_MEMORY;
        server = createServer();
        server.listen(Number(options.env.PORT), "127.0.0.1");
        return { pid: 999999, kill() { server.close(); }, stdout: null, stderr: null };
      }
    }
  });
  try {
    assert.equal(handle.status.authorized, false);
    assert.equal(handle.status.appListening, true);
    assert.equal(handle.status.modelReady, false);
    assert.match(handle.status.modelMessage, /does not download weights/);
    assert.equal(opened.length, 1);
    assert.match(opened[0], /^http:\/\/127\.0\.0\.1:46011\/$/);
    const saved = await fetch(opened[0] + "api/memory", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ content: "kept across launches", layer: "semantic" })
    });
    assert.equal(saved.status, 201);
    assert.equal((await saved.json()).entry.provenance.verified, false);
  } finally {
    await handle.stop();
    if (server) await new Promise(resolve => server.close(resolve));
  }

  process.env.POCKET_MEMORY_DIR = path.join(home, ".pocket-ai-lab", "memory");
  const again = createServer();
  await new Promise(resolve => again.listen(0, "127.0.0.1", resolve));
  try {
    const listed = await fetch("http://127.0.0.1:" + again.address().port + "/api/memory");
    assert.equal(listed.status, 200);
    assert.equal((await listed.json()).entries.length, 1);
  } finally {
    await new Promise(resolve => again.close(resolve));
    await rm(home, { recursive: true, force: true });
  }
});

test("missing dependencies block startup before a browser opens", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "pocket-missing-"));
  let opened = false;
  const handle = await launch({
    home,
    env: {},
    nodeVersion: "18.0.0",
    appRoot: null,
    deps: {
      fileExists: async () => false,
      readText: async () => "",
      openBrowser: async () => { opened = true; },
      spawnWeb: () => { throw new Error("server should not start"); }
    }
  });
  assert.equal(handle.status.appListening, false);
  assert.equal(handle.status.exitCode, 1);
  assert.equal(opened, false);
  assert.match(handle.status.problems.map(item => item.message).join(" "), /does not install Node/);
  await rm(home, { recursive: true, force: true });
});

test("the shell entrypoint reports a missing Node without installing it", async () => {
  const script = path.join(path.dirname(new URL(import.meta.url).pathname), "start-pocket-ai-lab.sh");
  const result = await run(script, { PATH: "/bin", HOME: tmpdir() });
  assert.equal(result.code, 1);
  assert.match(result.stderr + result.stdout, /does not install Node/);
});

test("the real launcher process serves loopback health and then exits", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "pocket-real-"));
  const child = spawn(process.execPath, ["scripts/desktop/launcher.mjs"], {
    cwd: path.resolve(path.dirname(new URL(import.meta.url).pathname), "../.."),
    env: {
      ...process.env,
      HOME: home,
      PORT: "46021",
      POCKET_GGUF_PATH: "",
      LLM_API_KEY: "desktop-launcher-secret"
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let output = "";
  child.stdout.on("data", chunk => { output += chunk; });
  child.stderr.on("data", chunk => { output += chunk; });
  const started = Date.now();
  while (!output.includes("listening at") && Date.now() - started < 20000) {
    if (child.exitCode !== null) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  try {
    assert.match(output, /listening at http:\/\/127\.0\.0\.1:46021\//);
    assert.match(output, /not ready/);
    assert.equal(output.includes("desktop-launcher-secret"), false);
    const health = await fetch("http://127.0.0.1:46021/api/health");
    const body = await health.json();
    assert.equal(health.status, 200);
    assert.equal(body.reachable, false);
    assert.equal(body.loopback, true);
    assert.equal(body.authorized, undefined);
  } finally {
    child.kill("SIGTERM");
    await new Promise(resolve => child.on("exit", resolve));
    await rm(home, { recursive: true, force: true });
  }
  assert.equal(await listenAvailable(46021), true);
});

test("headless mode starts the app and does not open a browser", async () => {
  const home = await mkdtemp(path.join(tmpdir(), "pocket-headless-"));
  let server;
  const handle = await launch({
    home,
    headless: true,
    env: { PORT: "46041" },
    nodeVersion: "22.0.0",
    appRoot: path.resolve(path.dirname(new URL(import.meta.url).pathname), "../.."),
    deps: {
      fileExists: async file => file.endsWith("package.json") || file.endsWith("server.mjs"),
      readText: async () => "",
      existsSync: () => true,
      listenAvailable: async () => true,
      openBrowser: async () => { throw new Error("browser should stay closed"); },
      spawnLlama: () => { throw new Error("llama-server should not start"); },
      spawnWeb: (_file, _args, options) => {
        process.env.HOST = "127.0.0.1";
        process.env.POCKET_MEMORY_DIR = options.env.POCKET_MEMORY_DIR;
        process.env.LLAMACPP_BASE_URL = options.env.LLAMACPP_BASE_URL;
        server = createServer();
        server.listen(Number(options.env.PORT), "127.0.0.1");
        return { pid: 999999, kill() { server.close(); }, stdout: null, stderr: null };
      }
    }
  });
  try {
    assert.equal(handle.status.appListening, true);
    assert.equal(handle.status.browserOpened, false);
    assert.equal(handle.status.authorized, false);
    assert.match(handle.status.browserError, /Headless mode/);
  } finally {
    await handle.stop();
    if (server) await new Promise(resolve => server.close(resolve));
    await rm(home, { recursive: true, force: true });
  }
});

test("the archive excludes weights and secrets and has a checksum", async () => {
  assert.equal(isForbiddenRelative("apps/web/.env"), true);
  assert.equal(isForbiddenRelative(".env"), true);
  assert.equal(isForbiddenRelative(".env.local"), true);
  assert.equal(isForbiddenRelative(".env.example"), false);
  assert.equal(isForbiddenRelative("models/demo.gguf"), true);
  assert.equal(isForbiddenRelative("models/" + EXPERIMENTAL_GGUF), true);
  assert.equal(isForbiddenRelative("node_modules/zod/index.js"), true);
  assert.equal(isForbiddenRelative("apps/web/index.html"), false);
  assert.equal(isForbiddenRelative("apps/web/test/server.test.mjs"), false);
  assert.equal(isForbiddenRelative("packages/intelligence/__tests__/example.test.ts"), false);
  const dest = await mkdtemp(path.join(tmpdir(), "pocket-archive-"));
  const built = await buildArchive({ destDir: dest });
  assert.ok(built.bytes > 1000);
  assert.ok(built.bytes < 25 * 1024 * 1024);
  assert.equal(built.manifest.weightsIncluded, false);
  assert.equal(built.manifest.experimentalCustomGgufIncluded, false);
  assert.equal(built.manifest.authorized, false);
  assert.equal(built.manifest.windowsTested, false);
  assert.equal(built.manifest.macTested, false);
  assert.equal(built.manifest.iphoneIncluded, false);
  const recorded = (await readFile(built.archivePath + ".sha256", "utf8")).slice(0, 64);
  assert.equal(recorded, built.sha256);
  const names = built.manifest.files.map(file => file.path);
  assert.equal(names.some(name => name.endsWith(".gguf")), false);
  assert.equal(names.filter(name => name.includes(".env")).every(name => name.endsWith(".env.example")), true);
  assert.ok(names.includes("apps/web/server.mjs"));
  assert.ok(names.includes("scripts/desktop/launcher.mjs"));
  assert.ok(names.includes("scripts/local-gguf/lib.mjs"));
  assert.ok(names.includes("tsconfig.json"));
  assert.equal(names.includes("launcher-lib.mjs"), false);
  assert.ok(names.some(name => name.startsWith("apps/web/test/") && name.endsWith(".test.mjs")));
  assert.ok(names.some(name => name.startsWith("packages/intelligence/__tests__/")));
  assert.match(built.manifest.sourceCommit, /^[0-9a-f]{40}$/);
  await rm(dest, { recursive: true, force: true });
});

function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function run(script, env) {
  return new Promise(resolve => {
    const child = spawn("sh", [script], { env: { ...env } });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", chunk => { stdout += chunk; });
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.on("exit", code => resolve({ code, stdout, stderr }));
  });
}
