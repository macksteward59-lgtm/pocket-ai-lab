import test from "node:test";
import assert from "node:assert/strict";
import { createServer as createHttpServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { assertLoopbackHost, createServer } from "../server.mjs";

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

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve(server.address().port));
  });
}

test("health reports the default loopback provider without claiming a secret", async () => withServer(async url => {
  const response = await fetch(url + "/api/health");
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.configured, false);
  assert.equal(body.loopback, true);
  assert.equal(body.provider, "llama.cpp");
  assert.equal(typeof body.reachable, "boolean");
  assert.equal(JSON.stringify(body).includes("server-secret"), false);
}));

test("health is unreachable when the configured llama-server port is closed", async () => withServer(async url => {
  const response = await fetch(url + "/api/health");
  const body = await response.json();
  assert.equal(body.reachable, false);
  assert.equal(body.configured, true);
  assert.equal(body.loopback, true);
  assert.equal(body.baseUrl, "http://127.0.0.1:9");
}, { LLAMACPP_BASE_URL: "http://127.0.0.1:9" }));

test("health does not call a non-loopback endpoint private", async () => withServer(async url => {
  const response = await fetch(url + "/api/health");
  const body = await response.json();
  assert.equal(body.loopback, false);
  assert.equal(body.reachable, false);
  assert.equal(body.configured, true);
}, { LLAMACPP_BASE_URL: "http://example.invalid:9" }));

test("health reports ready only after llama-server answers /health", async () => {
  const llama = createHttpServer((req, res) => {
    if (req.url === "/health") {
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ status: "ok" }));
      return;
    }
    res.writeHead(404);
    res.end();
  });
  const llamaPort = await listen(llama);
  try {
    await withServer(async url => {
      const response = await fetch(url + "/api/health");
      const body = await response.json();
      assert.equal(body.reachable, true);
      assert.equal(body.loopback, true);
      assert.equal(body.model, "test-model");
    }, { LLAMACPP_BASE_URL: "http://127.0.0.1:" + llamaPort, LLM_MODEL: "test-model" });
  } finally {
    await new Promise(resolve => llama.close(resolve));
  }
});

test("chat rejects empty messages", async () => withServer(async url => {
  const response = await fetch(url + "/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message: " " })
  });
  assert.equal(response.status, 400);
}));

test("chat fails closed when llama-server is down", async () => withServer(async url => {
  const response = await fetch(url + "/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message: "hello" })
  });
  const body = await response.json();
  assert.equal(response.status, 503);
  assert.equal(body.reply, undefined);
  assert.match(body.error, /No reply was invented/);
}, { LLAMACPP_BASE_URL: "http://127.0.0.1:9" }));

test("static app shell is served", async () => withServer(async url => {
  const response = await fetch(url + "/");
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Pocket AI Lab/);
  assert.equal(html.includes("\\n"), false);
  assert.equal(html.includes('id="endpoint"'), false);
  assert.equal(html.includes('id="model"'), false);
}));

test("chat uses the llama.cpp provider and does not send an API key", async () => withServer(async url => {
  const original = globalThis.fetch;
  let captured;
  globalThis.fetch = async (input, init) => {
    const target = String(input);
    if (target === "http://127.0.0.1:8080/v1/chat/completions") {
      captured = { url: target, headers: init.headers, body: JSON.parse(init.body) };
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({ analysis: "real model reply", confidence: 0.4 }) } }]
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    return original(input, init);
  };
  try {
    const response = await fetch(url + "/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "hello" })
    });
    const data = await response.json();
    assert.equal(response.status, 200);
    assert.equal(data.reply, "real model reply");
    assert.equal(data.provider, "llama.cpp");
    assert.equal(data.authorized, false);
    assert.equal(data.model, "test-model");
    assert.equal(captured.url, "http://127.0.0.1:8080/v1/chat/completions");
    assert.equal(captured.headers.authorization, undefined);
    assert.equal(captured.body.model, "test-model");
    assert.match(captured.body.messages[0].content, /hello/);
    assert.equal(JSON.stringify(data).includes("server-secret"), false);
  } finally {
    globalThis.fetch = original;
  }
}, { LLM_BASE_URL: "http://127.0.0.1:8080/v1", LLM_MODEL: "test-model", LLM_API_KEY: "server-secret" }));

test("chat rejects a non-2xx llama response instead of displaying it", async () => withServer(async url => {
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    if (String(input) === "http://127.0.0.1:9/completion") {
      return new Response("this is not a reply", { status: 500, headers: { "content-type": "text/plain" } });
    }
    return original(input, init);
  };
  try {
    const response = await fetch(url + "/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "hello" })
    });
    const data = await response.json();
    assert.equal(response.status, 502);
    assert.equal(data.reply, undefined);
    assert.equal(JSON.stringify(data).includes("this is not a reply"), false);
  } finally {
    globalThis.fetch = original;
  }
}, { LLAMACPP_BASE_URL: "http://127.0.0.1:9", LLAMACPP_API: "completion" }));


test("memory API is unavailable when the app is configured for a network host", async () => withServer(async url => {
  const response = await fetch(url + "/api/memory");
  assert.equal(response.status, 403);
  assert.match((await response.json()).error, /loopback-only/);
}, { HOST: "0.0.0.0" }));

