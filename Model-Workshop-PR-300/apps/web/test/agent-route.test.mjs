import test from "node:test";
import assert from "node:assert/strict";
import { createServer as createHttpServer } from "node:http";
import { createServer as createAppServer } from "../server.mjs";

function contentFor(prompt) {
  const stage = /Stage: ([^\n]+)/.exec(prompt)?.[1] ?? "";
  const ids = [...prompt.matchAll(/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi)].map(match => match[0]);
  if (stage === "independent") return { analysis: "Separate the proposal from permission.", confidence: 0.4 };
  if (stage === "cross-review") return { question: "Who independently authorizes this?" };
  if (stage === "challenge") return { claim: "The proposal is sound", objection: "No independent receipt exists", evidenceRefs: [] };
  if (stage === "revision") return { revision: "Keep authorization independent.", addressesMessageIds: ids };
  if (stage === "verification") return { claim: "Not authorized", verified: false, reason: "No APEX receipt" };
  if (stage === "synthesis") return { synthesis: "Agents proposed a result; nothing was authorized.", evidenceRefs: [] };
  throw new Error("Unexpected stage: " + stage);
}

async function listen(server) {
  await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  return server.address().port;
}

test("web Agent Team endpoint runs real local multi-agent stages and streams the untrusted result", async () => {
  const oldBase = process.env.LLAMACPP_BASE_URL;
  const oldApi = process.env.LLAMACPP_API;
  const llama = createHttpServer(async (req, res) => {
    if (req.url === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
      return;
    }
    let raw = "";
    for await (const chunk of req) raw += chunk;
    const prompt = JSON.parse(raw).prompt;
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ content: JSON.stringify(contentFor(prompt)) }));
  });
  const llamaPort = await listen(llama);
  process.env.LLAMACPP_BASE_URL = "http://127.0.0.1:" + llamaPort;
  process.env.LLAMACPP_API = "completion";
  const app = createAppServer();
  const appPort = await listen(app);
  try {
    const base = "http://127.0.0.1:" + appPort;
    const health = await fetch(base + "/api/agent-health");
    assert.equal(health.status, 200);
    assert.equal((await health.json()).ready, true);
    const response = await fetch(base + "/api/agent-tasks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ objective: "Show how the team protects the authorization boundary." })
    });
    assert.equal(response.status, 200);
    const stream = await response.text();
    assert.match(stream, /independent/);
    assert.match(stream, /cross-review/);
    assert.match(stream, /challenge/);
    assert.match(stream, /verification/);
    assert.match(stream, /Agents proposed a result; nothing was authorized/);
    assert.match(stream, /"authorized":false/);
    assert.match(stream, /"memoryVerified":false/);
  } finally {
    await new Promise(resolve => app.close(resolve));
    await new Promise(resolve => llama.close(resolve));
    if (oldBase === undefined) delete process.env.LLAMACPP_BASE_URL; else process.env.LLAMACPP_BASE_URL = oldBase;
    if (oldApi === undefined) delete process.env.LLAMACPP_API; else process.env.LLAMACPP_API = oldApi;
  }
});
