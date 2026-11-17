/**
 * Bounded bridge from the durable task lifecycle to the existing East runtime.
 *
 * This adapter coordinates analysis only. Completed East task/thread snapshots
 * are checkpointed into durable lifecycle step results and can be restored into
 * a fresh East runtime. The caller must provide a durable TaskLifecycleStore and
 * durable MemoryStore for restart-safe memory. This does not authorize actions.
 */
import type { EastPlatformRuntime, EastRuntimeCheckpoint } from "../../../src/east/platform";
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
  /** Caller-owned cancellation signal. Active inference drains before the durable task is cancelled. */
  signal?: AbortSignal;
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

const CHECKPOINT_PREFIX = "east-runtime-checkpoint:v1:";

function encodeCheckpoint(kind: string, checkpoint: EastRuntimeCheckpoint, messageOffset: number): string {
  if (!Number.isInteger(messageOffset) || messageOffset < 0 || messageOffset > checkpoint.messages.length) {
    throw new Error("Invalid East checkpoint message offset");
  }
  const delta = { ...checkpoint, messages: checkpoint.messages.slice(messageOffset) };
  const encoded = CHECKPOINT_PREFIX + JSON.stringify({ kind, checkpoint: delta });
  if (encoded.length > 1_000_000) {
    throw new Error("East checkpoint exceeds the 1 MB per-step persistence bound");
  }
  return encoded;
}

function decodeCheckpoint(value: string | null): EastRuntimeCheckpoint | null {
  if (!value || !value.startsWith(CHECKPOINT_PREFIX)) return null;
  try {
    const parsed = JSON.parse(value.slice(CHECKPOINT_PREFIX.length)) as {
      checkpoint?: EastRuntimeCheckpoint;
    };
    return parsed.checkpoint ?? null;
  } catch {
    throw new Error("Stored East runtime checkpoint is corrupt; refusing to regenerate completed work");
  }
}

