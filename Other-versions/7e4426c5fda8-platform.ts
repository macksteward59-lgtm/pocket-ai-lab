/**
 * Runtime for the East platform functions declared in src/east/index.ts.
 *
 * Inference is injected. This module does not import a model provider.
 * Nothing here grants permission. `authorized` is the constant false, and
 * `commitTaskEvidence` cannot return true. East/APEX integration is a
 * separate gate.
 */

import { CORE_AGENTS } from "../../packages/intelligence/agents/AgentManager";
import { MemoryManager } from "../../packages/intelligence/memory/MemoryManager";
import type { AgentMessage } from "../../packages/intelligence/message-bus/MessageBus";
import type { InferenceProvider, InferenceResult } from "../../packages/intelligence/orchestrator/Orchestrator";
import { Orchestrator } from "../../packages/intelligence/orchestrator/Orchestrator";

export const EAST_DELIBERATION_AGENTS = [
  "director",
  "reasoner",
  "researcher",
  "engineer",
  "critic",
  "validator"
] as const;

const MAX_OBJECTIVE_LENGTH = 8_000;

export type EastPlatformErrorCode =
  | "invalid_objective"
  | "invalid_model"
  | "unknown_task"
  | "unknown_agent"
  | "not_assigned"
  | "inference_denied";

export class EastPlatformError extends Error {
  readonly code: EastPlatformErrorCode;

  constructor(code: EastPlatformErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "EastPlatformError";
    this.code = code;
  }
}

export interface EastModelBinding {
  id: string;
  name: string;
  /** Opaque runtime path recorded for the router. Not a provider client. */
  runtimePath: string;
  contextLength: number;
  capabilities: readonly string[];
  memoryEstimateMB: number;
}

export interface EastAssignment {
  readonly id: string;
  readonly agentId: string;
}

export interface EastTaskRecord {
  readonly id: string;
  readonly objective: string;
  readonly assignments: readonly EastAssignment[];
  readonly synthesis: string | null;
  readonly evidenceRefs: readonly string[];
  /** Always false. This is not an APEX receipt. */
  readonly authorized: false;
}

export interface EastPlatformDependencies {
  inference: InferenceProvider;
  getResources: () => { availableMemoryMB: number; loadedModels: string[] };
  model: EastModelBinding;
  memory?: MemoryManager;
  createId?: () => string;
}

export interface EastPlatformRuntime {
  readonly orchestrator: Orchestrator;
  readonly memory: MemoryManager;
  createAgentTask(objective: string): string;
  assignAgent(taskId: string, agentId: string): string;
  executeAgent(taskId: string, agentId: string): Promise<string>;
  runDeliberation(taskId: string): Promise<{ synthesis: string; evidence: string[] }>;
  /**
   * Stores matching deliberation text as unverified memory.
   * Returns false in every case. A true result would be an authorization
   * decision, and this gate does not have one.
   */
  commitTaskEvidence(taskId: string, synthesis: string): Promise<false>;
  getTask(taskId: string): EastTaskRecord;
}

