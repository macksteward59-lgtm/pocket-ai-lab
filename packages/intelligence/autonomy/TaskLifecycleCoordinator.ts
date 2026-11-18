/**
 * Durable, provider-neutral task lifecycle kernel.
 *
 * This module plans and tracks work; it does not execute tools, call models,
 * grant permissions, or issue evidence/authorization receipts. Host runners
 * must supply an atomic durable store and separately enforce authorization.
 */

export type TaskStatus = "ready" | "running" | "completed" | "failed" | "cancelled";
export type StepStatus = "pending" | "running" | "succeeded" | "failed" | "cancelled";

export interface TaskStepDefinition {
  /** Stable, task-local identifier. */
  id: string;
  description: string;
  dependsOn?: readonly string[];
  /** Total attempts, including the first attempt. Range: 1..5. */
  maxAttempts?: number;
  /** Expired execution is ambiguous and must not be replayed unless explicitly opted into safe retry. Defaults true. */
  uncertainOnExpiredLease?: boolean;
}

export interface TaskDefinition {
  id: string;
  objective: string;
  steps: readonly TaskStepDefinition[];
  /** Maximum simultaneously leased steps. Range: 1..8. */
  maxConcurrentSteps?: number;
  /** Lease duration in milliseconds. Range: 1 second..15 minutes. */
  leaseMs?: number;
  metadata?: Readonly<Record<string, string>>;
}

export interface StepAttempt {
  id: string;
  /** Unique process/worker identity that acquired this lease; not an authorization credential. */
  ownerId?: string;
  startedAt: string;
  leaseExpiresAt: string;
}

export interface TaskStepRecord {
  id: string;
  description: string;
  dependsOn: string[];
  maxAttempts: number;
  attempts: number;
  /** Every issued attempt ID is retained to prevent reuse after retries/restarts. */
  attemptIds: string[];
  status: StepStatus;
  currentAttempt: StepAttempt | null;
  completedAt: string | null;
  result: string | null;
  evidenceRefs: string[];
  lastError: string | null;
  /** Conservative marker when an external side effect may have completed without a durable checkpoint. */
  uncertain?: boolean;
  /** Expired leases for these steps are not safe to retry automatically. */
  uncertainOnExpiredLease?: boolean;
}

export type TaskLifecycleEventType =
  | "task.created"
  | "step.claimed"
  | "step.completed"
  | "step.failed"
  | "step.cancelled"
  | "step.lease_expired"
  | "task.completed"
  | "task.failed"
  | "task.cancelled";

/** Durable audit metadata only; event contents never authorize execution. */
export interface TaskLifecycleEvent {
  sequence: number;
  eventId: string;
  type: TaskLifecycleEventType;
  occurredAt: string;
  stepId?: string;
  attemptId?: string;
  ownerId?: string;
  uncertain?: boolean;
  resultingStepStatus?: StepStatus;
  resultingTaskStatus?: TaskStatus;
}

export const MAX_TASK_LIFECYCLE_EVENTS = 2_048;

export interface TaskRecord {
  id: string;
  objective: string;
  status: TaskStatus;
  steps: TaskStepRecord[];
  maxConcurrentSteps: number;
  leaseMs: number;
  metadata: Record<string, string>;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
  /** Ordered, append-only lifecycle transitions retained in the durable snapshot. */
  events: TaskLifecycleEvent[];
}

export interface StepClaim {
  taskId: string;
  stepId: string;
  attemptId: string;
  /** Durable owner identity recorded with the active attempt. */
  ownerId: string;
  description: string;
  objective: string;
  attemptNumber: number;
  leaseExpiresAt: string;
  /** Dependency summaries are untrusted task context, not permission. */
  completedDependencies: Array<{ stepId: string; result: string | null; evidenceRefs: string[] }>;
}

export interface TaskLifecycleStore {
  /** load() returns a complete snapshot. */
  load(): Promise<TaskRecord[]> | TaskRecord[];
  /** save() must atomically replace the snapshot or leave the prior snapshot intact. */
  save(records: readonly TaskRecord[]): Promise<void> | void;
}

export class TaskLifecycleError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "TaskLifecycleError";
  }
}

export class InMemoryTaskLifecycleStore implements TaskLifecycleStore {
  private records: TaskRecord[] = [];

  load(): TaskRecord[] {
    return this.records.map(cloneTask);
  }

