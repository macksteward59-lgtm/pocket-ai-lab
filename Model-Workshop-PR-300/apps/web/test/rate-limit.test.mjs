import test from "node:test";
import assert from "node:assert/strict";
import { createServer as createHttpServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer, rateLimitConfig } from "../server.mjs";

const ENV_KEYS = ["LLM_BASE_URL", "LLM_MODEL", "LLM_API_KEY", "LLAMACPP_BASE_URL", "LLAMACPP_API", "LLAMACPP_MODEL_ALIAS", "POCKET_MEMORY_DIR", "HOST", "POCKET_RATE_LIMIT_CHAT", "POCKET_RATE_LIMIT_MEMORY", "POCKET_RATE_LIMIT_AGENT", "POCKET_RATE_LIMIT_WINDOW_MS"];

async function withServer(fn, env = {}) {
  const previous = {};
  for (const key of ENV_KEYS) {
    previous[key] = process.env[key];
    delete process.env[key];
  }
  Object.assign(process.env, env);
  const server = createServer();
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const url = "http://127.0.0.1:" + server.address().port;
  try {
    await fn(url);
  } finally {
    await new Promise(resolve => server.close(resolve));
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function assertLimited(response, body) {
  assert.equal(response.status, 429);
  assert.match(response.headers.get("content-type") || "", /application\/json/);
  assert.equal(Number(response.headers.get("retry-after")) >= 1, true);
  assert.deepEqual(Object.keys(body).sort(), ["authorized", "error"]);
  assert.equal(body.authorized, false);
  assert.equal(body.reply, undefined);
  assert.match(body.error, /No reply was invented/);
  assert.equal(JSON.stringify(body).includes('"authorized":true'), false);
}

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

test("in-process API rate limits fail closed", async (t) => {
  await t.test("invalid limit values keep the local defaults", () => {
    assert.deepEqual(rateLimitConfig({}), { windowMs: 60000, chat: 30, memory: 120, agent: 8 });
    assert.deepEqual(rateLimitConfig({
      POCKET_RATE_LIMIT_CHAT: "0",
      POCKET_RATE_LIMIT_MEMORY: "-5",
      POCKET_RATE_LIMIT_AGENT: "nope",
      POCKET_RATE_LIMIT_WINDOW_MS: "0"
    }), { windowMs: 60000, chat: 30, memory: 120, agent: 8 });
  });

  await t.test("chat under the limit returns provider text and the next request is 429", async () => {
    const original = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async (input, init) => {
      const target = String(input);
      if (target === "http://127.0.0.1:8080/v1/chat/completions") {
        calls += 1;
        return new Response(JSON.stringify({
          choices: [{ message: { content: JSON.stringify({ analysis: "real model reply", confidence: 0.4 }) } }]
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return original(input, init);
    };
    try {
      await withServer(async url => {
        for (const message of ["hello", "again"]) {
          const response = await fetch(url + "/api/chat", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ message })
          });
          const body = await response.json();
          assert.equal(response.status, 200);
          assert.equal(body.reply, "real model reply");
          assert.equal(body.authorized, false);
          assert.equal(body.provider, "llama.cpp");
        }
        assert.equal(calls, 2);
        const limited = await fetch(url + "/api/chat", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ message: "over the limit" })
        });
        const body = await limited.json();
        assertLimited(limited, body);
        assert.equal(JSON.stringify(body).includes("real model reply"), false);
        assert.equal(JSON.stringify(body).includes("over the limit"), false);
        assert.equal(calls, 2);
      }, { LLM_BASE_URL: "http://127.0.0.1:8080/v1", LLM_MODEL: "test-model", POCKET_RATE_LIMIT_CHAT: "2" });
    } finally {
      globalThis.fetch = original;
    }
  });

  await t.test("memory under the limit still saves and the next write is 429", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "pocket-ai-rate-"));
    try {
      await withServer(async url => {
        const saved = await fetch(url + "/api/memory", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ content: "Keep this local note.", layer: "semantic", source: "User note" })
        });
        assert.equal(saved.status, 201);
        const created = (await saved.json()).entry;
        assert.equal(created.content, "Keep this local note.");
        assert.equal(created.provenance.verified, false);

        const listed = await fetch(url + "/api/memory");
        assert.equal(listed.status, 200);
        assert.equal((await listed.json()).entries.length, 1);

        const limited = await fetch(url + "/api/memory", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ content: "This write must not be stored.", layer: "semantic" })
        });
        const body = await limited.json();
        assertLimited(limited, body);
        assert.equal(JSON.stringify(body).includes("This write must not be stored."), false);

        const { FileMemoryStore } = await import("../../../packages/intelligence/memory/FileMemoryStore.ts");
        const reopened = await FileMemoryStore.open(directory);
        const persisted = await reopened.load();
        assert.equal(persisted.length, 1);
        assert.equal(persisted[0].content, "Keep this local note.");
        assert.equal(persisted[0].provenance.verified, false);
        await reopened.close();
      }, { HOST: "127.0.0.1", POCKET_MEMORY_DIR: directory, POCKET_RATE_LIMIT_MEMORY: "2" });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  await t.test("agent task under the limit streams an unauthorized result and the next request is 429", async () => {
    let completions = 0;
    const llama = createHttpServer(async (req, res) => {
      if (req.url === "/health") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ status: "ok" }));
        return;
      }
      completions += 1;
      let raw = "";
      for await (const chunk of req) raw += chunk;
      const prompt = JSON.parse(raw).prompt;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ content: JSON.stringify(contentFor(prompt)) }));
    });
    await new Promise(resolve => llama.listen(0, "127.0.0.1", resolve));
    const llamaPort = llama.address().port;
    try {
      await withServer(async url => {
        const response = await fetch(url + "/api/agent-tasks", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ objective: "Show how the team protects the authorization boundary." })
        });
        assert.equal(response.status, 200);
        assert.match(response.headers.get("content-type") || "", /text\/event-stream/);
        const stream = await response.text();
        assert.match(stream, /Agents proposed a result; nothing was authorized/);
        assert.match(stream, /"authorized":false/);
        assert.equal(stream.includes('"authorized":true'), false);
        const used = completions;
        assert.equal(used > 0, true);

        const limited = await fetch(url + "/api/agent-tasks", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ objective: "Do not run this deliberation." })
        });
        const body = await limited.json();
        assertLimited(limited, body);
        assert.equal(response.headers.get("content-type").includes("text/event-stream"), true);
        assert.equal((limited.headers.get("content-type") || "").includes("text/event-stream"), false);
        assert.equal(JSON.stringify(body).includes("Agents proposed a result"), false);
        assert.equal(JSON.stringify(body).includes("Do not run this deliberation."), false);
        assert.equal(completions, used);
      }, {
        LLAMACPP_BASE_URL: "http://127.0.0.1:" + llamaPort,
        LLAMACPP_API: "completion",
        POCKET_RATE_LIMIT_AGENT: "1"
      });
    } finally {
      await new Promise(resolve => llama.close(resolve));
    }
  });
});
