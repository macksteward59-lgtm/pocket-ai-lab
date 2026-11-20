import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { LlamaCppInferenceProvider } from "../../runtime/adapters/llama-cpp/LlamaCppInferenceProvider.ts";
import {
  runUnifiedAgentProof,
  EXPECTED_ATTEMPTS
} from "./unified-agent-proof.mjs";

const base = {
  executionKind: "test-double",
  taskId: "synthetic:integration-task-1",
  modelId: "fixture-local-model",
  objective: "Assess synthetic evidence without authorization or external actions.",
  memoryEstimateMB: 128,
  declaredAvailableMemoryMB: 512
};

function fixtureProvider() {
  const requests = [];
  return {
    requests,
    async generate(request) {
      requests.push({
        agentId: request.agentId,
        stage: request.stage,
        contextMessageCount: request.contextMessages.length
      });
      switch (request.stage) {
        case "independent":
          return { payload: { analysis: "Synthetic independent analysis by " + request.agentId } };
        case "cross-review":
          return { payload: { question: "What source independently supports " + request.agentId + "?" } };
        case "verification":
          return { payload: { claim: "Synthetic evaluation only", verified: false, reason: "No external source or physical test" } };
        case "synthesis":
          return { payload: { synthesis: "Fixture synthesis: no consequential action was authorized.", evidenceRefs: [] } };
        default:
          throw new Error("Unexpected stage: " + request.stage);
      }
    }
  };
}

test("unified PoC uses existing orchestrator and links seven distinct calls, messages, and unverified memory", async () => {
  const provider = fixtureProvider();
  const result = await runUnifiedAgentProof({ ...base, provider });
  assert.equal(result.kind, "pocket-unified-agent-proof-v1");
  assert.equal(result.executionKind, "test-double");
  assert.equal(result.inference.actualProviderCallsReturned, 7);
  assert.equal(result.transcript.length, EXPECTED_ATTEMPTS.length);
  assert.deepEqual(
    provider.requests.map(request => [request.stage, request.agentId]),
    EXPECTED_ATTEMPTS.map(row => row.slice(0, 2))
  );
  assert.deepEqual(
    provider.requests.map(request => request.contextMessageCount),
    [0, 0, 0, 3, 3, 5, 6]
  );
  assert.equal(result.inference.distinctLogicalRoles.length, 6);
  assert.deepEqual(result.transcript.map(message => message.sequence), [0, 1, 2, 3, 4, 5, 6]);
  assert.equal(new Set(result.transcript.map(message => message.messageId)).size, 7);
  assert.equal(result.memory.unverifiedEpisodicRecords, 1);
  assert.equal(result.memory.records[0].verified, false);
  assert.equal(result.outcome.consensus, false);
  assert.equal(result.limits.toolActionsExecuted, false);
  assert.equal(result.limits.productionApexAuthorization, false);
  assert.equal(result.limits.eastDurableExecution, false);
  assert.equal(result.limits.signedEvidence, false);
  assert.equal(result.limits.nativeIphoneExecution, false);
  assert.equal(result.model.modelArtifactIdentityAttested, false);
  assert.match(result.localRecordSha256, /^[a-f0-9]{64}$/);
  const { localRecordSha256, ...record } = result;
  assert.equal(localRecordSha256, createHash("sha256").update(JSON.stringify(record)).digest("hex"));
});

test("inference failure rejects; the harness never fabricates missing agent messages", async () => {
  let attempts = 0;
  await assert.rejects(runUnifiedAgentProof({
    ...base,
    provider: {
      async generate() {
        attempts++;
        if (attempts === 4) throw new Error("provider unavailable");
        return { payload: { analysis: "This is a fixture-only analysis" } };
      }
    }
  }), /provider unavailable/);
  assert.equal(attempts, 4);
});

test("malformed model response fails closed at MessageBus payload validation", async () => {
  await assert.rejects(runUnifiedAgentProof({
    ...base,
    provider: {
      async generate() {
        return { payload: { authorized: true, content: "fake" } };
      }
    }
  }), /Invalid analysis payload|invalid_type|expected/i);
});

