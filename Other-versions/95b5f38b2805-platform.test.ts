import { describe, expect, it } from "vitest";
import type { InferenceRequest, InferenceResult } from "../../packages/intelligence/orchestrator/Orchestrator";
import { compilePocketAILabTask, EastPlatformError, createEastPlatform } from "./index";
import type { EastModelBinding, EastPlatformRuntime } from "./platform";

const model: EastModelBinding = {
  id: "test-model",
  name: "Test model",
  runtimePath: "injected-runtime",
  contextLength: 4096,
  capabilities: ["reason", "code"],
  memoryEstimateMB: 512
};

function payloadFor(request: InferenceRequest): InferenceResult {
  const ids = request.contextMessages
    .filter(message => message.messageType === "counterargument")
    .map(message => message.messageId);
  switch (request.stage) {
    case "independent":
      return { payload: { analysis: "Analysis from " + request.agentId, confidence: 0.4 } };
    case "cross-review":
      return { payload: { question: "Who authorizes this?" } };
    case "challenge":
      return { payload: { claim: "The proposal is sound", objection: "No independent receipt exists", evidenceRefs: [] } };
    case "revision":
      return { payload: { revision: "Keep authorization independent.", addressesMessageIds: ids } };
    case "verification":
      return { payload: { claim: "Not an approval", verified: true, reason: "Validator agreement is not APEX" } };
    case "synthesis":
      return {
        payload: { synthesis: "Agents proposed a result. Nothing was authorized.", evidenceRefs: ["ref-1"] },
        evidenceRefs: ["ref-1"]
      };
    default:
      throw new Error("Unhandled stage " + request.stage);
  }
}

function runtime(overrides: Partial<Parameters<typeof createEastPlatform>[0]> = {}): EastPlatformRuntime {
  const calls: InferenceRequest[] = [];
  const platform = createEastPlatform({
    inference: overrides.inference ?? {
      async generate(request) {
        calls.push(request);
        return payloadFor(request);
      }
    },
    getResources: overrides.getResources ?? (() => ({ availableMemoryMB: 8192, loadedModels: [] })),
    model: overrides.model ?? model,
    memory: overrides.memory,
    createId: overrides.createId ?? (() => "fixed")
  });
  return Object.assign(platform, { calls });
}

function assignTeam(platform: EastPlatformRuntime, taskId: string): void {
  for (const agentId of ["director", "reasoner", "researcher", "engineer", "critic", "validator"]) {
    platform.assignAgent(taskId, agentId);
  }
}

