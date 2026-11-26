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

  it("keeps the durable attempt running until an aborted East provider call drains", async () => {
    let releaseDrain!: () => void;
    let providerStarted!: () => void;
    let receivedSignal: AbortSignal | undefined;
    const started = new Promise<void>(resolve => { providerStarted = resolve; });
    const assignments: string[] = [];
    const eastTask = {
      id: "east-cancel", objective: "Cancel only after provider drain",
      assignments: [] as { id: string; agentId: string }[],
      synthesis: null as string | null, evidenceRefs: [] as string[],
      evidenceGate: { status: "not_submitted" as const },
      apexDecision: { status: "unread" as const }, authorized: false as const
    };
    const east = {
      getTask: () => eastTask,
      assignAgent: (_taskId: string, agentId: string) => {
        assignments.push(agentId);
        eastTask.assignments.push({ id: "assignment-" + agentId, agentId });
        return eastTask.id;
      },
      executeAgent: async (_taskId: string, _agentId: string, options?: { signal?: AbortSignal }) => {
        receivedSignal = options?.signal;
        providerStarted();
        await new Promise<void>(resolve => { releaseDrain = resolve; });
        if (options?.signal?.aborted) {
          const error = new Error("provider settled after abort");
          error.name = "AbortError";
          throw error;
        }
        return "unexpected-message";
      },
      runDeliberation: async () => ({ synthesis: "unused", evidence: [] }),
      commitTaskEvidence: async () => false as const,
      checkpointTask: () => ({
        version: 1 as const,
        task: { ...eastTask, assignments: [...eastTask.assignments], evidenceRefs: [...eastTask.evidenceRefs] },
        messages: [],
        evidenceMemoryCommitted: false
      }),
      restoreTask: () => undefined,
      orchestrator: {} as EastPlatformRuntime["orchestrator"],
      memory: {} as EastPlatformRuntime["memory"]
    } as unknown as EastPlatformRuntime;
    const store = new InMemoryTaskLifecycleStore();
    const coordinator = new TaskLifecycleCoordinator({ store });
    const controller = new AbortController();
    const pending = runEastTaskWithLifecycle({
      coordinator, east, eastTaskId: eastTask.id, lifecycleTaskId: "lifecycle-cancel",
      objective: eastTask.objective, signal: controller.signal
    });
    await started;

    expect(receivedSignal).toBe(controller.signal);
    const running = coordinator.getTask("lifecycle-cancel");
    expect(running.status).toBe("running");
    expect(running.steps.find(step => step.id === "execute-director")?.currentAttempt).not.toBeNull();

    controller.abort();
    await Promise.resolve();
    const stillRunning = coordinator.getTask("lifecycle-cancel");
    expect(stillRunning.status).toBe("running");
    expect(stillRunning.steps.find(step => step.id === "execute-director")?.currentAttempt).not.toBeNull();

    releaseDrain();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    const cancelled = coordinator.getTask("lifecycle-cancel");
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.steps.find(step => step.id === "execute-director")).toMatchObject({
      status: "cancelled", currentAttempt: null
    });
    expect(assignments).toEqual([...EAST_DELIBERATION_AGENTS]);
    expect(cancelled.steps.filter(step => step.status === "succeeded")).toHaveLength(1);

    // A fresh coordinator must observe the terminal cancellation and refuse
    // to replay the in-flight inference step after restart.
    const restartedCoordinator = new TaskLifecycleCoordinator({ store });
    await expect(runEastTaskWithLifecycle({
      coordinator: restartedCoordinator, east, eastTaskId: eastTask.id,
      lifecycleTaskId: "lifecycle-cancel", objective: eastTask.objective
    })).rejects.toThrow("Existing East lifecycle is terminal: cancelled");
    expect(restartedCoordinator.getTask("lifecycle-cancel").status).toBe("cancelled");
  });

});