  save(records: readonly TaskRecord[]): void {
    this.records = records.map(cloneTask);
  }
}

export class TaskLifecycleCoordinator {
  private records = new Map<string, TaskRecord>();
  private mutationQueue: Promise<void> = Promise.resolve();
  private initialized = false;
  private readonly store: TaskLifecycleStore;
  private readonly now: () => Date;
  private readonly createId: () => string;
  private readonly workerId: string;

  constructor(options: {
    store: TaskLifecycleStore;
    now?: () => Date;
    createId?: () => string;
    /** Unique identity for this worker process/coordinator instance. */
    workerId?: string;
  }) {
    if (!options?.store || typeof options.store.load !== "function" || typeof options.store.save !== "function") {
      throw new TaskLifecycleError("invalid_store", "A task lifecycle store is required");
    }
    this.store = options.store;
    this.now = options.now ?? (() => new Date());
    this.createId = options.createId ?? (() => crypto.randomUUID());
    const workerId = options.workerId ?? "worker-" + crypto.randomUUID();
    if (typeof workerId !== "string" || !workerId.trim() || workerId.length > 256) {
      throw new TaskLifecycleError("invalid_worker_id", "Worker id must be a non-empty string up to 256 characters");
    }
    this.workerId = workerId;
  }

  async init(): Promise<void> {
    await this.mutate(async () => {
      if (this.initialized) return;
      const loaded = await this.store.load();
      const next = new Map<string, TaskRecord>();
      const issuedAttemptIds = new Set<string>();
      for (const raw of loaded) {
        const task = validateStoredTask(raw);
        if (next.has(task.id)) throw new TaskLifecycleError("corrupt_store", "Duplicate task id in store");
        for (const step of task.steps) {
          for (const attemptId of step.attemptIds) {
            if (issuedAttemptIds.has(attemptId)) {
              throw new TaskLifecycleError("corrupt_store", "Attempt id is duplicated across stored tasks");
            }
            issuedAttemptIds.add(attemptId);
          }
        }
        next.set(task.id, task);
      }
      this.records = next;
      this.initialized = true;
    });
  }

  /**
   * Reloads the authoritative snapshot after a store_conflict. The caller must
   * reconcile its intent against the newly loaded records before retrying.
   */
  async reload(): Promise<void> {
    await this.mutate(async () => {
      const loaded = await this.store.load();
      const next = new Map<string, TaskRecord>();
      const issuedAttemptIds = new Set<string>();
      for (const raw of loaded) {
        const task = validateStoredTask(raw);
        if (next.has(task.id)) throw new TaskLifecycleError("corrupt_store", "Duplicate task id in store");
        for (const step of task.steps) {
          for (const attemptId of step.attemptIds) {
            if (issuedAttemptIds.has(attemptId)) {
              throw new TaskLifecycleError("corrupt_store", "Attempt id is duplicated across stored tasks");
            }
            issuedAttemptIds.add(attemptId);
          }
        }
        next.set(task.id, task);
      }
      this.records = next;
      this.initialized = true;
    });
  }

  async createTask(definition: TaskDefinition): Promise<TaskRecord> {
    return this.mutate(async () => {
      this.requireInitialized();
      const now = this.now();
      const task = normalizeDefinition(definition, now);
      if (this.records.has(task.id)) throw new TaskLifecycleError("duplicate_task", "Task id already exists");
      appendEvent(task, "task.created", now, { resultingTaskStatus: task.status });
      const next = new Map(this.records);
      next.set(task.id, task);
      await this.persist(next);
      return cloneTask(task);
    });
  }

  getTask(taskId: string): TaskRecord {
    this.requireInitialized();
    const task = this.records.get(taskId);
    if (!task) throw new TaskLifecycleError("unknown_task", "Unknown task");
    return cloneTask(task);
  }

  listTasks(): TaskRecord[] {
    this.requireInitialized();
    return [...this.records.values()].map(cloneTask);
  }

