/**
 * Runtime for the East platform functions declared in src/east/index.ts.
 *
 * Inference is injected. This module does not import a model provider.
 * Nothing here grants permission. `authorized` is the constant false, and
 * `commitTaskEvidence` cannot return true. A device-evidence candidate is
 * checked with the existing `validateDeviceEvidenceCandidate` helper and
 * then discarded. `candidate_only` is not authorization. A task result is
 * also submitted to the existing APEX decision constant as a proposal.
 * East may surface that decision read-only. It cannot turn the decision
 * into `authorized`. This module does not verify signatures, write APEX
 * records, invent trust/RLS/schema contracts, or issue receipts.
 */

import { CORE_AGENTS } from "../../packages/intelligence/agents/AgentManager";
import { MemoryManager } from "../../packages/intelligence/memory/MemoryManager";
import type { AgentMessage } from "../../packages/intelligence/message-bus/MessageBus";
import type { InferenceProvider, InferenceResult } from "../../packages/intelligence/orchestrator/Orchestrator";
import { Orchestrator } from "../../packages/intelligence/orchestrator/Orchestrator";
import {
  validateDeviceEvidenceCandidate,
  type EvidenceAttemptBinding
} from "../../packages/director/src/lib/compliance/evidence-submission";
import {
  acceptApexDecision,
  liveApexDecision,
  proposalDigest,
  type EastApexCloseReason,
  type EastApexDecision
} from "./apex-decision";

export type { EastApexCloseReason, EastApexDecision };

export const EAST_DELIBERATION_AGENTS = [
  "director",
  "reasoner",
  "researcher",
  "engineer",
  "critic",
  "validator"
] as const;

const MAX_OBJECTIVE_LENGTH = 8_000;

export type EastPlatformErrorCode =
  | "invalid_objective"
  | "invalid_model"
  | "unknown_task"
  | "unknown_agent"
  | "not_assigned"
  | "inference_denied"
  | "evidence_rejected"
  | "apex_closed";

export type EastEvidenceRejectionReason = "invalid_shape" | "attempt_mismatch" | "nonce_reuse";

export class EastPlatformError extends Error {
  readonly code: EastPlatformErrorCode;
  /** Present when `code` is `evidence_rejected`. This is not an authorization decision. */
  readonly reason?: EastEvidenceRejectionReason;

  constructor(
    code: EastPlatformErrorCode,
    message: string,
    options?: { cause?: unknown; reason?: EastEvidenceRejectionReason }
  ) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = "EastPlatformError";
    this.code = code;
    this.reason = options?.reason;
  }
}

/**
 * Validator outcome for one `commitTaskEvidence` call.
 * `candidate_only` repeats the compliance helper's status. It is not accepted,
 * not stored as an APEX record, and not permission.
 */
export type EastEvidenceGate =
  | { readonly status: "not_submitted" }
  | { readonly status: "rejected"; readonly reason: EastEvidenceRejectionReason }
  | { readonly status: "candidate_only" };

/** Caller-supplied candidate. East does not keep the candidate or a nonce ledger. */
export interface EastEvidenceSubmission {
  candidate: unknown;
  attempt: EvidenceAttemptBinding;
  existingNonces?: ReadonlyArray<{ attempt_id: string; challenge_nonce: string }>;
}

export interface EastModelBinding {
  id: string;
  name: string;
  /** Opaque runtime path recorded for the router. Not a provider client. */
  runtimePath: string;
  contextLength: number;
  capabilities: readonly string[];
  memoryEstimateMB: number;
}

export interface EastAssignment {
  readonly id: string;
  readonly agentId: string;
}

export interface EastTaskRecord {
  readonly id: string;
  readonly objective: string;
  readonly assignments: readonly EastAssignment[];
  readonly synthesis: string | null;
  readonly evidenceRefs: readonly string[];
  /**
   * Latest device-evidence check. `not_submitted` until a candidate is passed.
   * Never an authorization receipt.
   */
  readonly evidenceGate: EastEvidenceGate;
  /**
   * Read-only APEX view. `pending` repeats the live gates and is not a grant.
   * `closed` means the response was missing, invalid, stale, or unreachable.
   */
  readonly apexDecision: EastApexDecision;
  /** Always false. This is not an APEX receipt. */
  readonly authorized: false;
}

