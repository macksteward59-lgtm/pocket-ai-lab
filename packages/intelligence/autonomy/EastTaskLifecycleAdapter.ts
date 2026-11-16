/**
 * Bounded bridge from the durable task lifecycle to the existing East runtime.
 *
 * This adapter coordinates analysis only. East currently exposes an in-memory
 * task runtime and an APEX read-only view; this adapter does not persist East
 * internals, authorize actions, issue receipts, or turn candidate evidence
 * into approval. The injected TaskLifecycleStore must be durable in production.
 */
import type { EastPlatformRuntime } from "../../../src/east/platform";
import { EAST_DELIBERATION_AGENTS } from "../../../src/east/platform";
import {
  TaskLifecycleCoordinator,
  type TaskRecord
} from "./TaskLifecycleCoordinator";

export interface EastLifecycleRunOptions {
  coordinator: TaskLifecycleCoordinator;
  east: EastPlatformRuntime;
  /** An existing East task created by the host. */
  eastTaskId: string;
  /** Stable, caller-owned id for the durable lifecycle record. */
  lifecycleTaskId: string;
  objective: string;
}

export interface EastLifecycleRunResult {
  lifecycleTaskId: string;
  eastTaskId: string;
  lifecycle: TaskRecord;
  synthesis: string;
  evidenceRefs: readonly string[];
  /** East's current implementation cannot authorize this workflow. */
  authorized: false;
  apexDecision: ReturnType<EastPlatformRuntime["getTask"]>["apexDecision"];
  evidenceGate: ReturnType<EastPlatformRuntime["getTask"]>["evidenceGate"];
}

/**
 * Runs the six-agent East deliberation as a serial, leased lifecycle.
 * Each consequential provider call is single-attempt: a crash after an
 * inference side effect is not automatically replayed. A failed lease is
 * surfaced for operator review instead of risking duplicate generations.
 */
export async function runEastTaskWithLifecycle(
  options: EastLifecycleRunOptions
): Promise<EastLifecycleRunResult> {
  const { coordinator, east, eastTaskId, lifecycleTaskId, objective } = options;
  if (!coordinator || !east || typeof eastTaskId !== "string" || !eastTaskId.trim() ||
      typeof lifecycleTaskId !== "string" || !lifecycleTaskId.trim() ||
      typeof objective !== "string" || !objective.trim()) {
    throw new Error("Coordinator, East runtime, task identifiers, and objective are required");
  }

  await coordinator.init();
  const existing = east.getTask(eastTaskId);
  if (existing.objective !== objective.trim()) {
    throw new Error("East task objective does not match the lifecycle objective");
  }

  const steps = [
    { id: "assign-core-agents", description: "Assign the required permanent East deliberation agents" },
    ...EAST_DELIBERATION_AGENTS.map(agentId => ({
      id: "execute-" + agentId,
      description: "Execute the " + agentId + " agent and capture its message reference",
      dependsOn: ["assign-core-agents"],
      maxAttempts: 1
    })),
    {
      id: "deliberate",
      description: "Run the East multi-agent deliberation",
      dependsOn: EAST_DELIBERATION_AGENTS.map(agentId => "execute-" + agentId),
      maxAttempts: 1
    },
    {
      id: "record-unverified-proposal",
      description: "Submit the synthesis to East's read-only evidence gate and preserve its non-authorizing result",
      dependsOn: ["deliberate"],
      maxAttempts: 1
    }
  ];

  await coordinator.createTask({
    id: lifecycleTaskId,
    objective: objective.trim(),
    steps,
    maxConcurrentSteps: 1,
    leaseMs: 900_000,
    metadata: { eastTaskId, workflow: "east-six-agent-deliberation-v1" }
  });

  let synthesis = "";
  let evidenceRefs: string[] = [];
  while (true) {
    const claim = await coordinator.claimNextStep(lifecycleTaskId);
    if (!claim) break;
    try {
      let result: string;
      let refs: string[] = [];
      if (claim.stepId === "assign-core-agents") {
        for (const agentId of EAST_DELIBERATION_AGENTS) east.assignAgent(eastTaskId, agentId);
        result = "Assigned agents: " + EAST_DELIBERATION_AGENTS.join(", ");
      } else if (claim.stepId.startsWith("execute-")) {
        const agentId = claim.stepId.slice("execute-".length);
        const messageId = await east.executeAgent(eastTaskId, agentId);
        result = "Agent " + agentId + " published message " + messageId;
        refs = ["east-message:" + messageId];
      } else if (claim.stepId === "deliberate") {
        const deliberation = await east.runDeliberation(eastTaskId);
        synthesis = deliberation.synthesis;
        evidenceRefs = [...deliberation.evidence];
        result = "Deliberation completed; synthesis retained as unverified proposal text";
        refs = evidenceRefs;
      } else if (claim.stepId === "record-unverified-proposal") {
        if (!synthesis) throw new Error("East deliberation returned no synthesis");
        const accepted = await east.commitTaskEvidence(eastTaskId, synthesis);
        if (accepted !== false) throw new Error("East evidence gate violated its non-authorizing contract");
        const task = east.getTask(eastTaskId);
        result = "East evidence gate returned false; authorized=false; status=" + task.evidenceGate.status;
        refs = evidenceRefs;
      } else {
        throw new Error("Unknown East lifecycle step " + claim.stepId);
      }
      await coordinator.completeStep({
        taskId: lifecycleTaskId,
        stepId: claim.stepId,
        attemptId: claim.attemptId,
        result,
        evidenceRefs: refs
      });
    } catch (error) {
      await coordinator.failStep({
        taskId: lifecycleTaskId,
        stepId: claim.stepId,
        attemptId: claim.attemptId,
        error: error instanceof Error ? error.message : "East lifecycle step failed",
        retryable: false
      });
      throw error;
    }
  }

  const lifecycle = coordinator.getTask(lifecycleTaskId);
  const eastResult = east.getTask(eastTaskId);
  if (lifecycle.status !== "completed") {
    throw new Error("East lifecycle did not complete: " + lifecycle.status);
  }
  return {
    lifecycleTaskId,
    eastTaskId,
    lifecycle,
    synthesis,
    evidenceRefs,
    authorized: false,
    apexDecision: eastResult.apexDecision,
    evidenceGate: eastResult.evidenceGate
  };
}
