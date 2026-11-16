import { describe, expect, it } from "vitest";
import {
  InMemoryTaskLifecycleStore,
  TaskLifecycleCoordinator
} from "../autonomy/TaskLifecycleCoordinator";
import { runEastTaskWithLifecycle } from "../autonomy/EastTaskLifecycleAdapter";
import { EAST_DELIBERATION_AGENTS, type EastPlatformRuntime } from "../../../src/east/platform";

describe("runEastTaskWithLifecycle", () => {
  it("runs the eight-agent East workflow through leased lifecycle steps without granting authority", async () => {
    const assignments: string[] = [];
    const executions: string[] = [];
    let committed = 0;
    let taskExists = true;
    const eastTask = {
      id: "east-1",
      objective: "Review the integration architecture",
      assignments: [] as { id: string; agentId: string }[],
      synthesis: null as string | null,
      evidenceRefs: [] as string[],
      evidenceGate: { status: "not_submitted" as const },
      apexDecision: { status: "unread" as const },
      authorized: false as const
    };
    const east = {
      createAgentTask: () => "east-1",
      assignAgent: (_taskId: string, agentId: string) => {
        assignments.push(agentId);
        eastTask.assignments.push({ id: "assignment-" + agentId, agentId });
        return "east-1";
      },
      executeAgent: async (_taskId: string, agentId: string) => { executions.push(agentId); return "message-" + agentId; },
      runDeliberation: async () => {
        eastTask.synthesis = "Unverified synthesis";
        eastTask.evidenceRefs = ["evidence:one"];
        return { synthesis: "Unverified synthesis", evidence: ["evidence:one"] };
      },
      commitTaskEvidence: async () => { committed += 1; return false as const; },
      readApexDecision: async () => ({ status: "unread" as const }),
      getTask: () => {
        if (!taskExists) throw Object.assign(new Error("Unknown task"), { code: "unknown_task" });
        return eastTask;
      },
      checkpointTask: () => ({
        version: 1 as const,
        task: { ...eastTask, assignments: [...eastTask.assignments], evidenceRefs: [...eastTask.evidenceRefs] },
        messages: [],
        evidenceMemoryCommitted: committed > 0
      }),
      restoreTask: (checkpoint: { task: typeof eastTask }) => {
        Object.assign(eastTask, checkpoint.task);
        taskExists = true;
      },
      orchestrator: {} as EastPlatformRuntime["orchestrator"],
      memory: {} as EastPlatformRuntime["memory"]
    } as unknown as EastPlatformRuntime;
    const store = new InMemoryTaskLifecycleStore();
    const coordinator = new TaskLifecycleCoordinator({ store });

    const result = await runEastTaskWithLifecycle({
      coordinator, east, eastTaskId: "east-1", lifecycleTaskId: "lifecycle-1",
      objective: "Review the integration architecture"
    });

    expect(assignments).toEqual([...EAST_DELIBERATION_AGENTS]);
    expect(executions).toEqual([...EAST_DELIBERATION_AGENTS]);
    expect(committed).toBe(1);
    expect(result.lifecycle.status).toBe("completed");
    expect(result.lifecycle.steps.every(step => step.status === "succeeded")).toBe(true);
    expect(result.synthesis).toBe("Unverified synthesis");
    expect(result.evidenceRefs).toEqual(["evidence:one"]);
    expect(result.authorized).toBe(false);
    expect(result.evidenceGate.status).toBe("not_submitted");

    // A fresh coordinator instance models process-level re-entry against the
    // same durable-store contract. Completed inference and evidence steps must
    // be returned from lifecycle state, not executed a second time.
    const resumedCoordinator = new TaskLifecycleCoordinator({ store });
    // Simulate a new East process: its in-memory task map is gone, but the
    // durable lifecycle snapshot contains the completed task and thread.
    taskExists = false;
    const resumed = await runEastTaskWithLifecycle({
      coordinator: resumedCoordinator, east, eastTaskId: "east-1",
      lifecycleTaskId: "lifecycle-1", objective: "Review the integration architecture"
    });
    expect(resumed.lifecycle.status).toBe("completed");
    expect(resumed.synthesis).toBe("Unverified synthesis");
    expect(resumed.evidenceRefs).toEqual(["evidence:one"]);
    expect(assignments).toEqual([...EAST_DELIBERATION_AGENTS]);
    expect(executions).toEqual([...EAST_DELIBERATION_AGENTS]);
    expect(committed).toBe(1);

    const corrupted = store.load();
    const firstCompleted = corrupted[0].steps.find(step => step.status === "succeeded");
    if (!firstCompleted?.result) throw new Error("Expected a stored East checkpoint");
    firstCompleted.result = firstCompleted.result.replace('"kind":"assign-core-agents"', '"kind":"wrong-step"');
    store.save(corrupted);
    taskExists = false;
    const corruptCoordinator = new TaskLifecycleCoordinator({ store });
    await expect(runEastTaskWithLifecycle({
      coordinator: corruptCoordinator, east, eastTaskId: "east-1",
      lifecycleTaskId: "lifecycle-1", objective: "Review the integration architecture"
    })).rejects.toThrow(/checkpoint is corrupt/);
    expect(assignments).toEqual([...EAST_DELIBERATION_AGENTS]);
    expect(executions).toEqual([...EAST_DELIBERATION_AGENTS]);
    expect(committed).toBe(1);
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
