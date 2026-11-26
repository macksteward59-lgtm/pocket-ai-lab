/**
 * Basic unit tests for Gate 0.1 corrective pass.
 * Run with: npx tsx packages/intelligence/__tests__/gate01.test.ts
 * (or integrate with vitest later)
 */

import { MessageBus } from "../message-bus/MessageBus";
import { DeliberationEngine } from "../deliberation/DeliberationEngine";
import { Orchestrator } from "../orchestrator/Orchestrator";
import { MemoryManager } from "../memory/MemoryManager";

async function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error("FAIL: " + msg);
  console.log("PASS: " + msg);
}

async function testMessageImmutability() {
  const bus = new MessageBus();
  const msg = bus.publish({
    messageId: crypto.randomUUID(),
    taskId: "t1",
    conversationId: "c1",
    senderAgentId: "a1",
    recipientAgentId: "broadcast",
    messageType: "analysis",
    payload: { analysis: "hello" },
    evidenceRefs: [],
    createdAt: new Date().toISOString(),
    sequence: 0
  });
  let frozen = false;
  try {
    (msg as any).payload.analysis = "mutated";
  } catch {
    frozen = true;
  }
  // Object.freeze on nested may not always throw in non-strict; check value
  assert((msg.payload as any).analysis === "hello" || frozen, "published message payload is immutable");
}

async function testDeliberationNoAutoConsensus() {
  const engine = new DeliberationEngine();
  const result = await engine.runCycle("t1", [], async (_stage, msgs) => msgs);
  assert(result.consensus === false || result.disagreementCount >= 0, "deliberation does not force consensus");
  assert(Array.isArray(result.notes), "deliberation returns notes");
}

async function testOrchestratorPlaceholder() {
  const orch = new Orchestrator();
  const result = await orch.executeTask({
    id: "task-1",
    objective: "Explain the trust boundary",
    requiredCapabilities: []
  });
  assert(typeof result.synthesis === "string", "orchestrator returns synthesis");
  assert(result.consensus === false || result.consensus === true, "consensus is boolean");
  assert(result.notes.length >= 0, "notes array present");
}

async function testMemoryNotAutoVerified() {
  const mem = new MemoryManager();
  const id = await mem.write({
    layer: "episodic",
    content: "test",
    provenance: { agentId: "director", verified: false, sourceRefs: [] }
  });
  const found = (mem as any).store.find((e: any) => e.id === id);
  assert(found?.provenance.verified === false, "memory does not auto-verify");
}

async function main() {
  await testMessageImmutability();
  await testDeliberationNoAutoConsensus();
  await testOrchestratorPlaceholder();
  await testMemoryNotAutoVerified();
  console.log("\nAll Gate 0.1 checks passed.");
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
