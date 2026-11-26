import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../nativeBridge.js", import.meta.url), "utf8");
const UUID = "123e4567-e89b-42d3-a456-426614174000";
const MODEL_ID = "sha256-" + "a".repeat(64);

function loadBridge(postMessage, { available = true } = {}) {
  let counter = 0;
  const sandbox = {
    TextEncoder,
    Uint8Array,
    Array,
    Object,
    Error,
    Promise,
    Number,
    String,
    Math,
    crypto: {
      randomUUID: () => {
        counter += 1;
        return UUID.replace(/0$/, String(counter));
      }
    }
  };
  if (available) {
    sandbox.webkit = { messageHandlers: { pocketAILab: { postMessage } } };
  }
  sandbox.globalThis = sandbox;
  vm.runInNewContext(source, sandbox, { filename: "nativeBridge.js" });
  return sandbox.PocketAILabNativeBridge;
}

function reply(message, data) {
  return { id: message.id, ok: true, data };
}

test("native bridge is optional outside the iOS WKWebView host", async () => {
  const bridge = loadBridge(async () => {
    throw new Error("must not be called");
  }, { available: false });
  assert.equal(bridge.isAvailable(), false);
  await assert.rejects(() => bridge.getRuntimeStatus(), error => error.code === "native_bridge_unavailable");
});

test("bridge rejects unknown actions and fields before posting a message", async () => {
  let calls = 0;
  const bridge = loadBridge(async message => {
    calls += 1;
    return reply(message, {});
  });
  await assert.rejects(() => bridge.request("loadModel", { model: "model-1" }), error => error.code === "unsupported_action");
  await assert.rejects(() => bridge.request("getRuntimeStatus", { origin: "https://attacker.example" }), error => error.code === "invalid_fields");
  assert.equal(calls, 0);
});

test("native chat uses readiness, host challenge, and generation in order", async () => {
  const calls = [];
  const bridge = loadBridge(async message => {
    calls.push(message);
    switch (message.action) {
      case "getRuntimeStatus":
        return reply(message, {
          runtimeAvailable: true,
          activeLocalSessions: [{ modelId: MODEL_ID, sessionId: UUID }]
        });
      case "listModels":
        return reply(message, { models: [{ id: MODEL_ID, name: "Local test model", selected: true }] });
      case "checkReadiness":
        assert.equal(message.sessionId, UUID);
        return reply(message, { canGenerate: true, sessionId: UUID });
      case "authorizeGeneration":
        assert.equal(message.sessionId, UUID);
        return reply(message, {
          challengeNonce: "0123456789abcdef0123456789abcdef",
          requestId: message.requestId,
          sessionId: message.sessionId
        });
      case "generate":
        assert.equal(message.sessionId, UUID);
        assert.equal(message.challengeNonce, "0123456789abcdef0123456789abcdef");
        assert.equal(message.prompt, "Explain model leases.");
        assert.equal(message.maxTokens, 256);
        assert.equal(message.temperature, 0.7);
        return reply(message, {
          output: "A lease protects one exact runtime session.",
          runtimeSessionId: UUID,
          authorized: false
        });
      default:
        throw new Error("Unexpected action: " + message.action);
    }
  });

  const record = await bridge.generate("Explain model leases.");
  assert.equal(record.output, "A lease protects one exact runtime session.");
  assert.equal(record.authorized, false);
  assert.deepEqual(calls.map(call => call.action), [
    "getRuntimeStatus", "listModels", "checkReadiness", "authorizeGeneration", "generate"
  ]);
  assert.match(calls[3].requestId, /^[0-9a-f-]{36}$/i);
  assert.equal(calls[4].requestId, calls[3].requestId);
  assert.match(calls[4].conversationRequestId, /^[0-9a-f-]{36}$/i);
  assert.match(calls[4].attemptId, /^[0-9a-f-]{36}$/i);
});

test("native chat refuses to generate when the selected model has no Local AI lease", async () => {
  const calls = [];
  const bridge = loadBridge(async message => {
    calls.push(message.action);
    if (message.action === "getRuntimeStatus") {
      return reply(message, { runtimeAvailable: true, activeLocalSessions: [] });
    }
    if (message.action === "listModels") {
      return reply(message, { models: [{ id: MODEL_ID, selected: true }] });
    }
    throw new Error("No readiness, challenge, or generation call is allowed.");
  });
  await assert.rejects(() => bridge.generate("Hello"), error => error.code === "model_not_loaded");
  assert.deepEqual(calls, ["getRuntimeStatus", "listModels"]);
});

test("native chat refuses a readiness result for a different runtime session", async () => {
  const calls = [];
  const bridge = loadBridge(async message => {
    calls.push(message.action);
    if (message.action === "getRuntimeStatus") {
      return reply(message, { runtimeAvailable: true, activeLocalSessions: [{ modelId: MODEL_ID, sessionId: UUID }] });
    }
    if (message.action === "listModels") {
      return reply(message, { models: [{ id: MODEL_ID, selected: true }] });
    }
    if (message.action === "checkReadiness") {
      return reply(message, { canGenerate: true, sessionId: "different-session" });
    }
    throw new Error("Authorization and generation must not run.");
  });
  await assert.rejects(() => bridge.generate("Hello"), error => error.code === "runtime_not_ready");
  assert.deepEqual(calls, ["getRuntimeStatus", "listModels", "checkReadiness"]);
});


test("aborting native chat sends a cancellation for the exact active request", async () => {
  let resolveStarted;
  const started = new Promise(resolve => { resolveStarted = resolve; });
  const calls = [];
  const bridge = loadBridge(async message => {
    calls.push(message);
    switch (message.action) {
      case "getRuntimeStatus":
        return reply(message, { runtimeAvailable: true, activeLocalSessions: [{ modelId: MODEL_ID, sessionId: UUID }] });
      case "listModels":
        return reply(message, { models: [{ id: MODEL_ID, selected: true }] });
      case "checkReadiness":
        return reply(message, { canGenerate: true, sessionId: UUID });
      case "authorizeGeneration":
        return reply(message, {
          challengeNonce: "0123456789abcdef0123456789abcdef",
          requestId: message.requestId,
          sessionId: message.sessionId
        });
      case "generate":
        resolveStarted(message);
        return new Promise(() => {});
      case "cancelGeneration":
        return reply(message, { cancelled: true });
      default:
        throw new Error("Unexpected action: " + message.action);
    }
  });
  const controller = new AbortController();
  const generation = bridge.generate("A long-running request.", {
    signal: controller.signal,
    onRequest: () => {}
  });
  const active = await started;
  controller.abort();
  await assert.rejects(generation, error => error.code === "generation_cancelled");
  const cancellation = calls.find(call => call.action === "cancelGeneration");
  assert.ok(cancellation);
  assert.equal(cancellation.sessionId, active.sessionId);
  assert.equal(cancellation.requestId, active.requestId);
});

test("native chat enforces bounded generation settings and prompt size", async () => {
  let calls = 0;
  const bridge = loadBridge(async message => {
    calls += 1;
    return reply(message, {});
  });
  await assert.rejects(() => bridge.generate("Hello", { maxTokens: 0 }), error => error.code === "invalid_generation_options");
  await assert.rejects(() => bridge.generate("x".repeat(32_769)), error => error.code === "prompt_too_large");
  assert.equal(calls, 0);
});