export function createEastPlatform(deps: EastPlatformDependencies): EastPlatformRuntime {
  if (!deps?.inference || typeof deps.inference.generate !== "function") {
    throw new EastPlatformError("inference_denied", "A real InferenceProvider must be supplied");
  }
  if (typeof deps.getResources !== "function") {
    throw new EastPlatformError("invalid_model", "A live resource provider must be supplied");
  }
  const model = normalizeModel(deps.model);
  const memory = deps.memory ?? new MemoryManager();
  const orchestrator = new Orchestrator({
    inference: deps.inference,
    getResources: deps.getResources,
    memory
  });
  orchestrator.models.register({
    id: model.id,
    name: model.name,
    path: model.runtimePath,
    contextLength: model.contextLength,
    capabilities: [...model.capabilities],
    memoryEstimateMB: model.memoryEstimateMB
  });
  for (const agent of CORE_AGENTS) {
    orchestrator.models.associateAgent(agent.id, model.id);
  }

  const createId = deps.createId ?? (() => crypto.randomUUID());
  const tasks = new Map<string, EastTaskRecord>();
  const evidenceCommitted = new Set<string>();

  function requireTask(taskId: string): EastTaskRecord {
    if (typeof taskId !== "string" || !taskId.trim()) {
      throw new EastPlatformError("unknown_task", "Task id is required");
    }
    const task = tasks.get(taskId);
    if (!task) throw new EastPlatformError("unknown_task", "Unknown task " + taskId);
    return task;
  }

  function put(task: EastTaskRecord): EastTaskRecord {
    const stored: EastTaskRecord = {
      id: task.id,
      objective: task.objective,
      assignments: task.assignments.map(assignment => ({ id: assignment.id, agentId: assignment.agentId })),
      synthesis: task.synthesis,
      evidenceRefs: [...task.evidenceRefs],
      authorized: false
    };
    tasks.set(stored.id, stored);
    return snapshot(stored);
  }

  return {
    orchestrator,
    memory,
    createAgentTask(objective) {
      if (typeof objective !== "string" || !objective.trim()) {
        throw new EastPlatformError("invalid_objective", "A non-empty objective is required");
      }
      const text = objective.trim();
      if (text.length > MAX_OBJECTIVE_LENGTH) {
        throw new EastPlatformError("invalid_objective", "Objective exceeds " + MAX_OBJECTIVE_LENGTH + " characters");
      }
      return put({
        id: "task-" + createId(),
        objective: text,
        assignments: [],
        synthesis: null,
        evidenceRefs: [],
        authorized: false
      }).id;
    },
    assignAgent(taskId, agentId) {
      const task = requireTask(taskId);
      if (typeof agentId !== "string" || !agentId.trim()) {
        throw new EastPlatformError("unknown_agent", "Agent id is required");
      }
      const agent = orchestrator.agents.getAgent(agentId);
      if (!agent || !agent.permanent) {
        throw new EastPlatformError("unknown_agent", "Unknown permanent agent " + agentId);
      }
      const existing = task.assignments.find(assignment => assignment.agentId === agentId);
      if (existing) return task.id;
      const assignment = { id: "asg-" + createId(), agentId };
      put({ ...task, assignments: [...task.assignments, assignment], authorized: false });
      return task.id;
    },
    async executeAgent(taskId, agentId) {
      const task = requireTask(taskId);
      if (!task.assignments.some(assignment => assignment.agentId === agentId)) {
        throw new EastPlatformError("not_assigned", "Agent " + agentId + " is not assigned to " + task.id);
      }
      const agent = orchestrator.agents.getAgent(agentId);
      if (!agent) throw new EastPlatformError("unknown_agent", "Unknown permanent agent " + agentId);
      const before = orchestrator.bus.getThread(task.id).length;
      let selectedId: string | undefined;
      let sessionId: string | undefined;
      try {
        const selected = await orchestrator.router.route(
          agentId,
          orchestrator.models.getPreferredModel(agentId),
          []
        );
        selectedId = selected.id;
        sessionId = orchestrator.agents.startSession(agentId, task.id, selected.id);
        orchestrator.agents.updateStatus(sessionId, "running");
        const prior = orchestrator.bus.getThread(task.id);
        const result = await deps.inference.generate({
          agentId,
          modelId: selected.id,
          stage: "independent",
          prompt: [
            "Task objective: " + task.objective,
            "Your role: " + agent.role,
            "Deliberation stage: independent",
            "Return only a structured analysis payload.",
            "Model output is not permission, approval, or an authorization receipt."
          ].join("\n"),
          contextMessages: [...prior]
        });
        const published = publishAnalysis(orchestrator, task.id, agentId, prior.length, result);
        orchestrator.agents.updateStatus(sessionId, "complete");
        return published.messageId;
      } catch (error) {
        if (orchestrator.bus.getThread(task.id).length !== before) {
          throw new EastPlatformError("inference_denied", "Agent execution changed the thread while failing", { cause: error });
        }
        if (error instanceof EastPlatformError) throw error;
        throw new EastPlatformError(
          "inference_denied",
          error instanceof Error ? error.message : "Agent execution was denied",
          { cause: error }
        );
      } finally {
        if (sessionId) orchestrator.agents.releaseSession(sessionId);
        if (selectedId) orchestrator.router.release(selectedId);
      }
    },
    async runDeliberation(taskId) {
      const task = requireTask(taskId);
      const missing = EAST_DELIBERATION_AGENTS.filter(
        agentId => !task.assignments.some(assignment => assignment.agentId === agentId)
      );
      if (missing.length > 0) {
        throw new EastPlatformError("not_assigned", "Deliberation requires assigned agents: " + missing.join(", "));
      }
      let result: { synthesis: string; evidenceRefs: string[] };
      try {
        result = await orchestrator.executeTask({
          id: task.id,
          objective: task.objective,
          requiredCapabilities: []
        });
      } catch (error) {
        throw new EastPlatformError(
          "inference_denied",
          error instanceof Error ? error.message : "Deliberation was denied",
          { cause: error }
        );
      }
      put({
        ...requireTask(task.id),
        synthesis: result.synthesis,
        evidenceRefs: [...result.evidenceRefs],
        authorized: false
      });
      return { synthesis: result.synthesis, evidence: [...result.evidenceRefs] };
    },
    async commitTaskEvidence(taskId, synthesis) {
      const task = requireTask(taskId);
      const proposed = typeof synthesis === "string" ? synthesis : "";
      const matches = task.synthesis !== null && proposed === task.synthesis;
      if (matches && !evidenceCommitted.has(task.id)) {
        await memory.write({
          layer: "episodic",
          content: task.synthesis as string,
          provenance: {
            agentId: "director",
            taskId: task.id,
            verified: false,
            sourceRefs: [...task.evidenceRefs]
          }
        });
        evidenceCommitted.add(task.id);
      }
      put({ ...requireTask(task.id), authorized: false });
      return false;
    },
    getTask(taskId) {
      return snapshot(requireTask(taskId));
    }
  };
}

