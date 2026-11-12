/**
 * Loopback harness session.
 * Uses the existing deliberation engine and message bus, and an injected
 * InferenceProvider. It does not edit those classes and it does not authorize anything.
 */

import { AgentManager, CORE_AGENTS } from "../../packages/intelligence/agents/AgentManager";
import { DeliberationEngine, type DeliberationStage } from "../../packages/intelligence/deliberation/DeliberationEngine";
import { MemoryManager } from "../../packages/intelligence/memory/MemoryManager";
import { MessageBus, type AgentMessage, type MessageType } from "../../packages/intelligence/message-bus/MessageBus";
import { ModelRegistry } from "../../packages/intelligence/model-registry/ModelRegistry";
import { ModelRouter } from "../../packages/intelligence/model-router/ModelRouter";
import type {
  InferenceProvider,
  InferenceRequest,
  InferenceResult,
  MemoryContextItem
} from "../../packages/intelligence/orchestrator/Orchestrator";
import { LlamaCppInferenceError } from "../adapters/llama-cpp/errors";

export const LAB_DISCLAIMER =
  "These are untrusted model proposals. They are not permission, approval, or an APEX receipt.";

const STAGE_PLAN: Record<DeliberationStage, readonly string[]> = {
  independent: ["reasoner", "researcher", "engineer"],
  "cross-review": ["critic", "validator"],
  challenge: ["critic"],
  revision: ["reasoner", "engineer"],
  verification: ["validator"],
  synthesis: ["director"]
};

const STAGE_MESSAGE_TYPE: Record<DeliberationStage, MessageType> = {
  independent: "analysis",
  "cross-review": "question",
  challenge: "counterargument",
  revision: "revision",
  verification: "validation",
  synthesis: "completion"
};

export interface LabTranscriptMessage {
  messageId: string;
  agentId: string;
  role: string;
  stage: DeliberationStage;
  messageType: MessageType;
  payload: unknown;
  evidenceRefs: string[];
}

export interface LabRunResult {
  objective: string;
  messages: LabTranscriptMessage[];
  synthesis: string | null;
  engineConsensus: boolean;
  notes: string[];
  memoryId: string | null;
  memoryVerified: false;
  authorized: false;
  disclaimer: string;
  error?: { code: string; message: string };
}

export type LabEvent =
  | { type: "stage"; stage: DeliberationStage }
  | { type: "message"; message: LabTranscriptMessage }
  | { type: "error"; code: string; message: string }
  | { type: "done"; result: LabRunResult };

