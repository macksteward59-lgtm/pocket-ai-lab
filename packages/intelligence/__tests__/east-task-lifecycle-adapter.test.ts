import { describe, expect, it } from "vitest";
import {
  InMemoryTaskLifecycleStore,
  TaskLifecycleCoordinator
} from "../autonomy/TaskLifecycleCoordinator";
import { runEastTaskWithLifecycle } from "../autonomy/EastTaskLifecycleAdapter";
import {
  createEastPlatform,
  EAST_DELIBERATION_AGENTS,
  type EastModelBinding,
  type EastPlatformRuntime
} from "../../../src/east/platform";
import type { InferenceRequest, InferenceResult } from "../orchestrator/Orchestrator";

const restartTestModel: EastModelBinding = {
  id: "east-restart-test-model",
  name: "East restart test model",
  runtimePath: "injected-test-runtime",
  contextLength: 4096,
  capabilities: ["reason", "code"],
  memoryEstimateMB: 512
};

function responseFor(request: InferenceRequest): InferenceResult {
  const counterargumentIds = request.contextMessages
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
      return { payload: { revision: "Keep authorization independent.", addressesMessageIds: counterargumentIds } };
    case "verification":
      return { payload: { claim: "Not an approval", verified: true, reason: "Validator agreement is not APEX" } };
    case "synthesis":
      return {
        payload: { synthesis: "Agents proposed a result. Nothing was authorized.", evidenceRefs: ["evidence:restart-test"] },
        evidenceRefs: ["evidence:restart-test"]
      };
    default:
      throw new Error("Unhandled inference stage " + request.stage);
  }
}

function freshEastRuntime(runtimeName: string, generationCalls: string[]): EastPlatformRuntime {
  let nextId = 0;
  return createEastPlatform({
    inference: {
      async generate(request) {
        generationCalls.push(runtimeName + ":" + request.stage + ":" + request.agentId);
        return responseFor(request);
      }
    },
    getResources: () => ({ availableMemoryMB: 8192, loadedModels: [] }),
    model: restartTestModel,
    createId: () => runtimeName + "-id-" + nextId++
  });
}