  /**
   * Claims one dependency-ready step with a bounded lease. A claim is not
   * permission to perform consequential work; the host must authorize effects.
   */
  async claimNextStep(taskId: string): Promise<StepClaim | null> {
    return this.mutate(async () => {
      this.requireInitialized();
      const task = this.requireTask(taskId);
      if (isTerminal(task.status) || task.steps.some(step => step.status === "failed")) return null;
      const now = this.now();
      const active = task.steps.filter(step => step.status === "running").length;
      if (active >= task.maxConcurrentSteps) return null;

      const step = task.steps.find(candidate =>
        candidate.status === "pending" &&
        candidate.dependsOn.every(id => task.steps.find(dep => dep.id === id)?.status === "succeeded")
      );
      if (!step) {
        const updated = refreshTaskStatus(task, now);
        if (updated !== task) await this.replaceTask(updated);
        return null;
      }

      const attemptId = this.createId();
      if (typeof attemptId !== "string" || !attemptId.trim() || attemptId.length > 256) {
        throw new TaskLifecycleError("invalid_attempt_id", "Attempt id generator returned an invalid id");
      }
      if ([...this.records.values()].some(record => record.steps.some(item => item.attemptIds.includes(attemptId)))) {
        throw new TaskLifecycleError("duplicate_attempt_id", "Attempt id has already been issued");
      }
      const expires = new Date(now.getTime() + task.leaseMs);
      const updated = cloneTask(task);
      const target = updated.steps.find(item => item.id === step.id)!;
      target.status = "running";
      target.attempts += 1;
      target.attemptIds.push(attemptId);
      target.currentAttempt = {
        id: attemptId,
        ownerId: this.workerId,
        startedAt: now.toISOString(),
        leaseExpiresAt: expires.toISOString()
      };
      updated.status = "running";
      updated.updatedAt = now.toISOString();
      appendEvent(updated, "step.claimed", now, { stepId: target.id, attemptId, ownerId: this.workerId, resultingStepStatus: target.status });
      await this.replaceTask(updated);

      return {
        taskId,
        stepId: target.id,
        attemptId,
        ownerId: this.workerId,
        description: target.description,
        objective: updated.objective,
        attemptNumber: target.attempts,
        leaseExpiresAt: expires.toISOString(),
        completedDependencies: target.dependsOn.map(id => {
          const dep = updated.steps.find(item => item.id === id)!;
          return { stepId: dep.id, result: dep.result, evidenceRefs: [...dep.evidenceRefs] };
        })
      };
    });
  }

  async completeStep(input: {
    taskId: string;
    stepId: string;
    attemptId: string;
    result: string;
    evidenceRefs?: readonly string[];
  }): Promise<TaskRecord> {
    return this.mutate(async () => {
      this.requireInitialized();
      const task = this.requireTask(input.taskId);
      const now = this.now();
      const updated = cloneTask(task);
      const step = this.requireActiveAttempt(updated, input.stepId, input.attemptId, now);
      if (typeof input.result !== "string" || !input.result.trim() || input.result.length > 16_000) {
        throw new TaskLifecycleError("invalid_result", "A non-empty step result up to 16000 characters is required");
      }
      const refs = input.evidenceRefs ?? [];
      if (!Array.isArray(refs) || refs.length > 100 || refs.some(ref => typeof ref !== "string" || !ref.trim())) {
        throw new TaskLifecycleError("invalid_evidence_refs", "At most 100 non-empty evidence references are allowed");
      }
      step.uncertain = false;
      step.status = "succeeded";
      step.result = input.result.trim();
      step.evidenceRefs = [...new Set(refs)];
      step.completedAt = now.toISOString();
      step.currentAttempt = null;
      appendEvent(updated, "step.completed", now, { stepId: step.id, attemptId: input.attemptId, ownerId: this.workerId, resultingStepStatus: step.status });
      const final = refreshTaskStatus(updated, now);
      appendTerminalEvent(updated.status, final, now);
      await this.replaceTask(final);
      return cloneTask(final);
    });
  }

