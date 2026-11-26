import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  allowedDownloadHost,
  assertPin,
  formatLlamaServerCommand,
  isLoopbackHost,
  llamaServerArgv,
  loadPin,
  repoRoot,
  resolveModelDir,
  sha256File,
  acceptAnalysisText,
  loadNamedPin,
  smokeRecord
} from "./lib.mjs";

test("the smoke pin is a pinned public Apache-2.0 GGUF", async () => {
  const pin = await loadPin();
  assert.equal(pin.filename, "SmolLM2-135M-Instruct-Q4_K_M.gguf");
  assert.equal(pin.revision, "09816acd5d99df7be770d85ea30822623dab342c");
  assert.equal(pin.sha256, "2e8040ceae7815abe0dcb3540b9995eaa1fa0d2ca9e797d0a635ae4433c68c2d");
  assert.equal(pin.bytes, 105454432);
  assert.equal(pin.license, "apache-2.0");
  assert.equal(pin.repo, "bartowski/SmolLM2-135M-Instruct-GGUF");
  assert.match(pin.purpose, /not hardware acceptance/i);
});

test("a pin that leaves Hugging Face or drops the revision is rejected", () => {
  const pin = {
    id: "x",
    filename: "model.gguf",
    repo: "example/model",
    revision: "0123456789abcdef0123456789abcdef01234567",
    sourceUrl: "https://example.com/model.gguf",
    sha256: "a".repeat(64),
    bytes: 1,
    license: "apache-2.0",
    baseModel: "example/base",
    purpose: "test"
  };
  assert.throws(() => assertPin(pin), /huggingface\.co/);
  pin.sourceUrl = "https://huggingface.co/example/model/resolve/other/" + pin.filename;
  assert.throws(() => assertPin(pin), /revision/);
});

test("checksum verification detects a changed file and respects byte/abort bounds", async t => {
  const directory = await mkdtemp(path.join(tmpdir(), "gguf-pin-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, "sample.bin");
  await writeFile(file, "smoke");
  const first = await sha256File(file);
  assert.match(first, /^[a-f0-9]{64}$/);
  await writeFile(file, "smokf");
  assert.notEqual(await sha256File(file), first);
  await assert.rejects(sha256File(file, { maxBytes: 4 }), /exceeds the pinned size/);
  await assert.rejects(sha256File(file, { signal: AbortSignal.abort() }), /abort/i);
});

test("pin URL must bind the exact repo, revision and filename without credentials or suffixes", async () => {
  const pin = await loadPin();
  const invalidSources = [
    pin.sourceUrl.replace(pin.repo, "different/repo"),
    pin.sourceUrl.replace("/resolve/", "/blob/"),
    pin.sourceUrl + "?download=true",
    pin.sourceUrl + "#fragment",
    pin.sourceUrl.replace("https://", "http://"),
    pin.sourceUrl.replace("https://", "https://user:password@"),
    pin.sourceUrl.replace("huggingface.co/", "huggingface.co:8443/")
  ];
  for (const sourceUrl of invalidSources) assert.throws(() => assertPin({ ...pin, sourceUrl }));
  for (const repo of ["../model", "owner/../model", "owner/model/extra", "owner/model?query"]) {
    assert.throws(() => assertPin({ ...pin, repo }), /repo/);
  }
  for (const filename of ["../model.gguf", "model.gguf?query", "model.gguf#fragment", "model%2f.gguf"]) {
    assert.throws(() => assertPin({ ...pin, filename }), /filename/);
  }
  assert.throws(() => assertPin({ ...pin, bytes: Number.MAX_SAFE_INTEGER + 1 }), /safe integer/);
});

test("only the reviewed Apache-2.0 and MIT license identifiers are admitted", async () => {
  const pin = await loadPin();
  for (const license of ["apache-2.0", "mit"]) assert.equal(assertPin({ ...pin, license }).license, license);
  for (const license of ["unknown", "MIT", "cc-by-nc-4.0"]) {
    assert.throws(() => assertPin({ ...pin, license }), /license changed; review/);
  }
});

test("Hugging Face content delivery redirects stay on Hugging Face hosts", () => {
  assert.equal(allowedDownloadHost("huggingface.co"), true);
  assert.equal(allowedDownloadHost("cdn-lfs.huggingface.co"), true);
  assert.equal(allowedDownloadHost("us.aws.cdn.hf.co"), true);
  assert.equal(allowedDownloadHost("cas-bridge.xethub.hf.co"), true);
  assert.equal(allowedDownloadHost("example.com"), false);
  assert.equal(allowedDownloadHost("hf.co.example.com"), false);
});

test("llama-server stays on loopback unless remote use is explicit", () => {
  const argv = llamaServerArgv({ modelPath: "/models/smoke.gguf" });
  assert.deepEqual(argv, [
    "llama-server", "-m", "/models/smoke.gguf", "--host", "127.0.0.1", "--port", "8080", "-c", "8192"
  ]);
  assert.equal(isLoopbackHost("::1"), true);
  assert.throws(() => llamaServerArgv({ modelPath: "m.gguf", host: "0.0.0.0" }), /loopback/);
  const remote = llamaServerArgv({ modelPath: "m.gguf", host: "10.0.0.8", allowRemote: true });
  assert.equal(remote[4], "10.0.0.8");
  assert.match(formatLlamaServerCommand(["llama-server", "-m", "my model.gguf"]), /'my model\.gguf'/);
});

test("the default weight directory is outside the scripts folder and a smoke record cannot authorize", () => {
  assert.equal(resolveModelDir({}), path.join(repoRoot, "models"));
  assert.equal(resolveModelDir({ POCKET_GGUF_DIR: "/var/tmp/weights" }), "/var/tmp/weights");
  const record = smokeRecord({ ok: true });
  assert.equal(record.authorized, false);
  assert.equal(record.hardwareAcceptance, false);
  assert.equal(record.apexReceipt, false);
});

test("analysis text fails closed unless it matches the stage schema", () => {
  expectOk(acceptAnalysisText('{"analysis":"Separate proposal from permission."}'));
  assert.equal(acceptAnalysisText('{"analysis":"ok","authorized":true}').ok, false);
  assert.equal(acceptAnalysisText('{"analysis":""}').ok, false);
  assert.equal(acceptAnalysisText("not json").ok, false);
  assert.equal(acceptAnalysisText('{"analysis":"ok"}').authorized, false);
});

test("the Qwen pin matches the checksum recorded for the base smoke model", async () => {
  const pin = await loadNamedPin("qwen2.5-0.5b-instruct-q4_k_m");
  assert.equal(pin.revision, "9217f5db79a29953eb74d5343926648285ec7e67");
  assert.equal(pin.sha256, "74a4da8c9fdbcd15bd1f6d01d621410d31c6fc00986f5eb687824e7b93d7a9db");
  assert.equal(pin.bytes, 491400032);
  assert.equal(pin.license, "apache-2.0");
  assert.match(pin.purpose, /not a custom fine-tune/i);
});

function expectOk(result) {
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.authorized, false);
}

test("package consumers do not gain a torch dependency", async () => {
  const pkg = JSON.parse(await readFile(path.join(repoRoot, "package.json"), "utf8"));
  const names = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
  assert.equal(names.includes("torch"), false);
});
