import test from "node:test";
import assert from "node:assert/strict";
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