  async failStep(input: {
    taskId: string;
    stepId: string;
    attemptId: string;
    error: string;
    retryable?: boolean;
    /** Whether the external operation is known to have failed or may have completed. */
    outcome: "definitive" | "unknown";
  }): Promise<TaskRecord> {
    return this.mutate(async () => {
      this.requireInitialized();
      const task = this.requireTask(input.taskId);
      const now = this.now();
      const updated = cloneTask(task);
      const step = this.requireActiveAttempt(updated, input.stepId, input.attemptId, now);
      if (typeof input.error !== "string" || !input.error.trim() ||
          (input.retryable !== undefined && typeof input.retryable !== "boolean") ||
          (input.outcome !== "definitive" && input.outcome !== "unknown")) {
        throw new TaskLifecycleError("invalid_error", "A failure reason, valid outcome classification, and optional boolean retryable flag are required");
      }
      const outcomeUncertain = input.outcome === "unknown";
      const normalizedError = input.error.trim().slice(0, 2_000);
      step.lastError = outcomeUncertain
        ? "Provider outcome may be uncertain; operator reconciliation required: " + normalizedError.slice(0, 1_900)
        : normalizedError;
      step.currentAttempt = null;
      step.uncertain = outcomeUncertain;
      step.status = !outcomeUncertain && input.retryable === true && step.attempts < step.maxAttempts
        ? "pending"
        : "failed";
      appendEvent(updated, "step.failed", now, {
        stepId: step.id, attemptId: input.attemptId, ownerId: this.workerId, uncertain: outcomeUncertain,
        resultingStepStatus: step.status
      });
      const final = refreshTaskStatus(updated, now);
      appendTerminalEvent(updated.status, final, now);
      await this.replaceTask(final);
      return cloneTask(final);
    });
  }

  async cancelTask(taskId: string): Promise<TaskRecord> {
    return this.mutate(async () => {
      this.requireInitialized();
      const task = this.requireTask(taskId);
      if (isTerminal(task.status)) return cloneTask(task);
      const now = this.now();
      const updated = cloneTask(task);
      updated.status = "cancelled";
      updated.completedAt = now.toISOString();
      updated.updatedAt = now.toISOString();
      for (const step of updated.steps) {
        if (step.status === "pending" || step.status === "running") {
          const attempt = step.currentAttempt;
          step.status = "cancelled";
          step.currentAttempt = null;
          appendEvent(updated, "step.cancelled", now, {
            stepId: step.id,
            ...(attempt ? { attemptId: attempt.id, ...(attempt.ownerId ? { ownerId: attempt.ownerId } : {}) } : {}),
            resultingStepStatus: step.status
          });
        }
      }
      appendEvent(updated, "task.cancelled", now, { resultingTaskStatus: updated.status });
      await this.replaceTask(updated);
      return cloneTask(updated);
    });
  }

  /**
   * Requeues expired leases only while retry budget remains. Exhausted steps
   * become failed; task state then reflects the failure. Safe to call on startup.
   */
  async recoverExpiredLeases(taskId?: string): Promise<number> {
    return this.mutate(async () => {
      this.requireInitialized();
      if (taskId !== undefined) this.requireTask(taskId);
      const now = this.now();
      const next = new Map(this.records);
      let recovered = 0;
      for (const [id, original] of this.records) {
        if (taskId !== undefined && id !== taskId) continue;
        const updated = cloneTask(original);
        let changed = false;
        for (const step of updated.steps) {
          if (step.status !== "running" || !step.currentAttempt) continue;
          if (Date.parse(step.currentAttempt.leaseExpiresAt) > now.getTime()) continue;
          const expiredAttempt = step.currentAttempt;
          const outcomeUncertain = step.uncertainOnExpiredLease !== false;
          step.lastError = outcomeUncertain
            ? "Execution lease expired before completion; provider outcome is uncertain and requires operator reconciliation"
            : "Execution lease expired before completion";
          step.currentAttempt = null;
          step.uncertain = outcomeUncertain;
          step.status = !outcomeUncertain && step.attempts < step.maxAttempts ? "pending" : "failed";
          appendEvent(updated, "step.lease_expired", now, {
            stepId: step.id, attemptId: expiredAttempt.id,
            ...(expiredAttempt.ownerId ? { ownerId: expiredAttempt.ownerId } : {}),
            uncertain: outcomeUncertain,
            resultingStepStatus: step.status
          });
          recovered += 1;
          changed = true;
        }
        if (changed) {
          const final = refreshTaskStatus(updated, now);
          appendTerminalEvent(updated.status, final, now);
          next.set(id, final);
        }
      }
      if (recovered > 0) await this.persist(next);
      return recovered;
    });
  }

  private requireInitialized(): void {
    if (!this.initialized) throw new TaskLifecycleError("not_initialized", "Call init() before using the task lifecycle");
  }

  private requireTask(id: string): TaskRecord {
    const task = this.records.get(id);
    if (!task) throw new TaskLifecycleError("unknown_task", "Unknown task");
    return task;
  }

