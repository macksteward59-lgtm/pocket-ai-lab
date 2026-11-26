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
}

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
}

export interface StepClaim {
  taskId: string;
  stepId: string;
  attemptId: string;
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

  constructor(options: {
    store: TaskLifecycleStore;
    now?: () => Date;
    createId?: () => string;
  }) {
    if (!options?.store || typeof options.store.load !== "function" || typeof options.store.save !== "function") {
      throw new TaskLifecycleError("invalid_store", "A task lifecycle store is required");
    }
    this.store = options.store;
    this.now = options.now ?? (() => new Date());
    this.createId = options.createId ?? (() => crypto.randomUUID());
  }

  async init(): Promise<void> {
    await this.mutate(async () => {
      if (this.initialized) return;
      const loaded = await this.store.load();
      const next = new Map<string, TaskRecord>();
      for (const raw of loaded) {
        const task = validateStoredTask(raw);
        if (next.has(task.id)) throw new TaskLifecycleError("duplicate_task", "Duplicate task id in store");
        next.set(task.id, task);
      }
      this.records = next;
      this.initialized = true;
    });
  }

  async createTask(definition: TaskDefinition): Promise<TaskRecord> {
    return this.mutate(async () => {
      this.requireInitialized();
      const task = normalizeDefinition(definition, this.now());
      if (this.records.has(task.id)) throw new TaskLifecycleError("duplicate_task", "Task id already exists");
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
      if (isTerminal(task.status)) return null;
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
        startedAt: now.toISOString(),
        leaseExpiresAt: expires.toISOString()
      };
      updated.status = "running";
      updated.updatedAt = now.toISOString();
      await this.replaceTask(updated);

      return {
        taskId,
        stepId: target.id,
        attemptId,
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
      step.status = "succeeded";
      step.result = input.result.trim();
      step.evidenceRefs = [...new Set(refs)];
      step.completedAt = now.toISOString();
      step.currentAttempt = null;
      const final = refreshTaskStatus(updated, now);
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
  }): Promise<TaskRecord> {
    return this.mutate(async () => {
      this.requireInitialized();
      const task = this.requireTask(input.taskId);
      const now = this.now();
      const updated = cloneTask(task);
      const step = this.requireActiveAttempt(updated, input.stepId, input.attemptId, now);
      if (typeof input.error !== "string" || !input.error.trim() || (input.retryable !== undefined && typeof input.retryable !== "boolean")) {
        throw new TaskLifecycleError("invalid_error", "A failure reason and boolean retryable flag are required");
      }
      step.lastError = input.error.trim().slice(0, 2_000);
      step.currentAttempt = null;
      step.status = input.retryable === true && step.attempts < step.maxAttempts ? "pending" : "failed";
      const final = refreshTaskStatus(updated, now);
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
          step.status = "cancelled";
          step.currentAttempt = null;
        }
      }
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
          step.lastError = "Execution lease expired before completion";
          step.currentAttempt = null;
          step.status = step.attempts < step.maxAttempts ? "pending" : "failed";
          recovered += 1;
          changed = true;
        }
        if (changed) next.set(id, refreshTaskStatus(updated, now));
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
      result: null, evidenceRefs: [], lastError: null
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
    createdAt: timestamp, updatedAt: timestamp, completedAt: null
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
    next.status = "failed";
    // A terminal task cannot retain live leases or runnable descendants.
    for (const step of next.steps) {
      if (step.status === "pending" || step.status === "running") {
        step.status = "cancelled";
        step.currentAttempt = null;
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
  if (!task || typeof task.id !== "string" || !task.id.trim() ||
      typeof task.objective !== "string" || !task.objective.trim() ||
      !Array.isArray(task.steps) || task.steps.length < 1 ||
      !["ready", "running", "completed", "failed", "cancelled"].includes(task.status) ||
      !Number.isInteger(task.maxConcurrentSteps) || task.maxConcurrentSteps < 1 || task.maxConcurrentSteps > 8 ||
      !Number.isInteger(task.leaseMs) || task.leaseMs < 1_000 || task.leaseMs > 900_000 ||
      !task.metadata || typeof task.metadata !== "object" || Array.isArray(task.metadata)) {
    throw new TaskLifecycleError("corrupt_store", "Stored task record is invalid");
  }
  const ids = new Set(task.steps.map(step => step?.id));
  if (ids.size !== task.steps.length || task.steps.some(step =>
    !step || typeof step.id !== "string" || !step.id.trim() ||
    typeof step.description !== "string" || !step.description.trim() ||
    !["pending", "running", "succeeded", "failed", "cancelled"].includes(step.status) ||
    !Array.isArray(step.dependsOn) || step.dependsOn.some(id => !ids.has(id)) ||
    !Number.isInteger(step.attempts) || step.attempts < 0 ||
    !Array.isArray(step.attemptIds) || step.attemptIds.length !== step.attempts ||
    step.attemptIds.some(id => typeof id !== "string" || !id.trim()) || new Set(step.attemptIds).size !== step.attemptIds.length ||
    !Number.isInteger(step.maxAttempts) || step.maxAttempts < 1 || step.maxAttempts > 5 ||
    !Array.isArray(step.evidenceRefs) ||
    (step.status === "running") !== (step.currentAttempt !== null) ||
    (step.currentAttempt !== null && (!step.currentAttempt ||
      typeof step.currentAttempt.id !== "string" || !step.currentAttempt.id.trim() ||
      !Number.isFinite(Date.parse(step.currentAttempt.leaseExpiresAt)) ||
      !Number.isFinite(Date.parse(step.currentAttempt.startedAt))))
  )) throw new TaskLifecycleError("corrupt_store", "Stored task step is invalid");
  if (task.status === "completed" && task.steps.some(step => step.status !== "succeeded")) {
    throw new TaskLifecycleError("corrupt_store", "Completed task contains unfinished steps");
  }
  if ((task.status === "failed" || task.status === "cancelled") &&
      task.steps.some(step => step.status === "running" || step.status === "pending")) {
    throw new TaskLifecycleError("corrupt_store", "Terminal task contains runnable steps");
  }
  assertAcyclic(task.steps);
  return cloneTask(task);
}

function isTerminal(status: TaskStatus): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}

function cloneTask(task: TaskRecord): TaskRecord {
  return {
    ...task,
    metadata: { ...task.metadata },
    steps: task.steps.map(step => ({
      ...step,
      dependsOn: [...step.dependsOn],
      attemptIds: [...step.attemptIds],
      currentAttempt: step.currentAttempt ? { ...step.currentAttempt } : null,
      evidenceRefs: [...step.evidenceRefs]
    }))
  };
}