describe("East platform functions", () => {
  it("rejects a missing provider, a blank objective, and an oversized objective", () => {
    expect(() => createEastPlatform({
      inference: undefined as never,
      getResources: () => ({ availableMemoryMB: 1, loadedModels: [] }),
      model
    })).toThrow(EastPlatformError);
    const platform = runtime();
    expect(() => platform.createAgentTask("  ")).toThrow(expect.objectContaining({ code: "invalid_objective" }));
    expect(() => platform.createAgentTask("x".repeat(8001))).toThrow(expect.objectContaining({ code: "invalid_objective" }));
  });

  it("creates a task, assigns only permanent agents, and is idempotent", () => {
    const platform = runtime();
    const taskId = platform.createAgentTask("  Protect the boundary  ");
    expect(taskId).toBe("task-fixed");
    expect(platform.getTask(taskId).objective).toBe("Protect the boundary");
    expect(platform.getTask(taskId).authorized).toBe(false);
    expect(() => platform.assignAgent("missing", "reasoner")).toThrow(expect.objectContaining({ code: "unknown_task" }));
    expect(() => platform.assignAgent(taskId, "specialist-made-up")).toThrow(expect.objectContaining({ code: "unknown_agent" }));
    expect(platform.assignAgent(taskId, "security")).toBe(taskId);
    expect(platform.assignAgent(taskId, "security")).toBe(taskId);
    expect(platform.getTask(taskId).assignments[0].id.startsWith("asg-")).toBe(true);
    expect(platform.getTask(taskId).assignments.map(item => item.agentId)).toEqual(["security"]);
    expect(() => {
      (platform.getTask(taskId) as { authorized: boolean }).authorized = true;
    }).toThrow();
  });

  it("denies execution until the agent is assigned and when the model output is rejected", async () => {
    const platform = runtime();
    const taskId = platform.createAgentTask("Check one agent");
    await expect(platform.executeAgent(taskId, "reasoner")).rejects.toMatchObject({ code: "not_assigned" });
    platform.assignAgent(taskId, "reasoner");
    const denied = createEastPlatform({
      inference: { async generate() { return { payload: { nope: true } }; } },
      getResources: () => ({ availableMemoryMB: 8192, loadedModels: [] }),
      model,
      createId: () => "denied"
    });
    const deniedTask = denied.createAgentTask("Reject the payload");
    denied.assignAgent(deniedTask, "reasoner");
    await expect(denied.executeAgent(deniedTask, "reasoner")).rejects.toMatchObject({ code: "inference_denied" });
    expect(denied.orchestrator.bus.getThread(deniedTask)).toHaveLength(0);
    expect(denied.getTask(deniedTask).authorized).toBe(false);
  });

  it("publishes one analysis and fails closed when inference or memory is unavailable", async () => {
    const seen: InferenceRequest[] = [];
    const platform = runtime({
      inference: {
        async generate(request) {
          seen.push(request);
          if (request.prompt.includes("fail")) throw new Error("backend down");
          return { payload: { analysis: "Separate proposal from permission." } };
        }
      }
    });
    const taskId = platform.createAgentTask("One turn");
    platform.assignAgent(taskId, "reasoner");
    const messageId = await platform.executeAgent(taskId, "reasoner");
    const thread = platform.orchestrator.bus.getThread(taskId);
    expect(thread).toHaveLength(1);
    expect(thread[0].messageId).toBe(messageId);
    expect(thread[0].messageType).toBe("analysis");
    expect(seen[0].modelId).toBe("test-model");
    expect(seen[0].prompt).toContain("not permission");

    const failing = runtime({
      createId: () => "down",
      inference: { async generate() { throw new Error("backend down"); } }
    });
    const failingTask = failing.createAgentTask("fail");
    failing.assignAgent(failingTask, "reasoner");
    await expect(failing.executeAgent(failingTask, "reasoner")).rejects.toMatchObject({ code: "inference_denied" });
    expect(failing.orchestrator.bus.getThread(failingTask)).toHaveLength(0);

    const starved = runtime({
      createId: () => "starved",
      getResources: () => ({ availableMemoryMB: 0, loadedModels: [] })
    });
    const starvedTask = starved.createAgentTask("No memory");
    starved.assignAgent(starvedTask, "reasoner");
    await expect(starved.executeAgent(starvedTask, "reasoner")).rejects.toMatchObject({ code: "inference_denied" });
    expect(starved.getTask(starvedTask).authorized).toBe(false);
  });

  it("refuses deliberation until the core team is assigned", async () => {
    const platform = runtime();
    const taskId = platform.createAgentTask("Need the team");
    platform.assignAgent(taskId, "security");
    await expect(platform.runDeliberation(taskId)).rejects.toMatchObject({ code: "not_assigned" });
    expect(platform.getTask(taskId).synthesis).toBeNull();
  });

  it("keeps authorization false after consensus and stores only unverified evidence", async () => {
    const platform = runtime({ createId: () => "delib" });
    const taskId = platform.createAgentTask("Show the boundary");
    assignTeam(platform, taskId);
    const result = await platform.runDeliberation(taskId);
    expect(result.synthesis).toBe("Agents proposed a result. Nothing was authorized.");
    expect(result.evidence).toEqual(["ref-1"]);
    expect(platform.orchestrator.bus.getThread(taskId).length).toBeGreaterThan(0);
    expect(platform.getTask(taskId).authorized).toBe(false);

    await expect(platform.commitTaskEvidence(taskId, "tampered synthesis")).resolves.toBe(false);
    const beforeAccept = await platform.memory.list();
    expect(beforeAccept.every(entry => entry.provenance.verified === false)).toBe(true);
    const tamperedCount = beforeAccept.length;

    await expect(platform.commitTaskEvidence(taskId, result.synthesis)).resolves.toBe(false);
    await expect(platform.commitTaskEvidence(taskId, result.synthesis)).resolves.toBe(false);
    const after = await platform.memory.list();
    expect(after.length).toBe(tamperedCount + 1);
    expect(after.every(entry => entry.provenance.verified === false)).toBe(true);
    expect(platform.getTask(taskId).authorized).toBe(false);
    expect(after.some(entry => entry.provenance.verified === true)).toBe(false);
  });

  it("does not store evidence or return true when deliberation never produced a synthesis", async () => {
    const platform = runtime({ createId: () => "empty" });
    const taskId = platform.createAgentTask("No synthesis yet");
    await expect(platform.commitTaskEvidence(taskId, "Invented synthesis")).resolves.toBe(false);
    expect(await platform.memory.list()).toEqual([]);
    expect(platform.getTask(taskId).authorized).toBe(false);
  });

  it("runs the East task through the compiled platform and still reports authorized false", async () => {
    let sequence = 0;
    const platform = runtime({ createId: () => "compiled-" + sequence++ });
    const run = compilePocketAILabTask(platform);
    const output = await run("Compile the boundary");
    expect(output.authorized).toBe(false);
    expect(output.synthesis).toBe("Agents proposed a result. Nothing was authorized.");
    expect(output.evidenceRefs).toEqual(["ref-1"]);
    expect(output.taskId.startsWith("task-")).toBe(true);
    const stored = await platform.memory.list();
    expect(stored.length).toBeGreaterThan(0);
    expect(stored.every(entry => entry.provenance.verified === false)).toBe(true);
    expect(platform.getTask(output.taskId).authorized).toBe(false);
  });
});