  private requireActiveAttempt(task: TaskRecord, stepId: string, attemptId: string, now: Date): TaskStepRecord {
    const step = task.steps.find(item => item.id === stepId);
    if (!step) throw new TaskLifecycleError("unknown_step", "Unknown task step");
    if (step.status !== "running" || !step.currentAttempt || step.currentAttempt.id !== attemptId) {
      throw new TaskLifecycleError("stale_attempt", "Attempt is no longer active");
    }
    if (step.currentAttempt.ownerId === undefined) {
      throw new TaskLifecycleError("unowned_attempt", "Attempt has no recorded worker owner; wait for expiry and recover before continuing");
    }
    if (step.currentAttempt.ownerId !== this.workerId) {
      throw new TaskLifecycleError("lease_owner_mismatch", "Attempt lease belongs to a different worker");
    }
    if (Date.parse(step.currentAttempt.leaseExpiresAt) <= now.getTime()) {
      throw new TaskLifecycleError("expired_attempt", "Attempt lease has expired");
    }
    return step;
  }

  private async replaceTask(task: TaskRecord): Promise<void> {
    const next = new Map(this.records);
    next.set(task.id, task);
    await this.persist(next);
  }

  private async persist(next: Map<string, TaskRecord>): Promise<void> {
    const snapshot = [...next.values()].map(cloneTask);
    await this.store.save(snapshot);
    this.records = next;
  }

  private async mutate<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.mutationQueue;
    let release!: () => void;
    this.mutationQueue = new Promise<void>(resolve => { release = resolve; });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }
}

function normalizeDefinition(definition: TaskDefinition, now: Date): TaskRecord {
  if (!definition || typeof definition.id !== "string" || !definition.id.trim() ||
      typeof definition.objective !== "string" || !definition.objective.trim()) {
    throw new TaskLifecycleError("invalid_task", "Task id and objective are required");
  }
  if (!Array.isArray(definition.steps) || definition.steps.length < 1 || definition.steps.length > 100) {
    throw new TaskLifecycleError("invalid_plan", "A plan must contain between 1 and 100 steps");
  }
  const ids = new Set<string>();
  const steps: TaskStepRecord[] = definition.steps.map(step => {
    if (!step || typeof step.id !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(step.id) ||
        typeof step.description !== "string" || !step.description.trim()) {
      throw new TaskLifecycleError("invalid_step", "Every step requires a stable id and description");
    }
    if (ids.has(step.id)) throw new TaskLifecycleError("duplicate_step", "Duplicate step id");
    ids.add(step.id);
    const maxAttempts = step.maxAttempts ?? 2;
    if (step.uncertainOnExpiredLease !== undefined && typeof step.uncertainOnExpiredLease !== "boolean") {
      throw new TaskLifecycleError("invalid_step", "uncertainOnExpiredLease must be a boolean");
    }
    const uncertainOnExpiredLease = step.uncertainOnExpiredLease ?? true;
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 5) {
      throw new TaskLifecycleError("invalid_attempt_limit", "Step maxAttempts must be from 1 to 5");
    }
    if (step.dependsOn !== undefined && !Array.isArray(step.dependsOn)) {
      throw new TaskLifecycleError("invalid_dependency", "Step dependencies must be an array");
    }
    const dependsOn = [...(step.dependsOn ?? [])];
    if (dependsOn.some(id => typeof id !== "string" || !id.trim() || id === step.id)) {
      throw new TaskLifecycleError("invalid_dependency", "Step dependencies must reference other step ids");
    }
    return {
      id: step.id, description: step.description.trim(), dependsOn, maxAttempts,
      attempts: 0, attemptIds: [], status: "pending", currentAttempt: null, completedAt: null,
      result: null, evidenceRefs: [], lastError: null, uncertain: false, uncertainOnExpiredLease
    };
  });
  for (const step of steps) {
    if (new Set(step.dependsOn).size !== step.dependsOn.length ||
        step.dependsOn.some(id => !ids.has(id))) {
      throw new TaskLifecycleError("invalid_dependency", "Unknown or duplicate step dependency");
    }
  }
  assertAcyclic(steps);
  const maxConcurrentSteps = definition.maxConcurrentSteps ?? 1;
  const leaseMs = definition.leaseMs ?? 60_000;
  if (!Number.isInteger(maxConcurrentSteps) || maxConcurrentSteps < 1 || maxConcurrentSteps > 8) {
    throw new TaskLifecycleError("invalid_concurrency", "maxConcurrentSteps must be from 1 to 8");
  }
  if (!Number.isInteger(leaseMs) || leaseMs < 1_000 || leaseMs > 900_000) {
    throw new TaskLifecycleError("invalid_lease", "leaseMs must be from 1000 to 900000");
  }
  const metadata = definition.metadata ?? {};
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata) ||
      Object.entries(metadata).some(([key, value]) => !key.trim() || typeof value !== "string")) {
    throw new TaskLifecycleError("invalid_metadata", "Metadata must contain string values and non-empty keys");
  }
  const timestamp = now.toISOString();
  return {
    id: definition.id.trim(), objective: definition.objective.trim(), status: "ready",
    steps, maxConcurrentSteps, leaseMs, metadata: { ...metadata },
    createdAt: timestamp, updatedAt: timestamp, completedAt: null, events: []
  };
}