function latestCheckpoint(task: TaskRecord): EastRuntimeCheckpoint | null {
  let latestTask: EastRuntimeCheckpoint["task"] | null = null;
  const messages: EastRuntimeCheckpoint["messages"][number][] = [];
  let evidenceMemoryCommitted = false;
  for (const step of task.steps) {
    if (step.status !== "succeeded") continue;
    const checkpoint = decodeCheckpoint(step.result);
    if (!checkpoint) continue;
    latestTask = checkpoint.task;
    messages.push(...checkpoint.messages);
    evidenceMemoryCommitted = checkpoint.evidenceMemoryCommitted;
  }
  return latestTask ? { version: 1, task: latestTask, messages, evidenceMemoryCommitted } : null;
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
      task.metadata.workflow !== "east-eight-agent-deliberation-v1" ||
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
 * Runs or resumes the eight-agent East deliberation as a serial, leased lifecycle.
 * Each inference-bearing provider call is single-attempt. Completed steps are
 * never repeated on re-entry; the deliberation text is persisted in its step
 * result so a later invocation can continue without generating it again.
 */
export async function runEastTaskWithLifecycle(
  options: EastLifecycleRunOptions
): Promise<EastLifecycleRunResult> {
  const { coordinator, east, eastTaskId, lifecycleTaskId, objective, signal } = options;
  throwIfAborted(signal);
  if (!coordinator || !east || typeof eastTaskId !== "string" || !eastTaskId.trim() ||
      typeof lifecycleTaskId !== "string" || !lifecycleTaskId.trim() ||
      typeof objective !== "string" || !objective.trim()) {
    throw new Error("Coordinator, East runtime, task identifiers, and objective are required");
  }

  const normalizedObjective = objective.trim();
  await coordinator.init();

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
      metadata: { eastTaskId, workflow: "east-eight-agent-deliberation-v1" }
    });
  }

  // Restore the task and its validated thread when the East runtime was recreated.
  let existingEastTask: ReturnType<EastPlatformRuntime["getTask"]> | null = null;
  try {
    existingEastTask = east.getTask(eastTaskId);
  } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || (error as { code?: string }).code !== "unknown_task") {
      throw error;
    }
    const checkpoint = latestCheckpoint(lifecycle);
    if (checkpoint) {
      east.restoreTask(checkpoint);
    } else {
      east.restoreTask({
        version: 1,
        task: {
          id: eastTaskId,
          objective: normalizedObjective,
          assignments: [],
          synthesis: null,
          evidenceRefs: [],
          evidenceGate: { status: "not_submitted" },
          apexDecision: { status: "unread" },
          authorized: false
        },
        messages: [],
        evidenceMemoryCommitted: false
      });
    }
    existingEastTask = east.getTask(eastTaskId);
  }
  if (existingEastTask.objective !== normalizedObjective) {
    throw new Error("East task objective does not match the lifecycle objective");
  }

  let checkpointedMessageCount = east.checkpointTask(eastTaskId).messages.length;
  const captureCheckpoint = (kind: string): string => {
    const checkpoint = east.checkpointTask(eastTaskId);
    const encoded = encodeCheckpoint(kind, checkpoint, checkpointedMessageCount);
    checkpointedMessageCount = checkpoint.messages.length;
    return encoded;
  };

  if (lifecycle.status === "failed" || lifecycle.status === "cancelled") {
    throw new Error("Existing East lifecycle is terminal: " + lifecycle.status);
  }

  // Recovery only expires stale leases; it never replays an unexpired attempt.
  await coordinator.recoverExpiredLeases(lifecycleTaskId);
  lifecycle = coordinator.getTask(lifecycleTaskId);
  let synthesis = "";
  let evidenceRefs: string[] = [];
  const completedDeliberation = lifecycle.steps.find(step => step.id === "deliberate");
  if (completedDeliberation?.status === "succeeded") {
    const checkpoint = decodeCheckpoint(completedDeliberation.result);
    synthesis = checkpoint?.task.synthesis ?? "";
    evidenceRefs = [...(checkpoint?.task.evidenceRefs ?? completedDeliberation.evidenceRefs)];
    if (!synthesis.trim()) {
      throw new Error("Stored East deliberation is missing its synthesis; refusing to regenerate it");
    }
  }

  while (true) {
    if (signal?.aborted) {
      if (coordinator.getTask(lifecycleTaskId).status === "completed") break;
      await coordinator.cancelTask(lifecycleTaskId);
      throw cancellationError();
    }
    const claim = await coordinator.claimNextStep(lifecycleTaskId);
    if (!claim) break;
    try {
      throwIfAborted(signal);
      let result: string;
      let refs: string[] = [];
      if (claim.stepId === "assign-core-agents") {
        for (const agentId of EAST_DELIBERATION_AGENTS) east.assignAgent(eastTaskId, agentId);
        result = captureCheckpoint("assign-core-agents");
      } else if (claim.stepId.startsWith("execute-")) {
        const agentId = claim.stepId.slice("execute-".length);
        const messageId = await east.executeAgent(eastTaskId, agentId, { signal });
        throwIfAborted(signal);
        result = captureCheckpoint("execute-" + agentId);
        refs = ["east-message:" + messageId];
      } else if (claim.stepId === "deliberate") {
        const deliberation = await east.runDeliberation(eastTaskId, { signal });
        throwIfAborted(signal);
        if (typeof deliberation.synthesis !== "string" || !deliberation.synthesis.trim()) {
          throw new Error("East deliberation returned an empty synthesis");
        }
        synthesis = deliberation.synthesis;
        evidenceRefs = [...deliberation.evidence];
        // Persist the proposal and thread so a fresh East runtime can restore it.
        result = captureCheckpoint("deliberate");
        refs = evidenceRefs;
      } else if (claim.stepId === "record-unverified-proposal") {
        if (!synthesis.trim()) throw new Error("East deliberation returned no synthesis");
        throwIfAborted(signal);
        const accepted = await east.commitTaskEvidence(eastTaskId, synthesis);
        throwIfAborted(signal);
        if (accepted !== false) throw new Error("East evidence gate violated its non-authorizing contract");
        result = captureCheckpoint("record-unverified-proposal");
        refs = evidenceRefs;
      } else {
        throw new Error("Unknown East lifecycle step " + claim.stepId);
      }
      throwIfAborted(signal);
      await coordinator.completeStep({
        taskId: lifecycleTaskId,
        stepId: claim.stepId,
        attemptId: claim.attemptId,
        result,
        evidenceRefs: refs
      });
    } catch (error) {
      if (signal?.aborted) {
        // East's inference API settles only after the provider has drained.
        // Persist cancellation after that boundary, never while provider work is live.
        await coordinator.cancelTask(lifecycleTaskId);
        throw cancellationError();
      }
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


function throwIfAborted(signal: AbortSignal | undefined): void {
  if (!signal?.aborted) return;
  throw cancellationError();
}

function cancellationError(): Error {
  const error = new Error("East lifecycle execution was cancelled after active inference drained");
  error.name = "AbortError";
  return error;
}
