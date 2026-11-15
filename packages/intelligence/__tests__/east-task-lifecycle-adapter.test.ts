import { describe, expect, it } from "vitest";
import {
  InMemoryTaskLifecycleStore,
  TaskLifecycleCoordinator
} from "../autonomy/TaskLifecycleCoordinator";
import { runEastTaskWithLifecycle } from "../autonomy/EastTaskLifecycleAdapter";
import { EAST_DELIBERATION_AGENTS, type EastPlatformRuntime } from "../../../../src/east/platform";

describe("runEastTaskWithLifecycle", () => {
  it("runs the six-agent East workflow through leased lifecycle steps without granting authority", async () => {
    const assignments: string[] = [];
    const executions: string[] = [];
    let committed = 0;
    const eastTask = {
      id: "east-1",
      objective: "Review the integration architecture",
      assignments: [],
      synthesis: null,
      evidenceRefs: [],
      evidenceGate: { status: "not_submitted" as const },
      apexDecision: { status: "unread" as const },
      authorized: false as const
    };
    const east = {
      createAgentTask: () => "east-1",
      assignAgent: (_taskId: string, agentId: string) => { assignments.push(agentId); return "east-1"; },
      executeAgent: async (_taskId: string, agentId: string) => { executions.push(agentId); return "message-" + agentId; },
      runDeliberation: async () => ({ synthesis: "Unverified synthesis", evidence: ["evidence:one"] }),
      commitTaskEvidence: async () => { committed += 1; return false as const; },
      readApexDecision: async () => ({ status: "unread" as const }),
      getTask: () => eastTask,
      orchestrator: {} as EastPlatformRuntime["orchestrator"],
      memory: {} as EastPlatformRuntime["memory"]
    } as unknown as EastPlatformRuntime;
    const coordinator = new TaskLifecycleCoordinator({ store: new InMemoryTaskLifecycleStore() });

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
  });

  it("fails closed and does not retry an agent generation after a provider failure", async () => {
    let attempts = 0;
    const east = {
      getTask: () => ({
        id: "east-2", objective: "Test failure", assignments: [],
        synthesis: null, evidenceRefs: [], evidenceGate: { status: "not_submitted" },
        apexDecision: { status: "unread" }, authorized: false
      }),
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