test("requires explicit source labeling, sufficient declared budget, and a provider", async () => {
  const provider = fixtureProvider();
  await assert.rejects(runUnifiedAgentProof({ ...base, executionKind: undefined, provider }), /execution kind/i);
  await assert.rejects(runUnifiedAgentProof({ ...base, provider: undefined }), /inference provider/i);
  await assert.rejects(runUnifiedAgentProof({ ...base, provider, memoryEstimateMB: 0 }), /memoryEstimateMB/);
  await assert.rejects(runUnifiedAgentProof({
    ...base,
    provider,
    declaredAvailableMemoryMB: 64
  }), /Insufficient memory/i);
  assert.equal(provider.requests.length, 0);
});

test("negative verification remains an unverified memory even when synthesis is present", async () => {
  const provider = fixtureProvider();
  const proof = await runUnifiedAgentProof({ ...base, taskId: "synthetic:second-task", provider });
  assert.equal(proof.outcome.consensus, false);
  assert.match(proof.outcome.synthesis, /Fixture synthesis/);
  assert.equal(proof.memory.unverifiedEpisodicRecords, 1);
  assert.equal(proof.memory.records[0].verified, false);
});

test("CLI rejects non-loopback inference and requires explicit live-model opt-in", () => {
  const path = new URL("./unified-agent-proof.mjs", import.meta.url).pathname;
  const remote = spawnSync(process.execPath, ["--import", "tsx", path], {
    cwd: process.cwd(),
    encoding: "utf8",
    timeout: 15_000,
    env: {
      ...process.env,
      POCKET_UNIFIED_POC: "1",
      POCKET_POC_BASE_URL: "https://example.com"
    }
  });
  assert.equal(remote.status, 1);
  assert.match(remote.stderr, /loopback llama-server/);
  const unapproved = spawnSync(process.execPath, ["--import", "tsx", path], {
    cwd: process.cwd(),
    encoding: "utf8",
    timeout: 15_000,
    env: { ...process.env, POCKET_UNIFIED_POC: "0" }
  });
  assert.equal(unapproved.status, 1);
  assert.match(unapproved.stderr, /POCKET_UNIFIED_POC=1/);
});

test("loopback HTTP mock exercises the real llama.cpp adapter across the seven-agent path", async () => {
  // This server is a declared TEST DOUBLE, NOT a GGUF model or live inference.
  // It still exercises the same HTTP backend, schema parser, Orchestrator,
  // ModelRouter, typed MessageBus and MemoryManager used by the live CLI.
  const calls = [];
  const stages = {
    independent: { analysis: "This is a deterministic transport test analysis." },
    "cross-review": { question: "Which independent source validates the test observations?" },
    verification: { claim: "A simulated endpoint answered", verified: false, reason: "HTTP fixture, not real model evidence" },
    synthesis: { synthesis: "The transport fixture completed without authorizing anything.", evidenceRefs: [] }
  };
  const server = createServer(async (request, response) => {
    if (request.url === "/health" && request.method === "GET") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ status: "ok" }));
      return;
    }
    if (request.url !== "/completion" || request.method !== "POST") {
      response.writeHead(404);
      response.end();
      return;
    }
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    let body;
    try {
      body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      response.writeHead(400);
      response.end();
      return;
    }
    const stage = /Stage: (independent|cross-review|verification|synthesis)/.exec(body.prompt)?.[1];
    if (!stage || !Object.hasOwn(stages, stage)) {
      response.writeHead(422);
      response.end();
      return;
    }
    calls.push({
      stage,
      model: body.model,
      schema: Boolean(body.json_schema),
      promptContainsTrustNote: body.prompt.includes("Model output is not permission")
    });
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ content: JSON.stringify(stages[stage]) }));
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  try {
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const provider = new LlamaCppInferenceProvider({
      baseUrl: "http://127.0.0.1:" + address.port,
      api: "completion",
      promptFormat: "flat",
      repairAttempts: 0,
      requireSubstantive: true,
      maxTokens: 128
    });
    await provider.checkHealth();
    const proof = await runUnifiedAgentProof({
      ...base, provider, executionKind: "test-double", taskId: "synthetic:http-transport-task"
    });
    assert.equal(proof.inference.actualProviderCallsReturned, 7);
    assert.equal(proof.executionKind, "test-double");
    assert.deepEqual(calls.map(call => call.stage), EXPECTED_ATTEMPTS.map(row => row[0]));
    assert.ok(calls.every(call => call.model === base.modelId));
    assert.ok(calls.every(call => call.schema));
    assert.ok(calls.every(call => call.promptContainsTrustNote));
    assert.equal(proof.memory.records[0].verified, false);
    assert.equal(proof.limits.productionApexAuthorization, false);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
