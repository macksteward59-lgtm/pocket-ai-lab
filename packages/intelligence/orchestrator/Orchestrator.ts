/**
 * Director Orchestrator — hybrid multi-agent coordination
 * Preserves APEX/East trust boundaries: agents propose, APEX authorizes.
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

export class Orchestrator {
  readonly agents = new AgentManager();
  readonly bus = new MessageBus();
  readonly models = new ModelRegistry();
  readonly router = new ModelRouter(() => ({ availableMemoryMB: 4000, loadedModels: [] }));
  readonly deliberation = new DeliberationEngine();
  readonly memory = new MemoryManager();

  constructor() {
    CORE_AGENTS.forEach(a => this.agents.registerPermanent(a));
  }

  async executeTask(request: TaskRequest): Promise<{ synthesis: string; evidenceRefs: string[] }> {
    const director = this.agents.getAgent("director")!;
    // 1. Assign core or create specialist
    const assigned: AgentId[] = ["director", "reasoner", "engineer", "critic", "validator"];

    // 2. Independent analysis phase via message bus
    const messages: AgentMessage[] = [];
    for (const aid of assigned) {
      const model = await this.router.route(aid, this.models.getPreferredModel(aid), []);
      const session = this.agents.startSession(aid, request.id, model.id);
      const msg: AgentMessage = {
        messageId: crypto.randomUUID(),
        taskId: request.id,
        conversationId: request.id,
        senderAgentId: aid,
        recipientAgentId: "broadcast",
        messageType: "analysis",
        payload: { analysis: `Analysis from ${aid} using ${model.name}` },
        evidenceRefs: [],
        createdAt: new Date().toISOString(),
        sequence: messages.length
      };
      this.bus.publish(msg);
      messages.push(msg);
      this.agents.updateStatus(session, "running");
    }

    // 3. Deliberation
    const result = await this.deliberation.runCycle(request.id, messages, async (stage, msgs) => {
      // In real system, this would call model inference via platform fn
      return msgs;
    });

    // 4. Store in memory with provenance
    this.memory.write({
      layer: "episodic",
      content: result.finalSynthesis || "Task completed",
      provenance: { agentId: "director", taskId: request.id, verified: true, sourceRefs: result.evidenceRefs }
    });

    // 5. Release non-permanent
    // (sessions released by agent manager)

    return {
      synthesis: result.finalSynthesis || "Synthesized result from multi-agent deliberation",
      evidenceRefs: result.evidenceRefs
    };
  }
}
