/**
 * Pocket AI Lab: one real-provider multi-agent execution harness.
 *
 * This is a host-side integration proof, NOT iPhone attestation, APEX approval,
 * signed Evidence, persistent East execution, or independent resident models.
 * Test doubles must always be labeled as such in the resulting artifact.
 */
import { createHash, randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { Orchestrator } from "../../packages/intelligence/orchestrator/Orchestrator.ts";
import { LlamaCppInferenceProvider } from "../../runtime/adapters/llama-cpp/LlamaCppInferenceProvider.ts";

export const EXPECTED_ATTEMPTS = Object.freeze([
  ["independent", "reasoner", "analysis"],
  ["independent", "researcher", "analysis"],
  ["independent", "engineer", "analysis"],
  ["cross-review", "critic", "question"],
  ["cross-review", "validator", "question"],
  ["verification", "validator", "validation"],
  ["synthesis", "director", "completion"]
]);

function digest(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function nonempty(value, label, maximum = 2000) {
  if (typeof value !== "string" || !value.trim() || value.length > maximum) {
    throw new Error(label + " must be a non-empty string of at most " + maximum + " characters");
  }
  return value.trim();
}

function positiveBudget(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0 || value > 1024 * 1024) {
    throw new Error(label + " must be a bounded positive integer in MiB");
  }
  return value;
}

function rejectNonLocal(baseUrl) {
  const url = new URL(baseUrl);
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!["127.0.0.1", "localhost", "::1"].includes(hostname) ||
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.username || url.password) {
    throw new Error("Live POC backend must be explicit loopback llama-server with no URL credentials");
  }
  return url.toString();
}

/**
 * Execute existing Orchestrator/ModelRouter/MessageBus/MemoryManager unchanged.
 * The caller supplies a real InferenceProvider OR a clearly labeled test double.
 * Successful provider returns are not proof of device attestation or model identity.
 */
