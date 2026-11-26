import { describe, expect, it } from "vitest";
import { AgentManager, CORE_AGENTS } from "../agents/AgentManager";
import { DeliberationEngine, DeliberationStage } from "../deliberation/DeliberationEngine";
import { AgentMessage, AgentMessageSchema, MessageBus } from "../message-bus/MessageBus";
import { ModelDescriptor } from "../model-registry/ModelRegistry";
import { ModelRouter } from "../model-router/ModelRouter";
import { Orchestrator } from "../orchestrator/Orchestrator";

function message(
  messageType: AgentMessage["messageType"],
  senderAgentId: string,
  payload: unknown,
  sequence: number
): AgentMessage {
  return {
    protocolVersion: 1,
    messageId: crypto.randomUUID(),
    taskId: "task-1",
    conversationId: "task-1",
    senderAgentId,
    recipientAgentId: "broadcast",
    messageType,
    payload,
    evidenceRefs: [],
    createdAt: new Date().toISOString(),
    sequence
  };
}

const model: ModelDescriptor = {
  id: "test-model",
  name: "Test Model",
  path: "./models/test.gguf",
  contextLength: 4096,
  capabilities: ["reason", "code"],
  memoryEstimateMB: 512
};

describe("MessageBus", () => {
  it("rejects a payload that does not match its message type", () => {
    expect(() => AgentMessageSchema.parse(message("analysis", "reasoner", { wrong: true }, 0)))
      .toThrow();
  });

  it("deep-freezes published messages and nested payloads", () => {
    const bus = new MessageBus();
    const published = bus.publish(message(
      "analysis", "reasoner", { analysis: "Reasoned result", confidence: 0.8 }, 0
    ));
    expect(Object.isFrozen(published)).toBe(true);
    expect(Object.isFrozen(published.payload)).toBe(true);
    expect(() => {
      (published.payload as { analysis: string }).analysis = "tampered";
    }).toThrow();
  });

  it("delivers broadcast messages and supports unsubscribe", () => {
    const bus = new MessageBus();
    let received = 0;
    const unsubscribe = bus.subscribe("validator", () => received++);
    bus.publish(message("analysis", "reasoner", { analysis: "A" }, 0));
    unsubscribe();
    bus.publish(message("analysis", "reasoner", { analysis: "B" }, 1));
    expect(received).toBe(1);
  });
});

describe("AgentManager", () => {
  it("rejects sessions for unknown agents and releases known sessions", () => {
    const manager = new AgentManager();
    expect(() => manager.startSession("missing", "task", "model")).toThrow();
    manager.registerPermanent(CORE_AGENTS[0]);
    const session = manager.startSession("director", "task", "model");
    manager.updateStatus(session, "running");
    expect(() => manager.updateStatus("missing-session", "complete")).toThrow();
    manager.releaseSession(session);
    expect(manager.getAgent("director")).toBeDefined();
  });
});

