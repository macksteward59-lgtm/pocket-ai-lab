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
  type TaskRecord,
  type TaskStepDefinition
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

function buildSteps(): TaskStepDefinition[] {
  return [
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
}

function assertCompatibleLifecycle(task: TaskRecord, objective: string, eastTaskId: string, steps: TaskStepDefinition[]): void {
  if (task.objective !== objective ||
      task.metadata.eastTaskId !== eastTaskId ||
      task.metadata.workflow !== "east-six-agent-deliberation-v1" ||
      task.steps.length !== steps.length ||
      task.steps.some((step, index) => {
        const expected = steps[index];
        return step.id !== expected.id ||
          step.description !== expected.description ||
          step.maxAttempts !== (expected.maxAttempts ?? 2) ||
          step.dependsOn.length !== (expected.dependsOn ?? []).length ||
          step.dependsOn.some((dependency, dependencyIndex) => dependency !== expected.dependsOn?.[dependencyIndex]);
      })) {
    throw new Error("Existing lifecycle task does not match this East workflow definition");
  }
}

/**
 * Runs or resumes the six-agent East deliberation as a serial, leased lifecycle.
 * Each inference-bearing provider call is single-attempt. Completed steps are
 * never repeated on re-entry; the deliberation text is persisted in its step
 * result so a later invocation can continue without generating it again.
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

  const normalizedObjective = objective.trim();
  await coordinator.init();
  const existingEastTask = east.getTask(eastTaskId);
  if (existingEastTask.objective !== normalizedObjective) {
    throw new Error("East task objective does not match the lifecycle objective");
  }

  const steps = buildSteps();
  let lifecycle: TaskRecord;
  try {
    lifecycle = coordinator.getTask(lifecycleTaskId);
    assertCompatibleLifecycle(lifecycle, normalizedObjective, eastTaskId, steps);
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || (error as { code?: string }).code !== "unknown_task") {
      throw error;
    }
    lifecycle = await coordinator.createTask({
      id: lifecycleTaskId,
      objective: normalizedObjective,
      steps,
      maxConcurrentSteps: 1,
      leaseMs: 900_000,
      metadata: { eastTaskId, workflow: "east-six-agent-deliberation-v1" }
    });
  }

  if (lifecycle.status === "failed" || lifecycle.status === "cancelled") {
    throw new Error("Existing East lifecycle is terminal: " + lifecycle.status);
  }

  // Recovery only expires stale leases; it never replays an unexpired attempt.
  await coordinator.recoverExpiredLeases();
  lifecycle = coordinator.getTask(lifecycleTaskId);
  let synthesis = "";
  let evidenceRefs: string[] = [];
  const completedDeliberation = lifecycle.steps.find(step => step.id === "deliberate");
  if (completedDeliberation?.status === "succeeded") {
    synthesis = completedDeliberation.result ?? "";
    evidenceRefs = [...completedDeliberation.evidenceRefs];
    if (!synthesis.trim()) {
      throw new Error("Stored East deliberation is missing its synthesis; refusing to regenerate it");
    }
  }

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
        if (typeof deliberation.synthesis !== "string" || !deliberation.synthesis.trim()) {
          throw new Error("East deliberation returned an empty synthesis");
        }
        synthesis = deliberation.synthesis;
        evidenceRefs = [...deliberation.evidence];
        // Persist the actual bounded proposal so a resumed adapter does not
        // repeat an inference side effect merely to reconstruct local state.
        result = synthesis;
        refs = evidenceRefs;
      } else if (claim.stepId === "record-unverified-proposal") {
        if (!synthesis.trim()) throw new Error("East deliberation returned no synthesis");
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

  lifecycle = coordinator.getTask(lifecycleTaskId);
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