export async function runUnifiedAgentProof(options) {
  if (!options || typeof options.provider?.generate !== "function") {
    throw new Error("A configured inference provider is required");
  }
  if (options.executionKind !== "provider-declared-live" && options.executionKind !== "test-double") {
    throw new Error("Execution kind must explicitly distinguish live provider and test double");
  }
  const taskId = nonempty(options.taskId ?? randomUUID(), "taskId", 128);
  const objective = nonempty(options.objective, "objective");
  const modelId = nonempty(options.modelId, "modelId", 128);
  const memoryEstimateMB = positiveBudget(options.memoryEstimateMB, "memoryEstimateMB");
  const declaredAvailableMemoryMB = positiveBudget(options.declaredAvailableMemoryMB, "declaredAvailableMemoryMB");

  // This is a *declared* resource ceiling, not measured device free RAM.
  // The actual provider/session lifecycle remains outside this harness.
  const attempts = [];
  const recordingProvider = {
    async generate(request) {
      const began = performance.now();
      const recorded = {
        ordinal: attempts.length + 1,
        attemptId: randomUUID(),
        stage: request.stage,
        agentId: request.agentId,
        requestedModelId: request.modelId,
        contextMessageCount: request.contextMessages.length,
        startedAt: new Date().toISOString(),
        status: "failed"
      };
      attempts.push(recorded);
      try {
        const value = await options.provider.generate(request);
        if (!value || typeof value !== "object" || !("payload" in value)) {
          throw new Error("Inference provider returned no structured payload");
        }
        recorded.status = "returned";
        return value;
      } finally {
        recorded.elapsedMilliseconds = Math.round((performance.now() - began) * 100) / 100;
      }
    }
  };

  const orchestrator = new Orchestrator({
    inference: recordingProvider,
    getResources: () => ({
      availableMemoryMB: declaredAvailableMemoryMB,
      loadedModels: []
    }),
    maxDeliberationRounds: 0
  });
  // Six logical roles share the ONE configured local backend. This is not
  // proof that six independent models have executed or can fit in device RAM.
  orchestrator.models.register({
    id: modelId,
    name: modelId,
    path: "loopback:operator-configured-model",
    contextLength: 2048,
    capabilities: [],
    memoryEstimateMB
  });
  for (const agentId of new Set(EXPECTED_ATTEMPTS.map(row => row[1]))) {
    orchestrator.models.associateAgent(agentId, modelId);
  }

  const result = await orchestrator.executeTask({
    id: taskId,
    objective,
    requiredCapabilities: []
  });
  const messages = orchestrator.bus.getThread(taskId);
  if (attempts.length !== EXPECTED_ATTEMPTS.length || messages.length !== attempts.length) {
    throw new Error("The completed task lacks the expected independent inference attempt/message linkage");
  }
  for (let index = 0; index < EXPECTED_ATTEMPTS.length; index++) {
    const [stage, agentId, type] = EXPECTED_ATTEMPTS[index];
    const attempt = attempts[index];
    const message = messages[index];
    if (attempt.status !== "returned" ||
        attempt.stage !== stage || attempt.agentId !== agentId ||
        message.senderAgentId !== agentId || message.messageType !== type ||
        message.sequence !== index || message.taskId !== taskId ||
        attempt.requestedModelId !== modelId) {
      throw new Error("Attempt/transcript correspondence failed at index " + index);
    }
  }

  const memories = orchestrator.memory.getByTask(taskId);
  if (memories.length !== 1 || memories.some(memory =>
    memory.layer !== "episodic" || memory.provenance.verified !== false
  )) {
    throw new Error("The task did not preserve one unverified episodic memory");
  }

  const summary = {
    kind: "pocket-unified-agent-proof-v1",
    executionKind: options.executionKind,
    taskId,
    completedAt: new Date().toISOString(),
    model: {
      requestedId: modelId,
      modelArtifactIdentityAttested: false,
      runtimeDeviceAttested: false,
      modelsResidentVerified: false
    },
    resourceAccounting: {
      kind: "operator-declared-not-measured",
      memoryEstimateMB,
      availableMemoryMB: declaredAvailableMemoryMB
    },
    outcome: {
      synthesis: result.synthesis,
      consensus: result.consensus,
      notes: result.notes,
      untrustedEvidenceRefs: result.evidenceRefs
    },
    inference: {
      actualProviderCallsReturned: attempts.length,
      distinctLogicalRoles: [...new Set(attempts.map(a => a.agentId))],
      attempts
    },
    transcript: messages.map(message => ({
      messageId: message.messageId,
      sequence: message.sequence,
      senderAgentId: message.senderAgentId,
      messageType: message.messageType,
      contentSha256: digest(message.payload),
      evidenceRefCount: message.evidenceRefs.length
    })),
    memory: {
      unverifiedEpisodicRecords: memories.length,
      records: memories.map(entry => ({
        id: entry.id,
        verified: entry.provenance.verified,
        contentSha256: digest(entry.content)
      }))
    },
    limits: {
      toolActionsExecuted: false,
      productionApexAuthorization: false,
      eastDurableExecution: false,
      signedEvidence: false,
      nativeIphoneExecution: false,
      hardwareAcceptance: false,
      crossModelLatentTransfer: false
    }
  };
  // An ordinary, unkeyed SHA-256 for local comparison. NEVER a signature,
  // provenance attestation, trusted generation receipt, or authorization.
  return Object.freeze({ ...summary, localRecordSha256: digest(summary) });
}

function requiredEnvironment(name) {
  return nonempty(process.env[name], name, 256);
}

async function main() {
  if (process.env.POCKET_UNIFIED_POC !== "1") {
    throw new Error("Set POCKET_UNIFIED_POC=1 explicitly to run real local model calls");
  }
  const baseUrl = rejectNonLocal(process.env.POCKET_POC_BASE_URL || "http://127.0.0.1:8080");
  const modelId = requiredEnvironment("POCKET_POC_MODEL_ID");
  const modelAlias = process.env.POCKET_POC_MODEL_ALIAS || undefined;
  const objective = requiredEnvironment("POCKET_POC_OBJECTIVE");
  const memoryEstimateMB = Number(requiredEnvironment("POCKET_POC_MODEL_MEMORY_MB"));
  const declaredAvailableMemoryMB = Number(requiredEnvironment("POCKET_POC_AVAILABLE_MEMORY_MB"));
  const provider = new LlamaCppInferenceProvider({
    baseUrl,
    modelAlias,
    api: "completion",
    promptFormat: "chat",
    maxTokens: 512,
    agentMaxTokens: 256,
    repairAttempts: 1,
    requireSubstantive: true,
    aliasMessageIds: true
  });
  await provider.checkHealth();
  const proof = await runUnifiedAgentProof({
    provider,
    executionKind: "provider-declared-live",
    modelId,
    objective,
    memoryEstimateMB,
    declaredAvailableMemoryMB
  });
  const json = JSON.stringify(proof, null, 2) + "\n";
  if (process.env.POCKET_POC_OUTPUT) {
    await writeFile(process.env.POCKET_POC_OUTPUT, json, { flag: "wx", mode: 0o600 });
  }
  process.stdout.write(json);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error("Pocket unified proof failed closed:", error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
