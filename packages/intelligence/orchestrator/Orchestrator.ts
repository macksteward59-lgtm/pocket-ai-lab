/**
 * Director Orchestrator — hybrid multi-agent coordination
 * Preserves APEX/East trust boundaries: agents propose, APEX authorizes.
 *
 * Inference is injected via InferenceProvider so real models can be plugged in
 * without changing orchestration logic. Current default is an honest placeholder.
 */

import { AgentManager, CORE_AGENTS, AgentId } from "../agents/AgentManager";
import { MessageBus, AgentMessage } from "../message-bus/MessageBus";
import { ModelRegistry } from "../model-registry/ModelRegistry";
import { ModelRouter } from "../model-router/ModelRouter";
import { DeliberationEngine } from "../deliberation/DeliberationEngine";
import { MemoryManager } from "../memory/MemoryManager";

export interface TaskRequest {
  id: string;
  objective: string;
  requiredCapabilities: string[];
}

export interface InferenceRequest {
  agentId: string;
  modelId: string;
  prompt: string;
  stage: string;
  contextMessages: AgentMessage[];
}

export interface InferenceResult {
  text: string;
  evidenceRefs?: string[];
  confidence?: number;
}

/** Plug in real llama.cpp / cloud inference here */
export interface InferenceProvider {
  generate(req: InferenceRequest): Promise<InferenceResult>;
}

const placeholderProvider: InferenceProvider = {
  async generate(req) {
    return {
      text: `[placeholder inference for ${req.agentId} at stage ${req.stage}]`,
      confidence: 0.5
    };
  }
};

export class Orchestrator {
  readonly agents = new AgentManager();
  readonly bus = new MessageBus();
  readonly models = new ModelRegistry();
  readonly router: ModelRouter;
  readonly deliberation = new DeliberationEngine();
  readonly memory: MemoryManager;
  private inference: InferenceProvider;

  constructor(opts?: {
    inference?: InferenceProvider;
    getResources?: () => { availableMemoryMB: number; loadedModels: string[] };
    memory?: MemoryManager;
  }) {
    this.inference = opts?.inference ?? placeholderProvider;
    this.router = new ModelRouter(opts?.getResources ?? (() => ({ availableMemoryMB: 4000, loadedModels: [] })));
    this.memory = opts?.memory ?? new MemoryManager();
    CORE_AGENTS.forEach(a => this.agents.registerPermanent(a));
  }

  async executeTask(request: TaskRequest): Promise<{ synthesis: string; evidenceRefs: string[]; consensus: boolean; notes: string[] }> {
    const assigned: AgentId[] = ["director", "reasoner", "engineer", "critic", "validator"];

    const messages: AgentMessage[] = [];
    for (const aid of assigned) {
      const model = await this.router.route(aid, this.models.getPreferredModel(aid), []);
      const session = this.agents.startSession(aid, request.id, model.id);
      const result = await this.inference.generate({
        agentId: aid,
        modelId: model.id,
        prompt: `Independent analysis of: ${request.objective}`,
        stage: "independent",
        contextMessages: []
      });

      const msg: AgentMessage = {
        messageId: crypto.randomUUID(),
        taskId: request.id,
        conversationId: request.id,
        senderAgentId: aid,
        recipientAgentId: "broadcast",
        messageType: "analysis",
        payload: { analysis: result.text, confidence: result.confidence },
        evidenceRefs: result.evidenceRefs ?? [],
        createdAt: new Date().toISOString(),
        sequence: messages.length
      };
      this.bus.publish(msg);
      messages.push(msg);
      this.agents.updateStatus(session, "running");
    }

    const deliberation = await this.deliberation.runCycle(request.id, messages, async (stage, msgs) => {
      // In a full implementation each agent would re-infer based on the stage and prior messages
      return msgs;
    });

    // Do not auto-mark as verified; only the Validator / APEX should do that
    this.memory.write({
      layer: "episodic",
      content: deliberation.finalSynthesis || "Task completed (unverified)",
      provenance: {
        agentId: "director",
        taskId: request.id,
        verified: false,
        sourceRefs: deliberation.evidenceRefs
      }
    });

    return {
      synthesis: deliberation.finalSynthesis || "Synthesized result from multi-agent deliberation",
      evidenceRefs: deliberation.evidenceRefs,
      consensus: deliberation.consensus,
      notes: deliberation.notes
    };
  }
}