function assertAcyclic(steps: readonly TaskStepRecord[]): void {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const byId = new Map(steps.map(step => [step.id, step]));
  const visit = (id: string): void => {
    if (visiting.has(id)) throw new TaskLifecycleError("cyclic_plan", "Task plan contains a dependency cycle");
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dep of byId.get(id)!.dependsOn) visit(dep);
    visiting.delete(id);
    visited.add(id);
  };
  for (const step of steps) visit(step.id);
}

function refreshTaskStatus(task: TaskRecord, now: Date): TaskRecord {
  if (task.status === "cancelled") return task;
  const next = cloneTask(task);
  if (next.steps.some(step => step.status === "failed")) {
    // Stop issuing new work immediately, but retain active sibling leases until
    // their owners report settlement. A failed sibling cannot erase live work.
    if (next.steps.some(step => step.status === "running")) {
      next.status = "running";
    } else {
      next.status = "failed";
    }
    for (const step of next.steps) {
      if (step.status === "pending" || (step.status === "running" && next.status === "failed")) {
        const attempt = step.currentAttempt;
        step.status = "cancelled";
        step.currentAttempt = null;
        appendEvent(next, "step.cancelled", now, {
          stepId: step.id,
          ...(attempt ? { attemptId: attempt.id, ...(attempt.ownerId ? { ownerId: attempt.ownerId } : {}) } : {}),
          resultingStepStatus: step.status
        });
      }
    }
  } else if (next.steps.every(step => step.status === "succeeded")) next.status = "completed";
  else if (next.steps.some(step => step.status === "running")) next.status = "running";
  else next.status = "ready";
  next.updatedAt = now.toISOString();
  if (next.status === "completed" || next.status === "failed") next.completedAt = now.toISOString();
  return next;
}