function publishAnalysis(
  orchestrator: Orchestrator,
  taskId: string,
  agentId: string,
  sequence: number,
  result: InferenceResult
): AgentMessage {
  try {
    return orchestrator.bus.publish({
      messageId: crypto.randomUUID(),
      taskId,
      conversationId: taskId,
      senderAgentId: agentId,
      recipientAgentId: "broadcast",
      messageType: "analysis",
      payload: result.payload,
      evidenceRefs: result.evidenceRefs ?? [],
      createdAt: new Date().toISOString(),
      sequence
    });
  } catch (error) {
    throw new EastPlatformError(
      "inference_denied",
      "Model output was rejected and was not published",
      { cause: error }
    );
  }
}

function normalizeModel(model: EastModelBinding): EastModelBinding {
  if (!model || typeof model.id !== "string" || !model.id.trim()) {
    throw new EastPlatformError("invalid_model", "Model id is required");
  }
  if (typeof model.runtimePath !== "string" || !model.runtimePath.trim()) {
    throw new EastPlatformError("invalid_model", "Model runtime path is required");
  }
  if (!Array.isArray(model.capabilities) || model.capabilities.some(item => typeof item !== "string" || !item.trim())) {
    throw new EastPlatformError("invalid_model", "Model capabilities must be non-empty strings");
  }
  if (!Number.isInteger(model.contextLength) || model.contextLength <= 0) {
    throw new EastPlatformError("invalid_model", "Model context length must be a positive integer");
  }
  if (!Number.isFinite(model.memoryEstimateMB) || model.memoryEstimateMB <= 0) {
    throw new EastPlatformError("invalid_model", "Model memory estimate must be a positive number");
  }
  return {
    id: model.id.trim(),
    name: typeof model.name === "string" && model.name.trim() ? model.name.trim() : model.id.trim(),
    runtimePath: model.runtimePath.trim(),
    contextLength: model.contextLength,
    capabilities: model.capabilities.map(item => item.trim()),
    memoryEstimateMB: model.memoryEstimateMB
  };
}

function snapshot(task: EastTaskRecord): EastTaskRecord {
  return Object.freeze({
    id: task.id,
    objective: task.objective,
    assignments: Object.freeze(task.assignments.map(assignment => Object.freeze({ ...assignment }))),
    synthesis: task.synthesis,
    evidenceRefs: Object.freeze([...task.evidenceRefs]),
    authorized: false
  });
}