export interface EastPlatformDependencies {
  inference: InferenceProvider;
  getResources: () => { availableMemoryMB: number; loadedModels: string[] };
  model: EastModelBinding;
  memory?: MemoryManager;
  createId?: () => string;
  /**
   * Replacement for the live `OPEN_DECISIONS` read. Used to exercise closed
   * responses. No value returned here can set `authorized`.
   */
  apex?: { read: () => Promise<unknown> };
  /** Milliseconds before an APEX read is closed. Range 1..1000. Not a bypass. */
  apexTimeoutMs?: number;
  now?: () => Date;
}

export interface EastPlatformRuntime {
  readonly orchestrator: Orchestrator;
  readonly memory: MemoryManager;
  createAgentTask(objective: string): string;
  assignAgent(taskId: string, agentId: string): string;
  executeAgent(taskId: string, agentId: string): Promise<string>;
  runDeliberation(taskId: string): Promise<{ synthesis: string; evidence: string[] }>;
  /**
   * Stores matching deliberation text as unverified memory when the device
   * evidence candidate is absent or only `candidate_only`.
   * A malformed, mismatched, or reused-nonce candidate fails closed and is
   * not stored. Returns false in every successful case. A true result would
   * be an authorization decision, and this gate does not have one.
   * The candidate itself is not persisted.
   * The APEX read must be a live pending decision before the matching
   * synthesis is stored. A closed read stores nothing further and still
   * returns false.
   */
  commitTaskEvidence(
    taskId: string,
    synthesis: string,
    submission?: EastEvidenceSubmission
  ): Promise<false>;
  /** Reads the APEX decision for this task and stores it. Never grants. */
  readApexDecision(taskId: string): Promise<EastApexDecision>;
  getTask(taskId: string): EastTaskRecord;
}