function validateStoredTask(task: TaskRecord): TaskRecord {
  const validTimestamp = (value: unknown): value is string =>
    typeof value === "string" && Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value;

  if (!task || typeof task.id !== "string" || !task.id.trim() ||
      typeof task.objective !== "string" || !task.objective.trim() ||
      !Array.isArray(task.steps) || task.steps.length < 1 || task.steps.length > 100 ||
      !["ready", "running", "completed", "failed", "cancelled"].includes(task.status) ||
      !Number.isInteger(task.maxConcurrentSteps) || task.maxConcurrentSteps < 1 || task.maxConcurrentSteps > 8 ||
      !Number.isInteger(task.leaseMs) || task.leaseMs < 1_000 || task.leaseMs > 900_000 ||
      !task.metadata || typeof task.metadata !== "object" || Array.isArray(task.metadata) ||
      Object.entries(task.metadata).some(([key, value]) => !key.trim() || typeof value !== "string") ||
      !validTimestamp(task.createdAt) || !validTimestamp(task.updatedAt) ||
      Date.parse(task.updatedAt) < Date.parse(task.createdAt) ||
      (task.completedAt !== null && !validTimestamp(task.completedAt)) ||
      (task.events !== undefined && (!Array.isArray(task.events) || task.events.length > MAX_TASK_LIFECYCLE_EVENTS))) {
    throw new TaskLifecycleError("corrupt_store", "Stored task record is invalid");
  }

  const ids = new Set<string>();
  for (const step of task.steps) {
    if (!step || typeof step.id !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(step.id) ||
        ids.has(step.id) || typeof step.description !== "string" || !step.description.trim() ||
        !["pending", "running", "succeeded", "failed", "cancelled"].includes(step.status) ||
        (step.uncertain !== undefined && typeof step.uncertain !== "boolean") ||
        (step.uncertainOnExpiredLease !== undefined && typeof step.uncertainOnExpiredLease !== "boolean") ||
        (step.uncertain === true && (step.status !== "failed" || !step.lastError)) ||
        !Array.isArray(step.dependsOn) ||
        step.dependsOn.some(id => typeof id !== "string" || !id.trim() || id === step.id) ||
        new Set(step.dependsOn).size !== step.dependsOn.length ||
        !Number.isInteger(step.attempts) || step.attempts < 0 ||
        !Array.isArray(step.attemptIds) || step.attemptIds.length !== step.attempts ||
        step.attemptIds.some(id => typeof id !== "string" || !id.trim() || id.length > 256) ||
        new Set(step.attemptIds).size !== step.attemptIds.length ||
        !Number.isInteger(step.maxAttempts) || step.maxAttempts < 1 || step.maxAttempts > 5 ||
        step.attempts > step.maxAttempts ||
        !Array.isArray(step.evidenceRefs) || step.evidenceRefs.length > 100 ||
        step.evidenceRefs.some(ref => typeof ref !== "string" || !ref.trim()) ||
        (step.result !== null && (typeof step.result !== "string" || !step.result.trim() || step.result.length > 16_000)) ||
        (step.lastError !== null && (typeof step.lastError !== "string" || !step.lastError.trim() || step.lastError.length > 2_000)) ||
        (step.completedAt !== null && !validTimestamp(step.completedAt)) ||
        (step.status === "running") !== (step.currentAttempt !== null) ||
        (step.status === "pending" && (step.result !== null || step.attempts >= step.maxAttempts)) ||
        (step.status === "running" && (step.attempts < 1 || step.result !== null)) ||
        (step.status === "succeeded" && (step.attempts < 1 || !step.result || !validTimestamp(step.completedAt))) ||
        (step.status !== "succeeded" && step.completedAt !== null) ||
        (step.status === "failed" && (step.attempts < 1 || !step.lastError || step.result !== null)) ||
        (step.status === "cancelled" && step.result !== null) ||
        (step.status === "pending" && step.result !== null) ||
        (step.completedAt !== null && (Date.parse(step.completedAt) < Date.parse(task.createdAt) ||
          Date.parse(step.completedAt) > Date.parse(task.updatedAt) ||
          (task.completedAt !== null && Date.parse(step.completedAt) > Date.parse(task.completedAt)))) ||
        (step.currentAttempt !== null && (!step.currentAttempt ||
          typeof step.currentAttempt.id !== "string" || !step.currentAttempt.id.trim() ||
          step.currentAttempt.id !== step.attemptIds[step.attemptIds.length - 1] ||
          (step.currentAttempt.ownerId !== undefined &&
            (typeof step.currentAttempt.ownerId !== "string" || !step.currentAttempt.ownerId.trim() || step.currentAttempt.ownerId.length > 256)) ||
          !validTimestamp(step.currentAttempt.leaseExpiresAt) ||
          !validTimestamp(step.currentAttempt.startedAt) ||
          Date.parse(step.currentAttempt.startedAt) < Date.parse(task.createdAt) ||
          Date.parse(step.currentAttempt.startedAt) > Date.parse(task.updatedAt) ||
          Date.parse(step.currentAttempt.leaseExpiresAt) <= Date.parse(step.currentAttempt.startedAt) ||
          Date.parse(step.currentAttempt.leaseExpiresAt) - Date.parse(step.currentAttempt.startedAt) > task.leaseMs))) {
      throw new TaskLifecycleError("corrupt_store", "Stored task step is invalid");
    }
    ids.add(step.id);
  }

  const events = task.events ?? [];
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    if (!event || event.sequence !== index + 1 || event.eventId !== `${task.id}:${index + 1}` ||
        !["task.created", "step.claimed", "step.completed", "step.failed", "step.cancelled",
          "step.lease_expired", "task.completed", "task.failed", "task.cancelled"].includes(event.type) ||
        !validTimestamp(event.occurredAt) || Date.parse(event.occurredAt) < Date.parse(task.createdAt) ||
        Date.parse(event.occurredAt) > Date.parse(task.updatedAt) ||
        (event.stepId !== undefined && (typeof event.stepId !== "string" || !ids.has(event.stepId))) ||
        (event.attemptId !== undefined && (typeof event.attemptId !== "string" || !event.attemptId.trim() || event.attemptId.length > 256)) ||
        (event.ownerId !== undefined && (typeof event.ownerId !== "string" || !event.ownerId.trim() || event.ownerId.length > 256)) ||
        (event.uncertain !== undefined && typeof event.uncertain !== "boolean") ||
        (event.resultingStepStatus !== undefined && !["pending", "running", "succeeded", "failed", "cancelled"].includes(event.resultingStepStatus)) ||
        (event.resultingTaskStatus !== undefined && !["ready", "running", "completed", "failed", "cancelled"].includes(event.resultingTaskStatus))) {
      throw new TaskLifecycleError("corrupt_store", "Stored task lifecycle event is invalid");
    }
  }

  for (const step of task.steps) {
    if (step.dependsOn.some(id => !ids.has(id))) {
      throw new TaskLifecycleError("corrupt_store", "Stored task contains an unknown dependency");
    }
  }
  const runningCount = task.steps.filter(step => step.status === "running").length;
  const hasFailed = task.steps.some(step => step.status === "failed");
  const hasCancelled = task.steps.some(step => step.status === "cancelled");
  const allSucceeded = task.steps.every(step => step.status === "succeeded");
  if (runningCount > task.maxConcurrentSteps ||
      task.steps.some(step => step.status === "running" &&
        step.dependsOn.some(id => task.steps.find(dep => dep.id === id)?.status !== "succeeded")) ||
      (task.status === "ready" && (runningCount > 0 || hasFailed || hasCancelled || allSucceeded || task.completedAt !== null)) ||
      (task.status === "running" && (runningCount === 0 || hasCancelled || task.completedAt !== null)) ||
      (task.status === "completed" && (!allSucceeded || !validTimestamp(task.completedAt))) ||
      (task.status === "failed" && (!hasFailed || runningCount > 0 ||
        task.steps.some(step => step.status === "pending") || !validTimestamp(task.completedAt))) ||
      (task.status === "cancelled" && (hasFailed || !hasCancelled || runningCount > 0 ||
        task.steps.some(step => step.status === "pending") || !validTimestamp(task.completedAt))) ||
      (task.completedAt !== null && (Date.parse(task.completedAt) < Date.parse(task.createdAt) ||
        Date.parse(task.completedAt) > Date.parse(task.updatedAt)))) {
    throw new TaskLifecycleError("corrupt_store", "Stored task state is inconsistent");
  }

  assertAcyclic(task.steps);
  return cloneTask({
    ...task,
    events: [...(task.events ?? [])].map(event => ({ ...event })),
    steps: task.steps.map(step => ({
      ...step,
      uncertain: step.uncertain ?? false,
      uncertainOnExpiredLease: step.uncertainOnExpiredLease ?? true
    }))
  });
}