export async function runLabSession(options: {
  objective: string;
  provider: InferenceProvider;
  modelId?: string;
  onEvent?: (event: LabEvent) => void;
  signal?: AbortSignal;
  /** User-saved notes offered to every agent as unverified reference context. */
  memoryContext?: MemoryContextItem[];
}): Promise<LabRunResult> {
  const objective = options.objective?.trim() ?? "";
  if (!objective) {
    return finish(options.onEvent, emptyResult("", {
      code: "invalid_request",
      message: "Enter an objective before running the lab."
    }));
  }
  if (objective.length > 4000) {
    return finish(options.onEvent, emptyResult(objective, {
      code: "invalid_request",
      message: "Objective must be 4,000 characters or fewer."
    }));
  }

  const modelId = options.modelId?.trim() || "local";
  const agents = new AgentManager();
  for (const agent of CORE_AGENTS) agents.registerPermanent(agent);
  const registry = new ModelRegistry();
  registry.register({
    id: modelId,
    name: modelId,
    path: "llama-server",
    contextLength: 4096,
    capabilities: ["reason", "review", "code"],
    memoryEstimateMB: 512
  });
  for (const agent of CORE_AGENTS) registry.associateAgent(agent.id, modelId);
  const router = new ModelRouter(() => ({ availableMemoryMB: 8192, loadedModels: [] }));
  const bus = new MessageBus();
  const memory = new MemoryManager();
  const engine = new DeliberationEngine();
  const taskId = crypto.randomUUID();
  const messages: LabTranscriptMessage[] = [];
  let sequence = 0;

  const emit = (event: LabEvent) => options.onEvent?.(event);

  try {
    const deliberation = await engine.runCycle(taskId, [], async (stage, prior) => {
      emit({ type: "stage", stage });
      const generated: AgentMessage[] = [];
      const counterargumentIds = prior
        .filter(message => message.messageType === "counterargument")
        .map(message => message.messageId);
      for (const agentId of STAGE_PLAN[stage]) {
        if (options.signal?.aborted) {
          throw new LlamaCppInferenceError("cancelled", "Lab run cancelled.");
        }
        const profile = agents.getAgent(agentId);
        const selected = await router.route(agentId, registry.getPreferredModel(agentId), ["reason"]);
        try {
          const inference = await generateWithSignal(options.provider, {
          agentId,
          modelId: selected.id,
          stage,
          prompt: [
            `Objective: ${objective}`,
            `Role: ${profile?.role ?? agentId}. ${profile?.description ?? ""}`,
            stage === "revision" && counterargumentIds.length > 0
              ? `Address these counterargument message IDs exactly (list them in addressesMessageIds; write prose in revision): ${counterargumentIds.join(", ")}`
              : "",
            "Return only the JSON object for this stage. Do not grant permission."
          ].filter(Boolean).join("\n"),
          contextMessages: [...prior],
          ...(options.memoryContext && options.memoryContext.length > 0
            ? { memoryContext: options.memoryContext.map(item => ({ ...item })) }
            : {})
          }, options.signal);
          // Only a successful provider response confirms the selected model generation.
          router.confirmLoaded(selected);
          if (!isRecord(inference.payload)) {
          throw new LlamaCppInferenceError("malformed_response", "Inference provider returned a non-object stage payload.");
        }
        const payload = { ...inference.payload };
        const message: AgentMessage = {
          messageId: crypto.randomUUID(),
          taskId,
          conversationId: taskId,
          senderAgentId: agentId,
          recipientAgentId: "broadcast",
          messageType: STAGE_MESSAGE_TYPE[stage],
          payload,
          evidenceRefs: [...(inference.evidenceRefs ?? [])],
          createdAt: new Date().toISOString(),
          sequence: sequence++
        };
        const published = bus.publish(message);
        generated.push(published);
        const transcript: LabTranscriptMessage = {
          messageId: published.messageId,
          agentId,
          role: profile?.role ?? agentId,
          stage,
          messageType: published.messageType,
          payload: published.payload,
          evidenceRefs: [...published.evidenceRefs]
        };
          messages.push(transcript);
          emit({ type: "message", message: transcript });
        } finally {
          router.release(selected);
        }
      }
      return [...prior, ...generated];
    });

    const synthesis = deliberation.finalSynthesis?.trim() || null;
    let memoryId: string | null = null;
    if (synthesis) {
      memoryId = await memory.write({
        layer: "episodic",
        content: synthesis,
        provenance: {
          agentId: "director",
          taskId,
          verified: false,
          sourceRefs: deliberation.evidenceRefs
        }
      });
      const stored = memory.getByTask(taskId)[0];
      if (stored && stored.provenance.verified !== false) {
        throw new Error("Lab memory must stay unverified.");
      }
    }

    return finish(options.onEvent, {
      objective,
      messages,
      synthesis,
      engineConsensus: deliberation.consensus,
      notes: deliberation.notes,
      memoryId,
      memoryVerified: false,
      authorized: false,
      disclaimer: LAB_DISCLAIMER
    });
  } catch (error) {
    const described = describeFailure(error);
    return finish(options.onEvent, {
      objective,
      messages,
      synthesis: null,
      engineConsensus: false,
      notes: [],
      memoryId: null,
      memoryVerified: false,
      authorized: false,
      disclaimer: LAB_DISCLAIMER,
      error: described
    });
  }
}

function finish(onEvent: ((event: LabEvent) => void) | undefined, result: LabRunResult): LabRunResult {
  if (result.error) onEvent?.({ type: "error", code: result.error.code, message: result.error.message });
  onEvent?.({ type: "done", result });
  return result;
}

function emptyResult(objective: string, error: { code: string; message: string }): LabRunResult {
  return {
    objective,
    messages: [],
    synthesis: null,
    engineConsensus: false,
    notes: [],
    memoryId: null,
    memoryVerified: false,
    authorized: false,
    disclaimer: LAB_DISCLAIMER,
    error
  };
}

function describeFailure(error: unknown): { code: string; message: string } {
  if (error instanceof LlamaCppInferenceError) {
    return { code: error.code, message: error.message };
  }
  if (error instanceof Error) return { code: "lab_error", message: error.message };
  return { code: "lab_error", message: "The lab run failed." };
}

function generateWithSignal(
  provider: InferenceProvider,
  request: InferenceRequest,
  signal?: AbortSignal
): Promise<InferenceResult> {
  const cancellable = provider as InferenceProvider & {
    generate(req: InferenceRequest, options?: { signal?: AbortSignal }): Promise<InferenceResult>;
  };
  return cancellable.generate(request, signal ? { signal } : undefined);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