describe("ModelRouter", () => {
  it("fails closed when no model is configured", async () => {
    const router = new ModelRouter(() => ({ availableMemoryMB: 4096, loadedModels: [] }));
    await expect(router.route("reasoner", undefined, [])).rejects.toThrow(/No model is registered/);
  });

  it("checks capabilities and available memory before reserving", async () => {
    const router = new ModelRouter(() => ({ availableMemoryMB: 1024, loadedModels: [] }));
    await expect(router.route("reasoner", model, ["vision"])).rejects.toThrow(/lacks required capabilities/);
    await expect(router.route("reasoner", model, ["reason", "code"])).resolves.toEqual(model);
    expect(router.getLoadedModels()).toEqual(["test-model"]);
    router.release(model);
    expect(router.getLoadedModels()).toEqual([]);
  });

  it("keeps a shared model reservation until every concurrent route releases it", async () => {
    const router = new ModelRouter(() => ({ availableMemoryMB: 1024, loadedModels: [] }));
    const [first, second] = await Promise.all([
      router.route("reasoner", model, []),
      router.route("researcher", model, [])
    ]);
    expect(first).toBe(model);
    expect(second).toBe(model);
    expect(router.getLoadedModels()).toEqual(["test-model"]);
    router.release(first);
    expect(router.getLoadedModels()).toEqual(["test-model"]);
    router.release(second);
    expect(router.getLoadedModels()).toEqual([]);
  });

  it("keeps shared model memory reserved until the final concurrent holder releases it", async () => {
    const router = new ModelRouter(() => ({ availableMemoryMB: 1024, loadedModels: [] }));
    const otherModel = { ...model, id: "other-model", memoryEstimateMB: 600 };
    const [first, second] = await Promise.all([
      router.route("reasoner", model, []),
      router.route("researcher", model, [])
    ]);
    router.release(first);
    await expect(router.route("engineer", otherModel, [])).rejects.toThrow(/Insufficient memory/);
    router.release(second);
    const otherLease = await router.route("engineer", otherModel, []);
    expect(otherLease).toBe(otherModel);
    router.release(otherLease);
  });

  it("rejects a new descriptor for an active ID unless the old generation was retired", async () => {
    const router = new ModelRouter(() => ({ availableMemoryMB: 1024, loadedModels: [] }));
    const original = { ...model };
    const lease = await router.route("reasoner", original, []);
    const unretiredReplacement = { ...original, path: "./replacement.gguf" };
    await expect(router.route("researcher", unretiredReplacement, []))
      .rejects.toThrow(/changed its descriptor while routes are active/);
    router.release(lease);
  });

  it("accounts for replacement generations while old concurrent leases drain", async () => {
    const resources = { availableMemoryMB: 1024, loadedModels: [] as string[] };
    const router = new ModelRouter(() => resources);
    const oldModel = { ...model, memoryEstimateMB: 256 };
    const replacement = { ...model, path: "./replacement.gguf", memoryEstimateMB: 1536 };
    const first = await router.route("reasoner", oldModel, []);
    const second = await router.route("researcher", oldModel, []);
    router.retire(oldModel.id, oldModel);
    await expect(router.route("engineer", oldModel, [])).rejects.toThrow(/retired/);
    await expect(router.route("engineer", replacement, [])).rejects.toThrow(/being replaced/);
    router.release(first);
    await expect(router.route("engineer", replacement, [])).rejects.toThrow(/being replaced/);
    router.release(second);
    await expect(router.route("engineer", oldModel, [])).rejects.toThrow(/retired/);
    await expect(router.route("engineer", replacement, [])).rejects.toThrow(/Insufficient memory/);
    expect(router.getLoadedModels()).toEqual([]);

    resources.availableMemoryMB = 2048;
    const replacementLease = await router.route("engineer", replacement, []);
    router.release(first); // stale duplicate release for the old descriptor
    expect(router.getLoadedModels()).toEqual(["test-model"]);
    router.release(replacementLease);
    expect(router.getLoadedModels()).toEqual([]);
  });

  it("keeps a replaced ID invalid until successful inference confirms the new generation", async () => {
    const resources = { availableMemoryMB: 1024, loadedModels: ["test-model"] };
    const router = new ModelRouter(() => resources);
    const oldModel = { ...model, memoryEstimateMB: 256 };
    const replacement = { ...model, path: "./replacement.gguf", memoryEstimateMB: 512 };
    router.retire("test-model", oldModel);

    const first = await router.route("reasoner", replacement, []);
    router.release(first);
    resources.availableMemoryMB = 128;
    await expect(router.route("reasoner", replacement, [])).rejects.toThrow(/Insufficient memory/);

    resources.availableMemoryMB = 1024;
    const loaded = await router.route("reasoner", replacement, []);
    router.confirmLoaded(loaded);
    router.release(loaded);
    resources.availableMemoryMB = 128;
    const reused = await router.route("reasoner", replacement, []);
    expect(reused).toBe(replacement);
    router.release(reused);
  });

  it("rejects malformed resource-provider loaded-model data", async () => {
    const router = new ModelRouter(() => ({ availableMemoryMB: 1024, loadedModels: [null] as unknown as string[] }));
    await expect(router.route("reasoner", model, [])).rejects.toThrow(/invalid loaded-model list/);
  });

  it("rejects insufficient memory rather than waiting forever", async () => {
    const router = new ModelRouter(() => ({ availableMemoryMB: 128, loadedModels: [] }));
    await expect(router.route("reasoner", model, [])).rejects.toThrow(/Insufficient memory/);
  });
});

