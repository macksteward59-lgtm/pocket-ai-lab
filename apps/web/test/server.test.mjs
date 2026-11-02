import test from "node:test";
import assert from "node:assert/strict";
import { createServer as createHttpServer } from "node:http";
import { createServer } from "../server.mjs";

const ENV_KEYS = ["LLM_BASE_URL", "LLM_MODEL", "LLM_API_KEY", "LLAMACPP_BASE_URL", "LLAMACPP_API", "LLAMACPP_MODEL_ALIAS"];

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