test("memory API explicitly saves, lists, persists, and deletes unverified user entries", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "pocket-ai-memory-"));
  try {
    await withServer(async url => {
      const saved = await fetch(url + "/api/memory", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          content: "Prefer concise project plans with measurable milestones.",
          layer: "semantic",
          source: "User note"
        })
      });
      assert.equal(saved.status, 201);
      const created = (await saved.json()).entry;
      assert.match(created.id, /^mem-[0-9a-f-]{36}$/i);
      assert.equal(created.provenance.agentId, "user");
      assert.equal(created.provenance.verified, false);
      assert.deepEqual(created.provenance.sourceRefs, ["User note"]);

      const listed = await fetch(url + "/api/memory");
      assert.equal(listed.status, 200);
      assert.equal((await listed.json()).entries.length, 1);

      const { FileMemoryStore } = await import("../../../packages/intelligence/memory/FileMemoryStore.ts");
      const reopened = await FileMemoryStore.open(directory);
      const persisted = await reopened.load();
      assert.equal(persisted.length, 1);
      assert.equal(persisted[0].content, created.content);
      assert.equal(persisted[0].provenance.verified, false);

      const deleted = await fetch(url + "/api/memory/" + encodeURIComponent(created.id), { method: "DELETE" });
      assert.equal(deleted.status, 200);
      assert.equal((await deleted.json()).deleted, true);
      const afterDelete = await reopened.load();
      assert.equal(afterDelete.length, 0);
      await reopened.close();

      const missing = await fetch(url + "/api/memory/" + encodeURIComponent(created.id), { method: "DELETE" });
      assert.equal(missing.status, 404);
    }, { HOST: "127.0.0.1", POCKET_MEMORY_DIR: directory });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("memory API edits entries explicitly and persists the revised unverified record", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "pocket-ai-memory-edit-"));
  try {
    await withServer(async url => {
      const createdResponse = await fetch(url + "/api/memory", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: "Original note", layer: "episodic", source: "Initial source" })
      });
      assert.equal(createdResponse.status, 201);
      const created = (await createdResponse.json()).entry;

      const updatedResponse = await fetch(url + "/api/memory/" + encodeURIComponent(created.id), {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: "Revised note", source: "Updated source" })
      });
      assert.equal(updatedResponse.status, 200);
      const updated = (await updatedResponse.json()).entry;
      assert.equal(updated.id, created.id);
      assert.equal(updated.createdAt, created.createdAt);
      assert.equal(updated.layer, "episodic");
      assert.equal(updated.content, "Revised note");
      assert.deepEqual(updated.provenance.sourceRefs, ["Updated source"]);
      assert.equal(updated.provenance.verified, false);

      const { FileMemoryStore } = await import("../../../packages/intelligence/memory/FileMemoryStore.ts");
      const reopened = await FileMemoryStore.open(directory);
      const persisted = await reopened.load();
      assert.equal(persisted.length, 1);
      assert.equal(persisted[0].content, "Revised note");
      assert.equal(persisted[0].provenance.verified, false);
      await reopened.close();

      const missing = await fetch(url + "/api/memory/mem-00000000-0000-0000-0000-000000000000", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: "missing" })
      });
      assert.equal(missing.status, 404);

      const invalidType = await fetch(url + "/api/memory/" + encodeURIComponent(created.id), {
        method: "PUT",
        headers: { "content-type": "text/plain" },
        body: JSON.stringify({ content: "not accepted" })
      });
      assert.equal(invalidType.status, 415);

      const oversized = await fetch(url + "/api/memory/" + encodeURIComponent(created.id), {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: "x".repeat(12001) })
      });
      assert.equal(oversized.status, 413);
    }, { HOST: "127.0.0.1", POCKET_MEMORY_DIR: directory });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("memory API rejects blank and oversized content", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "pocket-ai-memory-invalid-"));
  try {
    await withServer(async url => {
      const blank = await fetch(url + "/api/memory", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: "  " })
      });
      assert.equal(blank.status, 400);
      const large = await fetch(url + "/api/memory", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: "x".repeat(12001) })
      });
      assert.equal(large.status, 413);
    }, { HOST: "127.0.0.1", POCKET_MEMORY_DIR: directory });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});


test("memory API rejects cross-origin browser requests", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "pocket-ai-memory-origin-"));
  try {
    await withServer(async url => {
      const response = await fetch(url + "/api/memory", {
        headers: { origin: "https://attacker.example" }
      });
      assert.equal(response.status, 403);
    }, { HOST: "127.0.0.1", POCKET_MEMORY_DIR: directory });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("memory writes require JSON content type to block simple cross-site form posts", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "pocket-ai-memory-content-type-"));
  try {
    await withServer(async url => {
      const response = await fetch(url + "/api/memory", {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: JSON.stringify({ content: "cross-site write" })
      });
      assert.equal(response.status, 415);
    }, { HOST: "127.0.0.1", POCKET_MEMORY_DIR: directory });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});


test("consumer server startup permits loopback binds only", () => {
  for (const host of ["127.0.0.1", "localhost", "::1"]) {
    assert.equal(assertLoopbackHost(host), host);
  }
  for (const host of ["0.0.0.0", "::", "192.0.2.10", "example.com", ""]) {
    assert.throws(() => assertLoopbackHost(host), /must bind to loopback/);
  }
});