export function createEastPlatform(deps: EastPlatformDependencies): EastPlatformRuntime {
  if (!deps?.inference || typeof deps.inference.generate !== "function") {
    throw new EastPlatformError("inference_denied", "A real InferenceProvider must be supplied");
  }
  if (typeof deps.getResources !== "function") {
    throw new EastPlatformError("invalid_model", "A live resource provider must be supplied");
  }
  const apexTimeoutMs = deps.apexTimeoutMs ?? 1_000;
  if (!Number.isInteger(apexTimeoutMs) || apexTimeoutMs < 1 || apexTimeoutMs > 1_000) {
    throw new EastPlatformError("apex_closed", "APEX read timeout must be an integer from 1 to 1000 milliseconds");
  }
  if (deps.apex !== undefined && (typeof deps.apex !== "object" || typeof deps.apex.read !== "function")) {
    throw new EastPlatformError("apex_closed", "APEX reader is unreachable");
  }
  const apex = deps.apex ?? { read: () => Promise.resolve(liveApexDecision()) };
  const seenDecisionIds = new Set<string>();
  const model = normalizeModel(deps.model);
  const memory = deps.memory ?? new MemoryManager();
  const orchestrator = new Orchestrator({
    inference: deps.inference,
    getResources: deps.getResources,
    memory
  });
  orchestrator.models.register({
    id: model.id,
    name: model.name,
    path: model.runtimePath,
    contextLength: model.contextLength,
    capabilities: [...model.capabilities],
    memoryEstimateMB: model.memoryEstimateMB
  });
  for (const agent of CORE_AGENTS) {
    orchestrator.models.associateAgent(agent.id, model.id);
  }

  const createId = deps.createId ?? (() => crypto.randomUUID());
  const tasks = new Map<string, EastTaskRecord>();
  const evidenceCommitted = new Set<string>();

  function requireTask(taskId: string): EastTaskRecord {
    if (typeof taskId !== "string" || !taskId.trim()) {
      throw new EastPlatformError("unknown_task", "Task id is required");
    }
    const task = tasks.get(taskId);
    if (!task) throw new EastPlatformError("unknown_task", "Unknown task " + taskId);
    return task;
  }

  function put(task: EastTaskRecord): EastTaskRecord {
    const stored: EastTaskRecord = {
      id: task.id,
      objective: task.objective,
      assignments: task.assignments.map(assignment => ({ id: assignment.id, agentId: assignment.agentId })),
      synthesis: task.synthesis,
      evidenceRefs: [...task.evidenceRefs],
      evidenceGate: freezeEvidenceGate(task.evidenceGate),
      apexDecision: freezeApexDecision(task.apexDecision),
      authorized: false
    };
    tasks.set(stored.id, stored);
    return snapshot(stored);
  }

  function rejectEvidence(taskId: string, reason: EastEvidenceRejectionReason): never {
    put({
      ...requireTask(taskId),
      authorized: false,
      evidenceGate: { status: "rejected", reason }
    });
    throw new EastPlatformError("evidence_rejected", EVIDENCE_REJECTION_MESSAGE[reason], { reason });
  }

  return {
    orchestrator,
    memory,
    createAgentTask(objective) {
      if (typeof objective !== "string" || !objective.trim()) {
        throw new EastPlatformError("invalid_objective", "A non-empty objective is required");
      }
      const text = objective.trim();
      if (text.length > MAX_OBJECTIVE_LENGTH) {
        throw new EastPlatformError("invalid_objective", "Objective exceeds " + MAX_OBJECTIVE_LENGTH + " characters");
      }
      return put({
        id: "task-" + createId(),
        objective: text,
        assignments: [],
        synthesis: null,
        evidenceRefs: [],
        evidenceGate: { status: "not_submitted" },
        apexDecision: { status: "unread" },
        authorized: false
      }).id;
    },
    assignAgent(taskId, agentId) {
      const task = requireTask(taskId);
      if (typeof agentId !== "string" || !agentId.trim()) {
        throw new EastPlatformError("unknown_agent", "Agent id is required");
      }
      const agent = orchestrator.agents.getAgent(agentId);
      if (!agent || !agent.permanent) {
        throw new EastPlatformError("unknown_agent", "Unknown permanent agent " + agentId);
      }
      const existing = task.assignments.find(assignment => assignment.agentId === agentId);
      if (existing) return task.id;
      const assignment = { id: "asg-" + createId(), agentId };
      put({ ...task, assignments: [...task.assignments, assignment], authorized: false });
      return task.id;
    },
    async executeAgent(taskId, agentId) {
      const task = requireTask(taskId);
      if (!task.assignments.some(assignment => assignment.agentId === agentId)) {
        throw new EastPlatformError("not_assigned", "Agent " + agentId + " is not assigned to " + task.id);
      }
      const agent = orchestrator.agents.getAgent(agentId);
      if (!agent) throw new EastPlatformError("unknown_agent", "Unknown permanent agent " + agentId);
      const before = orchestrator.bus.getThread(task.id).length;
      let selectedDescriptor: Awaited<ReturnType<typeof orchestrator.router.route>> | undefined;
      let sessionId: string | undefined;
      try {
        const selected = await orchestrator.router.route(
          agentId,
          orchestrator.models.getPreferredModel(agentId),
          []
        );
        selectedDescriptor = selected;
        sessionId = orchestrator.agents.startSession(agentId, task.id, selected.id);
        orchestrator.agents.updateStatus(sessionId, "running");
        const prior = orchestrator.bus.getThread(task.id);
        const result = await deps.inference.generate({
          agentId,
          modelId: selected.id,
          stage: "independent",
          prompt: [
            "Task objective: " + task.objective,
            "Your role: " + agent.role,
            "Deliberation stage: independent",
            "Return only a structured analysis payload.",
            "Model output is not permission, approval, or an authorization receipt."
          ].join("\n"),
          contextMessages: [...prior]
        });
        const published = publishAnalysis(orchestrator, task.id, agentId, prior.length, result);
        orchestrator.agents.updateStatus(sessionId, "complete");
        return published.messageId;
      } catch (error) {
        if (orchestrator.bus.getThread(task.id).length !== before) {
          throw new EastPlatformError("inference_denied", "Agent execution changed the thread while failing", { cause: error });
        }
        if (error instanceof EastPlatformError) throw error;
        throw new EastPlatformError(
          "inference_denied",
          error instanceof Error ? error.message : "Agent execution was denied",
          { cause: error }
        );
      } finally {
        if (sessionId) orchestrator.agents.releaseSession(sessionId);
        if (selectedDescriptor) orchestrator.router.release(selectedDescriptor);
      }
    },
    async runDeliberation(taskId) {
      const task = requireTask(taskId);
      const missing = EAST_DELIBERATION_AGENTS.filter(
        agentId => !task.assignments.some(assignment => assignment.agentId === agentId)
      );
      if (missing.length > 0) {
        throw new EastPlatformError("not_assigned", "Deliberation requires assigned agents: " + missing.join(", "));
      }
      let result: { synthesis: string; evidenceRefs: string[] };
      try {
        result = await orchestrator.executeTask({
          id: task.id,
          objective: task.objective,
          requiredCapabilities: []
        });
      } catch (error) {
        throw new EastPlatformError(
          "inference_denied",
          error instanceof Error ? error.message : "Deliberation was denied",
          { cause: error }
        );
      }
      put({
        ...requireTask(task.id),
        synthesis: result.synthesis,
        evidenceRefs: [...result.evidenceRefs],
        authorized: false
      });
      return { synthesis: result.synthesis, evidence: [...result.evidenceRefs] };
    },
    async commitTaskEvidence(taskId, synthesis, submission) {
      const task = requireTask(taskId);
      let evidenceGate: EastEvidenceGate = task.evidenceGate;
      if (submission !== undefined) {
        const prepared = prepareEvidenceSubmission(submission);
        if (!prepared.ok) {
          rejectEvidence(task.id, prepared.reason);
        }
        const result = validateDeviceEvidenceCandidate(
          prepared.candidate,
          prepared.attempt,
          prepared.existingNonces
        );
        if (!result.ok) {
          rejectEvidence(task.id, result.reason);
        }
        // The candidate and its `candidate_only` payload are not stored.
        evidenceGate = { status: "candidate_only" };
      }
      const proposed = typeof synthesis === "string" ? synthesis : "";
      const current = requireTask(task.id);
      const decision = await readDecision(current, proposed);
      const matches = current.synthesis !== null && proposed === current.synthesis;
      if (decision.status === "pending" && matches && !evidenceCommitted.has(current.id)) {
        await memory.write({
          layer: "episodic",
          content: current.synthesis as string,
          provenance: {
            agentId: "director",
            taskId: current.id,
            verified: false,
            sourceRefs: [...current.evidenceRefs]
          }
        });
        evidenceCommitted.add(current.id);
      }
      put({ ...requireTask(task.id), authorized: false, evidenceGate, apexDecision: decision });
      return false;
    },
    async readApexDecision(taskId) {
      const task = requireTask(taskId);
      const decision = await readDecision(task, task.synthesis ?? "");
      put({ ...requireTask(task.id), authorized: false, apexDecision: decision });
      return snapshot(requireTask(task.id)).apexDecision;
    },
    getTask(taskId) {
      return snapshot(requireTask(taskId));
    }
  };

  async function readDecision(task: EastTaskRecord, synthesis: string): Promise<EastApexDecision> {
    const digest = proposalDigest({
      taskId: task.id,
      objective: task.objective,
      synthesis,
      evidenceRefs: task.evidenceRefs
    });
    const now = (deps.now ?? (() => new Date()))().getTime();
    if (!Number.isFinite(now)) {
      return freezeApexDecision({ status: "closed", reason: "unreachable", proposalDigest: digest });
    }
    const raced = await readWithTimeout(() => apex.read(), apexTimeoutMs);
    if (!raced.ok) {
      return freezeApexDecision({ status: "closed", reason: raced.reason, proposalDigest: digest });
    }
    const accepted = acceptApexDecision(raced.value, { now, seenDecisionIds });
    if (!accepted.ok) {
      return freezeApexDecision({ status: "closed", reason: accepted.reason, proposalDigest: digest });
    }
    if (accepted.decisionId !== null) seenDecisionIds.add(accepted.decisionId);
    return freezeApexDecision({
      status: "pending",
      rule: "pending",
      patch: "pending",
      release: "pending",
      proposalDigest: digest,
      trust: "unavailable"
    });
  }
}