describe("runEastTaskWithLifecycle", () => {
  it("restores a completed East task and message thread into a fresh runtime without repeating inference", async () => {
    const store = new InMemoryTaskLifecycleStore();
    const generationCalls: string[] = [];
    const firstEast = freshEastRuntime("first-process", generationCalls);
    const firstCoordinator = new TaskLifecycleCoordinator({ store });
    const eastTaskId = "east-restart-safe";
    const lifecycleTaskId = "lifecycle-restart-safe";
    const objective = "Review restart-safe East execution";

    const first = await runEastTaskWithLifecycle({
      coordinator: firstCoordinator,
      east: firstEast,
      eastTaskId,
      lifecycleTaskId,
      objective
    });

    const originalTask = firstEast.getTask(eastTaskId);
    const originalThread = [...firstEast.orchestrator.bus.getThread(eastTaskId)];
    const originalGenerationCount = generationCalls.length;
    expect(originalTask.assignments.map(item => item.agentId)).toEqual([...EAST_DELIBERATION_AGENTS]);
    expect(originalThread.length).toBeGreaterThan(EAST_DELIBERATION_AGENTS.length);
    expect(new Set(originalThread.map(message => message.messageId)).size).toBe(originalThread.length);
    expect(first.lifecycle.status).toBe("completed");
    expect(first.lifecycle.steps.every(step => step.status === "succeeded")).toBe(true);
    expect(first.authorized).toBe(false);
    expect(originalTask.authorized).toBe(false);

    // This is a different EastPlatformRuntime with a new task map, Orchestrator,
    // MessageBus, and TaskLifecycleCoordinator. Only the shared lifecycle store
    // survives, matching the adapter's persisted-checkpoint contract.
    const secondEast = freshEastRuntime("second-process", generationCalls);
    const secondCoordinator = new TaskLifecycleCoordinator({ store });
    expect(() => secondEast.getTask(eastTaskId)).toThrow("Unknown task");

    const resumed = await runEastTaskWithLifecycle({
      coordinator: secondCoordinator,
      east: secondEast,
      eastTaskId,
      lifecycleTaskId,
      objective
    });

    expect(secondEast.getTask(eastTaskId)).toEqual(originalTask);
    expect(secondEast.orchestrator.bus.getThread(eastTaskId)).toEqual(originalThread);
    expect(resumed.lifecycle.status).toBe("completed");
    expect(resumed.synthesis).toBe(first.synthesis);
    expect(resumed.evidenceRefs).toEqual(first.evidenceRefs);
    expect(resumed.authorized).toBe(false);
    expect(generationCalls).toHaveLength(originalGenerationCount);
    expect(generationCalls.every(call => call.startsWith("first-process:"))).toBe(true);
  });

  it("rejects a reused lifecycle ID bound to a different objective without executing East", async () => {
    let executions = 0;
    const east = {
      getTask: () => ({ id: "east-3", objective: "Current objective" }),
      assignAgent: () => { executions += 1; return "east-3"; },
      executeAgent: async () => { executions += 1; return "unexpected"; },
      runDeliberation: async () => { executions += 1; return { synthesis: "unexpected", evidence: [] }; },
      commitTaskEvidence: async () => { executions += 1; return false; }
    } as unknown as EastPlatformRuntime;
    const store = new InMemoryTaskLifecycleStore();
    const coordinator = new TaskLifecycleCoordinator({ store });
    await coordinator.init();
    await coordinator.createTask({
      id: "lifecycle-3",
      objective: "Different objective",
      steps: [{ id: "placeholder", description: "Existing unrelated work" }],
      metadata: { eastTaskId: "east-3", workflow: "east-eight-agent-deliberation-v1" }
    });

    await expect(runEastTaskWithLifecycle({
      coordinator, east, eastTaskId: "east-3", lifecycleTaskId: "lifecycle-3",
      objective: "Current objective"
    })).rejects.toThrow("Existing lifecycle task does not match this East workflow definition");
    expect(executions).toBe(0);
    expect(coordinator.getTask("lifecycle-3").objective).toBe("Different objective");
  });

  it("fails closed and does not retry an agent generation after a provider failure", async () => {
    let attempts = 0;
    const east = {
      getTask: () => ({
        id: "east-2", objective: "Test failure", assignments: [],
        synthesis: null, evidenceRefs: [], evidenceGate: { status: "not_submitted" },
        apexDecision: { status: "unread" }, authorized: false
      }),
      checkpointTask: () => ({
        version: 1 as const,
        task: {
          id: "east-2", objective: "Test failure", assignments: [],
          synthesis: null, evidenceRefs: [], evidenceGate: { status: "not_submitted" as const },
          apexDecision: { status: "unread" as const }, authorized: false as const
        },
        messages: [],
        evidenceMemoryCommitted: false
      }),
      restoreTask: () => undefined,
      assignAgent: () => "east-2",
      executeAgent: async () => { attempts += 1; throw new Error("provider unavailable"); },
      runDeliberation: async () => ({ synthesis: "never", evidence: [] }),
      commitTaskEvidence: async () => false
    } as unknown as EastPlatformRuntime;
    const coordinator = new TaskLifecycleCoordinator({ store: new InMemoryTaskLifecycleStore() });

    await expect(runEastTaskWithLifecycle({
      coordinator, east, eastTaskId: "east-2", lifecycleTaskId: "lifecycle-2",
      objective: "Test failure"
    })).rejects.toThrow("provider unavailable");
    expect(attempts).toBe(1);
    expect(coordinator.getTask("lifecycle-2").status).toBe("failed");
    expect(coordinator.getTask("lifecycle-2").steps.find(step => step.id === "execute-director")?.attempts).toBe(1);
  });
});