describe("DeliberationEngine", () => {
  it("does not infer consensus from silence or absent validation", async () => {
    const engine = new DeliberationEngine(0);
    const result = await engine.runCycle("task-1", [], async (stage: DeliberationStage) => {
      if (stage === "synthesis") {
        return [message("completion", "director", { synthesis: "Proposed answer", evidenceRefs: [] }, 0)];
      }
      return [];
    });
    expect(result.consensus).toBe(false);
    expect(result.notes.some(note => note.includes("Validator"))).toBe(true);
  });

  it("requires objections to be addressed and validator affirmation", async () => {
    const engine = new DeliberationEngine(1);
    let objection: AgentMessage | undefined;
    const result = await engine.runCycle("task-1", [], async (stage: DeliberationStage, prior) => {
      let generated: AgentMessage[] = [];
      if (stage === "challenge") {
        objection = message("counterargument", "critic", {
          claim: "Claim", objection: "Evidence is missing", evidenceRefs: []
        }, prior.length);
        generated = [objection];
      } else if (stage === "revision") {
        generated = [message("revision", "engineer", {
          revision: "Addressed the concern",
          addressesMessageIds: [objection!.messageId]
        }, prior.length)];
      } else if (stage === "verification") {
        generated = [message("validation", "validator", {
          claim: "Revised result", verified: true
        }, prior.length)];
      } else if (stage === "synthesis") {
        generated = [message("completion", "director", {
          synthesis: "Final result", evidenceRefs: []
        }, prior.length)];
      }
      return [...prior, ...generated];
    });
    expect(result.consensus).toBe(true);
    expect(result.disagreementCount).toBe(0);
    expect(result.finalSynthesis).toBe("Final result");
  });
});


describe("Orchestrator", () => {
  it("requires a real injected inference provider", () => {
    expect(() => new Orchestrator({
      inference: undefined as never,
      getResources: () => ({ availableMemoryMB: 4096, loadedModels: [] })
    })).toThrow(/InferenceProvider must be supplied/);
  });

  it("releases the exact model reservation when provider inference fails", async () => {
    const orchestrator = new Orchestrator({
      getResources: () => ({ availableMemoryMB: 8192, loadedModels: [] }),
      inference: {
        async generate() {
          throw new Error("provider unavailable");
        }
      }
    });
    orchestrator.models.register(model);
    for (const agentId of ["director", "reasoner", "researcher", "engineer", "critic", "validator"]) {
      orchestrator.models.associateAgent(agentId, model.id);
    }

    await expect(orchestrator.executeTask({
      id: "provider-failure",
      objective: "Exercise failure cleanup",
      requiredCapabilities: []
    })).rejects.toThrow(/provider unavailable/);
    expect(orchestrator.router.getLoadedModels()).toEqual([]);
  });

  it("executes each stage through the injected provider and records unverified synthesis", async () => {
    const orchestrator = new Orchestrator({
      maxDeliberationRounds: 1,
      getResources: () => ({ availableMemoryMB: 8192, loadedModels: [] }),
      inference: {
        async generate(request) {
          switch (request.stage) {
            case "independent":
              return { payload: { analysis: "Analysis from " + request.agentId } };
            case "cross-review":
              return { payload: { question: "What evidence supports this?" } };
            case "challenge":
              return { payload: { claim: "Core claim", objection: "Needs support", evidenceRefs: [] } };
            case "revision":
              return {
                payload: {
                  revision: "Addressed the objection",
                  addressesMessageIds: request.contextMessages
                    .filter(item => item.messageType === "counterargument")
                    .map(item => item.messageId)
                }
              };
            case "verification":
              return { payload: { claim: "Revised claim", verified: true } };
            case "synthesis":
              return { payload: { synthesis: "Integrated result", evidenceRefs: [] } };
            default:
              throw new Error("Unhandled deliberation stage");
          }
        }
      }
    });

    orchestrator.models.register(model);
    for (const agentId of ["director", "reasoner", "researcher", "engineer", "critic", "validator"]) {
      orchestrator.models.associateAgent(agentId, model.id);
    }

    const result = await orchestrator.executeTask({
      id: "orchestration-test",
      objective: "Verify the multi-agent execution path",
      requiredCapabilities: []
    });

    expect(result.synthesis).toBe("Integrated result");
    expect(result.consensus).toBe(true);
    const thread = orchestrator.bus.getThread("orchestration-test");
    expect(thread).toHaveLength(10);
    expect(thread.map(item => item.sequence)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });
});