function publishAnalysis(
  orchestrator: Orchestrator,
  taskId: string,
  agentId: string,
  sequence: number,
  result: InferenceResult
): AgentMessage {
  try {
    return orchestrator.bus.publish({
      messageId: crypto.randomUUID(),
      taskId,
      conversationId: taskId,
      senderAgentId: agentId,
      recipientAgentId: "broadcast",
      messageType: "analysis",
      payload: result.payload,
      evidenceRefs: result.evidenceRefs ?? [],
      createdAt: new Date().toISOString(),
      sequence
    });
  } catch (error) {
    throw new EastPlatformError(
      "inference_denied",
      "Model output was rejected and was not published",
      { cause: error }
    );
  }
}

function normalizeModel(model: EastModelBinding): EastModelBinding {
  if (!model || typeof model.id !== "string" || !model.id.trim()) {
    throw new EastPlatformError("invalid_model", "Model id is required");
  }
  if (typeof model.runtimePath !== "string" || !model.runtimePath.trim()) {
    throw new EastPlatformError("invalid_model", "Model runtime path is required");
  }
  if (!Array.isArray(model.capabilities) || model.capabilities.some(item => typeof item !== "string" || !item.trim())) {
    throw new EastPlatformError("invalid_model", "Model capabilities must be non-empty strings");
  }
  if (!Number.isInteger(model.contextLength) || model.contextLength <= 0) {
    throw new EastPlatformError("invalid_model", "Model context length must be a positive integer");
  }
  if (!Number.isFinite(model.memoryEstimateMB) || model.memoryEstimateMB <= 0) {
    throw new EastPlatformError("invalid_model", "Model memory estimate must be a positive number");
  }
  return {
    id: model.id.trim(),
    name: typeof model.name === "string" && model.name.trim() ? model.name.trim() : model.id.trim(),
    runtimePath: model.runtimePath.trim(),
    contextLength: model.contextLength,
    capabilities: model.capabilities.map(item => item.trim()),
    memoryEstimateMB: model.memoryEstimateMB
  };
}

