import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { build } from "esbuild";
import { Miniflare } from "miniflare";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

test("private status MCP reads committed lifecycle data after a workerd restart", async t => {
  const directory = await mkdtemp(join(tmpdir(), "pocket-cloud-status-"));
  const key = randomBytes(32).toString("hex");
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
  runtime = open(production, { MCP_READ_KEY: key });
  assert.equal((await runtime.dispatchFetch(url)).status, 401);
  assert.equal((await runtime.dispatchFetch(url, { headers: { Authorization: "Bearer wrong" } })).status, 401);
  const headers = { Authorization: "Bearer " + key, "Content-Type": "application/json" };
  assert.equal((await runtime.dispatchFetch(url, { headers: { ...headers, Origin: "https://elsewhere.invalid" } })).status, 403);
  assert.equal((await runtime.dispatchFetch(url, { method: "POST", headers, body: "x".repeat(17000) })).status, 413);

  const client = new Client({ name: "integration-test", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(url, {
    requestInit: { headers }, fetch: (input, init) => runtime.dispatchFetch(input.toString(), init)
  });
  try {
    await client.connect(transport);
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map(tool => tool.name), ["document_analysis_status"]);
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
});
