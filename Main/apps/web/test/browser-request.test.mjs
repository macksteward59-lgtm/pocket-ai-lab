import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtemp, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer } from "../server.mjs";

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
  const port = server.address().port;
  const url = "http://127.0.0.1:" + port;
  try {
    await fn(url, port);
  } finally {
    await new Promise(resolve => server.close(resolve));
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

function rawRequest({ port, method = "GET", path: requestPath = "/", headers = {}, body = "" }) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: "127.0.0.1",
      port,
      method,
      path: requestPath,
      headers
    }, response => {
      const chunks = [];
      response.on("data", chunk => chunks.push(chunk));
      response.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        let json = null;
        try { json = JSON.parse(raw); } catch { json = null; }
        resolve({ status: response.statusCode, headers: response.headers, raw, json });
      });
    });
    req.on("error", reject);
    req.end(body);
  });
}

function assertRefusal(response) {
  assert.equal(response.json.authorized, false);
  assert.equal(response.json.reply, undefined);
  assert.equal(response.json.entry, undefined);
  assert.equal(response.json.entries, undefined);
  assert.match(response.json.error, /No reply was invented/);
  assert.equal(JSON.stringify(response.json).includes('"authorized":true'), false);
  assert.equal((response.headers["content-type"] || "").includes("text/event-stream"), false);
}

test("loopback browser and CLI requests are guarded", async (t) => {
  await t.test("a same-origin browser chat succeeds and a foreign origin does not call the model", async () => {
    const original = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async (input, init) => {
      if (String(input) === "http://127.0.0.1:8080/v1/chat/completions") {
        calls += 1;
        return new Response(JSON.stringify({
          choices: [{ message: { content: JSON.stringify({ analysis: "real model reply", confidence: 0.4 }) } }]
        }), { status: 200, headers: { "content-type": "application/json" } });
      }
      return original(input, init);
    };
    try {
      await withServer(async (url, port) => {
        const origin = "http://127.0.0.1:" + port;
        const allowed = await fetch(url + "/api/chat", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin,
            "sec-fetch-site": "same-origin"
          },
          body: JSON.stringify({ message: "hello from the page" })
        });
        const allowedBody = await allowed.json();
        assert.equal(allowed.status, 200);
        assert.equal(allowedBody.reply, "real model reply");
        assert.equal(allowedBody.authorized, false);
        assert.equal(calls, 1);

        const denied = await fetch(url + "/api/chat", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: "https://attacker.example",
            "sec-fetch-site": "cross-site"
          },
          body: JSON.stringify({ message: "do not answer this" })
        });
        const deniedBody = await denied.json();
        assert.equal(denied.status, 403);
        assertRefusal({ status: denied.status, headers: Object.fromEntries(denied.headers), json: deniedBody });
        assert.equal(JSON.stringify(deniedBody).includes("do not answer this"), false);
        assert.equal(JSON.stringify(deniedBody).includes("real model reply"), false);
        assert.equal(calls, 1);

        const plain = await fetch(url + "/api/chat", {
          method: "POST",
          headers: { "content-type": "text/plain" },
          body: JSON.stringify({ message: "plain text must not run" })
        });
        const plainBody = await plain.json();
        assert.equal(plain.status, 415);
        assertRefusal({ status: plain.status, headers: Object.fromEntries(plain.headers), json: plainBody });
        assert.equal(calls, 1);
      }, { LLM_BASE_URL: "http://127.0.0.1:8080/v1", LLM_MODEL: "test-model" });
    } finally {
      globalThis.fetch = original;
    }
  });

  await t.test("a loopback CLI request and a localhost browser host still reach health", async () => {
    await withServer(async (url, port) => {
      const cli = await fetch(url + "/api/health");
      assert.equal(cli.status, 200);
      const cliBody = await cli.json();
      assert.equal(cliBody.provider, "llama.cpp");
      assert.equal(cliBody.authorized, undefined);

      const browser = await rawRequest({
        port,
        path: "/api/health",
        headers: {
          host: "localhost:" + port,
          origin: "http://localhost:" + port,
          "sec-fetch-site": "same-origin"
        }
      });
      assert.equal(browser.status, 200);
      assert.equal(browser.json.provider, "llama.cpp");
      assert.equal(browser.json.loopback, true);
    });
  });

  await t.test("a foreign host, mismatched origin, or same-site fetch is refused before the model", async () => {
    const original = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async (input, init) => {
      if (String(input).startsWith("http://127.0.0.1:9")) calls += 1;
      return original(input, init);
    };
    try {
      await withServer(async (url, port) => {
        const foreignHost = await rawRequest({
          port,
          method: "POST",
          path: "/api/chat",
          headers: {
            host: "evil.example",
            "content-type": "application/json",
            "content-length": Buffer.byteLength(JSON.stringify({ message: "rebinding" }))
          },
          body: JSON.stringify({ message: "rebinding" })
        });
        assert.equal(foreignHost.status, 403);
        assertRefusal(foreignHost);
        assert.match(foreignHost.json.error, /loopback-only/);

        const mismatched = await rawRequest({
          port,
          method: "POST",
          path: "/api/agent-tasks",
          headers: {
            host: "127.0.0.1:" + port,
            origin: "http://127.0.0.1:9",
            "content-type": "application/json",
            "sec-fetch-site": "same-site"
          },
          body: JSON.stringify({ objective: "do not deliberate" })
        });
        assert.equal(mismatched.status, 403);
        assertRefusal(mismatched);
        assert.equal(JSON.stringify(mismatched.json).includes("do not deliberate"), false);

        const health = await fetch(url + "/api/agent-health", { headers: { "sec-fetch-site": "cross-site" } });
        assert.equal(health.status, 403);
        assert.equal((await health.json()).authorized, false);
        assert.equal(calls, 0);
      }, { LLAMACPP_BASE_URL: "http://127.0.0.1:9" });
    } finally {
      globalThis.fetch = original;
    }
  });

  await t.test("a cross-site memory write is not stored", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "pocket-ai-browser-"));
    try {
      await withServer(async url => {
        const denied = await fetch(url + "/api/memory", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: "https://attacker.example",
            "sec-fetch-site": "cross-site"
          },
          body: JSON.stringify({ content: "must not be stored", layer: "semantic" })
        });
        const body = await denied.json();
        assert.equal(denied.status, 403);
        assert.equal(body.authorized, false);
        assert.equal(JSON.stringify(body).includes("must not be stored"), false);
        await assert.rejects(access(path.join(directory, "memory.json")));

        const saved = await fetch(url + "/api/memory", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ content: "explicit local note", layer: "semantic" })
        });
        assert.equal(saved.status, 201);
        const created = (await saved.json()).entry;
        assert.equal(created.content, "explicit local note");
        assert.equal(created.provenance.verified, false);

        const listed = await fetch(url + "/api/memory");
        assert.equal(listed.status, 200);
        assert.equal((await listed.json()).entries.length, 1);
      }, { HOST: "127.0.0.1", POCKET_MEMORY_DIR: directory });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
