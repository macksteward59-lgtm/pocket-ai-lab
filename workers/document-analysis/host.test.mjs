import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { handoffTransport } from "../../tools/source-handoff/cli.mjs";
import { makeBundle, publishBundle, readPublishedRegister } from "../../tools/source-handoff/register.mjs";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

test("MCP protects lifecycle status and persists revision-checked handoff notes across restarts", async t => {
  const directory = await mkdtemp(join(tmpdir(), "pocket-cloud-status-"));
  const key = randomBytes(32).toString("hex");
  const editorKey = randomBytes(32).toString("hex");
  const attemptID = randomUUID();
  const url = new URL("https://fixture.invalid/mcp");
  let runtime;
  t.after(async () => {
    await runtime?.dispose();
    await rm(directory, { recursive: true, force: true });
  });

  const open = (script, bindings = {}) => new Miniflare({
    modules: true, script, compatibilityDate: "2026-06-01", compatibilityFlags: ["nodejs_compat"],
    durableObjects: { ANALYSIS_STATE: { className: "DocumentAnalysisState", useSQLite: true } },
    durableObjectsPersist: directory, bindings
  });
  const fixture = await build({
    entryPoints: ["test/seed-worker.js"], bundle: true, write: false,
    format: "esm", platform: "neutral", external: ["cloudflare:*", "node:*"]
  });
  runtime = open(fixture.outputFiles[0].text);
  assert.equal((await runtime.dispatchFetch(url, { method: "POST", body: attemptID })).status, 204);
  await runtime.dispose();

  const production = await readFile("dist/worker.js", "utf8");
  runtime = open(production);
  assert.equal((await runtime.dispatchFetch(url)).status, 503);
  await runtime.dispose();
  runtime = open(production, { MCP_READ_KEY: key, MCP_NOTE_WRITE_KEY: editorKey });
  assert.equal((await runtime.dispatchFetch(url)).status, 401);
  assert.equal((await runtime.dispatchFetch(url, { headers: { Authorization: "Bearer wrong" } })).status, 401);
  const headers = { Authorization: "Bearer " + key, "Content-Type": "application/json" };
  assert.equal((await runtime.dispatchFetch(url, { headers: { ...headers, Origin: "https://elsewhere.invalid" } })).status, 403);
  assert.equal((await runtime.dispatchFetch(url, { method: "POST", headers, body: "x".repeat(17000) })).status, 413);

  async function connect(secret) {
    const client = new Client({ name: "integration-test", version: "1.0.0" });
    await client.connect(new StreamableHTTPClientTransport(url, {
      requestInit: { headers: { Authorization: "Bearer " + secret } },
      fetch: (input, init) => runtime.dispatchFetch(input.toString(), init)
    }));
    return client;
  }
  const client = await connect(key);
  try {
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map(tool => tool.name), ["document_analysis_status"]);
    const denied = await client.callTool({
      name: "document_handoff_save", arguments: { attemptID, expectedRevision: 0, text: "unauthorized" }
    });
    assert.equal(denied.isError, true);
    const lookup = id => client.callTool({ name: tools[0].name, arguments: { attemptID: id } });
    const found = await lookup(attemptID.toUpperCase());
    assert.deepEqual(found.structuredContent, {
      attemptID, found: true, status: "completed",
      updatedAt: new Date(found.structuredContent.updatedAt).toISOString(), uncertain: false
    });
    assert.deepEqual(JSON.parse(found.content[0].text), found.structuredContent);
    assert.deepEqual((await lookup(randomUUID())).structuredContent, { found: false });
    assert.equal((await lookup("invalid")).isError, true);
  } finally {
    await client.close();
  }

  const noteID = randomUUID();
  let editor = await connect(editorKey);
  const call = (name, args) => editor.callTool({ name, arguments: { attemptID: noteID, ...args } });
  const read = () => call("document_handoff_read", {});
  const save = (expectedRevision, text) => call("document_handoff_save", { expectedRevision, text });
  let saved;
  try {
    assert.deepEqual((await editor.listTools()).tools.map(t => t.name).sort(),
      ["document_analysis_status", "document_handoff_read", "document_handoff_save"]);
    assert.equal((await read()).structuredContent.revision, 0);
    const note = "Ready for review.";
    assert.equal((await save(0, note)).structuredContent.revision, 1);
    assert.equal((await save(0, note)).structuredContent.revision, 1);
    const race = await Promise.all([save(1, "First edit"), save(1, "Second edit")]);
    const [ok] = race.filter(result => !result.isError);
    const [conflict] = race.filter(result => result.isError);
    assert.equal(ok.structuredContent.revision, 2);
    assert.deepEqual(conflict.structuredContent, { error: "revision_conflict", currentRevision: 2 });
    saved = ok.structuredContent;
    assert.deepEqual((await read()).structuredContent, saved);
    assert.equal((await save(2, "😀".repeat(1001))).isError, true);
    assert.equal((await save(2, "   ")).isError, true);
    assert.deepEqual((await call("document_analysis_status", {})).structuredContent, { found: false });
    assert.deepEqual((await call("document_handoff_read", { attemptID: noteID.toUpperCase() })).structuredContent, saved);
    if (process.env.POCKET_CI_REVIEW_DIR) {
      const outputDir = process.env.POCKET_CI_REVIEW_DIR;
      const [chromium, webkit] = await Promise.all(["chromium", "webkit"].map(browser =>
        readFile(join(outputDir, browser + ".txt"), "utf8")));
      assert.equal(chromium, webkit);
      assert.match(chromium, /Independent local validation passed 359 tests in 11 files/);
      assert.match(chromium, /Native evaluation review/);
      const revision = saved.revision;
      const handoff = await save(revision, chromium);
      assert.ok(!handoff.isError);
      assert.equal(handoff.structuredContent.revision, revision + 1);
      assert.equal(handoff.structuredContent.text, chromium);
      saved = handoff.structuredContent;
      assert.deepEqual((await save(revision, chromium)).structuredContent, saved);
    }
  } finally { await editor.close(); }
  const register = makeBundle();
  const notes = handoffTransport(editorKey, (input, init) => runtime.dispatchFetch(input, init));
  assert.equal((await publishBundle(register, notes)).created, register.records.length + 1);
  await runtime.dispose();
  runtime = open(production, { MCP_READ_KEY: key, MCP_NOTE_WRITE_KEY: editorKey });
  editor = await connect(editorKey);
  try { assert.deepEqual((await read()).structuredContent, saved); }
  finally { await editor.close(); }
  assert.equal((await publishBundle(register, notes)).created, 0);
  const reopened = await readPublishedRegister(register, notes.read);
  const canonical = JSON.parse(await readFile(new URL("../../docs/research/project-sources.json", import.meta.url)));
  assert.deepEqual(reopened, canonical);
  await runtime.dispose();
  runtime = open(production, { MCP_READ_KEY: key, MCP_NOTE_WRITE_KEY: key });
  const sameKey = await connect(key);
  try { assert.deepEqual((await sameKey.listTools()).tools.map(t => t.name), ["document_analysis_status"]); }
  finally { await sameKey.close(); }
});