function snapshot(task: EastTaskRecord): EastTaskRecord {
  return Object.freeze({
    id: task.id,
    objective: task.objective,
    assignments: Object.freeze(task.assignments.map(assignment => Object.freeze({ ...assignment }))),
    synthesis: task.synthesis,
    evidenceRefs: Object.freeze([...task.evidenceRefs]),
    evidenceGate: freezeEvidenceGate(task.evidenceGate),
    apexDecision: freezeApexDecision(task.apexDecision),
    authorized: false
  });
}

function freezeApexDecision(decision: EastApexDecision | undefined): EastApexDecision {
  if (!decision || decision.status === "unread") return Object.freeze({ status: "unread" });
  if (decision.status === "closed") {
    return Object.freeze({
      status: "closed",
      reason: decision.reason,
      proposalDigest: decision.proposalDigest
    });
  }
  return Object.freeze({
    status: "pending",
    rule: "pending" as const,
    patch: "pending" as const,
    release: "pending" as const,
    proposalDigest: decision.proposalDigest,
    trust: "unavailable" as const
  });
}

async function readWithTimeout(
  read: () => Promise<unknown>,
  timeoutMs: number
): Promise<{ ok: true; value: unknown } | { ok: false; reason: "timeout" | "unreachable" }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<{ kind: "timeout" }>(resolve => {
    timer = setTimeout(() => resolve({ kind: "timeout" }), timeoutMs);
  });
  const attempt = Promise.resolve()
    .then(() => read())
    .then(value => ({ kind: "value" as const, value }))
    .catch(() => ({ kind: "error" as const }));
  try {
    const winner = await Promise.race([attempt, timeout]);
    if (winner.kind === "timeout") return { ok: false, reason: "timeout" };
    if (winner.kind === "error") return { ok: false, reason: "unreachable" };
    return { ok: true, value: winner.value };
  } catch {
    return { ok: false, reason: "unreachable" };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const EVIDENCE_REJECTION_MESSAGE: Record<EastEvidenceRejectionReason, string> = {
  invalid_shape: "Device evidence candidate is malformed and was not committed",
  attempt_mismatch: "Device evidence does not match the attempt and was not committed",
  nonce_reuse: "Device evidence reuses another attempt's challenge nonce and was not committed"
};

function freezeEvidenceGate(gate: EastEvidenceGate): EastEvidenceGate {
  if (!gate || gate.status === "not_submitted") return Object.freeze({ status: "not_submitted" });
  if (gate.status === "candidate_only") return Object.freeze({ status: "candidate_only" });
  if (gate.status === "rejected") return Object.freeze({ status: "rejected", reason: gate.reason });
  return Object.freeze({ status: "not_submitted" });
}

type PreparedEvidenceSubmission =
  | {
      ok: true;
      candidate: unknown;
      attempt: EvidenceAttemptBinding;
      existingNonces: Array<{ attempt_id: string; challenge_nonce: string }>;
    }
  | { ok: false; reason: EastEvidenceRejectionReason };

/**
 * Checks only that a submission can be passed into the existing validator.
 * Fitness, mismatch, and nonce reuse stay in `validateDeviceEvidenceCandidate`.
 */
function prepareEvidenceSubmission(submission: EastEvidenceSubmission): PreparedEvidenceSubmission {
  if (!submission || typeof submission !== "object" || Array.isArray(submission)) {
    return { ok: false, reason: "invalid_shape" };
  }
  const record = submission as unknown as Record<string, unknown>;
  const allowed = new Set(["candidate", "attempt", "existingNonces"]);
  if (!("candidate" in record) || !("attempt" in record)) return { ok: false, reason: "invalid_shape" };
  if (Object.keys(record).some(key => !allowed.has(key))) return { ok: false, reason: "invalid_shape" };
  if (!isAttemptBinding(record.attempt)) return { ok: false, reason: "invalid_shape" };
  const existingNonces = copyNonceHistory(record.existingNonces);
  if (existingNonces === null) return { ok: false, reason: "invalid_shape" };
  return { ok: true, candidate: record.candidate, attempt: record.attempt, existingNonces };
}

function isAttemptBinding(value: unknown): value is EvidenceAttemptBinding {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const keys = ["conversation_request_id", "attempt_id", "model_file_hash", "runtime_session_id", "device_id"];
  if (Object.keys(record).length !== keys.length || keys.some(key => !(key in record))) return false;
  if (typeof record.conversation_request_id !== "string" || record.conversation_request_id.length === 0) return false;
  if (typeof record.attempt_id !== "string" || record.attempt_id.length === 0) return false;
  for (const key of ["model_file_hash", "runtime_session_id", "device_id"] as const) {
    const field = record[key];
    if (field !== null && typeof field !== "string") return false;
  }
  return true;
}

function copyNonceHistory(
  value: unknown
): Array<{ attempt_id: string; challenge_nonce: string }> | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  const rows: Array<{ attempt_id: string; challenge_nonce: string }> = [];
  for (const row of value) {
    if (!row || typeof row !== "object" || Array.isArray(row)) return null;
    const record = row as Record<string, unknown>;
    const keys = Object.keys(record);
    if (keys.length !== 2 || !keys.includes("attempt_id") || !keys.includes("challenge_nonce")) return null;
    if (typeof record.attempt_id !== "string" || record.attempt_id.length === 0) return null;
    if (typeof record.challenge_nonce !== "string" || record.challenge_nonce.length === 0) return null;
    rows.push({ attempt_id: record.attempt_id, challenge_nonce: record.challenge_nonce });
  }
  return rows;
}