function appendEvent(
  task: TaskRecord,
  type: TaskLifecycleEventType,
  now: Date,
  details: Omit<Partial<TaskLifecycleEvent>, "sequence" | "eventId" | "type" | "occurredAt"> = {}
): void {
  if (task.events.length >= MAX_TASK_LIFECYCLE_EVENTS) {
    throw new TaskLifecycleError("event_log_full", "Task lifecycle event history reached its retention limit");
  }
  const sequence = task.events.length + 1;
  task.events.push({
    sequence,
    eventId: `${task.id}:${sequence}`,
    type,
    occurredAt: now.toISOString(),
    ...details
  });
}

function appendTerminalEvent(previousStatus: TaskStatus, task: TaskRecord, now: Date): void {
  if (previousStatus === task.status) return;
  if (task.status === "completed") appendEvent(task, "task.completed", now, { resultingTaskStatus: task.status });
  else if (task.status === "failed") appendEvent(task, "task.failed", now, { resultingTaskStatus: task.status });
}

function isTerminal(status: TaskStatus): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}

function cloneTask(task: TaskRecord): TaskRecord {
  return {
    ...task,
    metadata: { ...task.metadata },
    events: [...(task.events ?? [])].map(event => ({ ...event })),
    steps: task.steps.map(step => ({
      ...step,
      dependsOn: [...step.dependsOn],
      attemptIds: [...step.attemptIds],
      currentAttempt: step.currentAttempt ? { ...step.currentAttempt } : null,
      evidenceRefs: [...step.evidenceRefs]
    }))
  };
}
