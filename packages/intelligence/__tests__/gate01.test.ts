import { describe, expect, it } from "vitest";
import { MessageBus } from "../message-bus/MessageBus";
import { DeliberationEngine } from "../deliberation/DeliberationEngine";
import { Orchestrator } from "../orchestrator/Orchestrator";
import { MemoryManager } from "../memory/MemoryManager";

describe("Gate 0.1 regression checks", () => {
  it("keeps published message payloads immutable", () => {
    const bus = new MessageBus();
    const message = bus.publish({
      messageId: crypto.randomUUID(),
      taskId: "gate-0.1",
      conversationId: "gate-0.1",
      senderAgentId: "reasoner",
      recipientAgentId: "broadcast",
      messageType: "analysis",
      payload: { analysis: "proposal" },
      evidenceRefs: [],
      createdAt: new Date().toISOString(),
      sequence: 0
    });
    expect(Object.isFrozen(message.payload)).toBe(true);
    expect((message.payload as { analysis: string }).analysis).toBe("proposal");
  });

  it("does not claim consensus without validation", async () => {
    const result = await new DeliberationEngine().runCycle("gate-0.1", [], async () => []);
    expect(result.consensus).toBe(false);
    expect(result.finalSynthesis).toBeUndefined();
  });

  it("requires an explicit inference provider instead of placeholder execution", () => {
    expect(() => new Orchestrator({
      inference: undefined as never,
      getResources: () => ({ availableMemoryMB: 4096, loadedModels: [] })
    })).toThrow(/InferenceProvider must be supplied/);
  });

  it("preserves unverified provenance in memory", async () => {
    const memory = new MemoryManager();
    const id = await memory.write({
      layer: "episodic",
      content: "proposal",
      provenance: { agentId: "director", verified: false, sourceRefs: [] }
    });
    const entry = (memory as unknown as {
      store: Array<{ id: string; provenance: { verified: boolean } }>
    }).store.find(item => item.id === id);
    expect(entry?.provenance.verified).toBe(false);
  });
});
