/**
 * Multi-agent task orchestration.
 * Inference is injected; model output remains untrusted proposal data.
 * This layer never grants permissions or authorizes consequential actions.
 */
import { AgentManager, CORE_AGENTS, AgentId } from "../agents/AgentManager";
import { MessageBus, AgentMessage, MessageType } from "../message-bus/MessageBus";
import { ModelRegistry } from "../model-registry/ModelRegistry";
import { ModelRouter } from "../model-router/ModelRouter";
import { DeliberationEngine, DeliberationStage } from "../deliberation/DeliberationEngine";
import { MemoryManager } from "../memory/MemoryManager";
import { DelegationGate } from "../security/delegation";
import { SecurityDivision, type ApprovalVerifier } from "../security/SecurityDivision";
import { GovernanceUploadInput, GovernanceUploadResult, handleScanTelemetryUpload as reviewScanTelemetry } from "./governanceReview";

export interface TaskRequest {
  id: string;
  objective: string;
  requiredCapabilities: string[];
}

/** Optional response contracts let a provider validate a task-specific payload without overloading deliberation-stage schemas. */
export type InferenceResponseContract = "bug-bounty-policy-review";

/** One earlier chat turn. Untrusted context; never an authorization. */
export interface ConversationTurn {
  role: "user" | "assistant";
  content: string;
}

/** A user-saved memory offered to the model as untrusted reference context. */
export interface MemoryContextItem {
  id: string;
  content: string;
}

export interface InferenceRequest {
  agentId: string;
  modelId: string;
  prompt: string;
  stage: DeliberationStage;
  /** Optional strict provider output shape for specialized advisory workflows. */
  responseContract?: InferenceResponseContract;
  contextMessages: AgentMessage[];
  /** Optional earlier chat turns, oldest first. Providers may ignore it. */
  conversation?: ConversationTurn[];
  /** Optional user-saved memories relevant to this prompt. Providers may ignore it. */
  memoryContext?: MemoryContextItem[];
}

export interface InferenceResult {
  /** Must match the payload schema for the current deliberation stage. */
  payload: unknown;
  evidenceRefs?: string[];
}

export interface InferenceProvider {
  generate(request: InferenceRequest): Promise<InferenceResult>;
}

const STAGE_PLAN: Record<DeliberationStage, AgentId[]> = {
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

export class Orchestrator {
  readonly agents = new AgentManager();
  readonly bus = new MessageBus();
  readonly models = new ModelRegistry();
  readonly router: ModelRouter;
  readonly deliberation: DeliberationEngine;
  readonly memory: MemoryManager;
  /**
   * Security specialist assembly. Tool use is denied unless the caller
   * injects a verifier. This object does not set `authorized`.
   */
  readonly security: SecurityDivision;
  private readonly inference: InferenceProvider;

  constructor(opts: {
    inference: InferenceProvider;
    getResources: () => { availableMemoryMB: number; loadedModels: string[] };
    memory?: MemoryManager;
    maxDeliberationRounds?: number;
    /**
     * Optional gate for specialist tool-use decisions. The default gate
     * denies every request. Not an APEX trust grant.
     */
    delegationGate?: DelegationGate;
    /** Human-approval check for operational-intent tasks. Absent means those tasks are refused. */
    approvalVerifier?: ApprovalVerifier;
  }) {
    if (!opts?.inference || typeof opts.inference.generate !== "function") {
      throw new Error("A real InferenceProvider must be supplied; placeholder inference is disabled");
    }
    if (typeof opts.getResources !== "function") {
      throw new Error("A live resource provider must be supplied");
    }
    this.inference = opts.inference;
    this.router = new ModelRouter(opts.getResources);
    this.deliberation = new DeliberationEngine(opts.maxDeliberationRounds ?? 1);
    this.memory = opts.memory ?? new MemoryManager();
    CORE_AGENTS.forEach(agent => this.agents.registerPermanent(agent));
    this.security = new SecurityDivision({
      agents: this.agents,
      gate: opts.delegationGate ?? new DelegationGate(),
      approvalVerifier: opts.approvalVerifier
    });
  }

  async executeTask(
    request: TaskRequest
  ): Promise<{ synthesis: string; evidenceRefs: string[]; consensus: boolean; notes: string[] }> {
    if (!request.id.trim() || !request.objective.trim()) {
      throw new Error("Task id and objective are required");
    }
    const requiredCapabilities = [...new Set(request.requiredCapabilities ?? [])];
    const deliberation = await this.deliberation.runCycle(
      request.id,
      [],
      async (stage, priorMessages) => {
        const generated: AgentMessage[] = [];
        let nextSequence = this.bus.getThread(request.id).length;
        for (const agentId of STAGE_PLAN[stage]) {
          const agent = this.agents.getAgent(agentId);
          if (!agent) throw new Error("Unknown agent: " + agentId);
          const model = this.models.getPreferredModel(agentId);
          const selected = await this.router.route(agentId, model, requiredCapabilities);
          const sessionId = this.agents.startSession(agentId, request.id, selected.id);
          try {
            this.agents.updateStatus(sessionId, "running");
            const result = await this.inference.generate({
              agentId,
              modelId: selected.id,
              stage,
              prompt: [
                "Task objective: " + request.objective,
                "Your role: " + agent.role,
                "Deliberation stage: " + stage,
                "Return only a structured payload valid for message type " + STAGE_MESSAGE_TYPE[stage] + "."
              ].join("\n"),
              contextMessages: [...priorMessages]
            });
            const message: AgentMessage = {
              messageId: crypto.randomUUID(),
              taskId: request.id,
              conversationId: request.id,
              senderAgentId: agentId,
              recipientAgentId: "broadcast",
              messageType: STAGE_MESSAGE_TYPE[stage],
              payload: result.payload,
              evidenceRefs: result.evidenceRefs ?? [],
              createdAt: new Date().toISOString(),
              sequence: nextSequence++
            };
            generated.push(this.bus.publish(message));
            this.agents.updateStatus(sessionId, "complete");
          } finally {
            this.agents.releaseSession(sessionId);
            this.router.release(selected.id);
          }
        }
        return [...priorMessages, ...generated];
      }
    );

    if (!deliberation.finalSynthesis) {
      throw new Error("The synthesis agent did not produce a valid completion payload");
    }

    await this.memory.write({
      layer: "episodic",
      content: deliberation.finalSynthesis,
      provenance: {
        agentId: "director",
        taskId: request.id,
        verified: false,
        sourceRefs: deliberation.evidenceRefs
      }
    });

    return {
      synthesis: deliberation.finalSynthesis,
      evidenceRefs: deliberation.evidenceRefs,
      consensus: deliberation.consensus,
      notes: deliberation.notes
    };
  }

  /**
   * Non-executing scan-export review.
   * The sidecar decides scope. This method does not contact the target.
   */
  handleScanTelemetryUpload(input: GovernanceUploadInput): Promise<GovernanceUploadResult> {
    return reviewScanTelemetry(this, input);
  }
}
