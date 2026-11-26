/**
 * Agent Learning & Improvement tool.
 *
 * Agents may propose learning from approved evidence, request an isolated
 * candidate-training run, and compare that candidate against a paired
 * benchmark. This module never changes live model weights, prompts, routing,
 * permissions, memory, or production configuration.
 *
 * Training and evidence access are host-injected capabilities. A missing
 * adapter fails closed. Candidate artifacts remain unpromoted; a passing
 * assessment means eligible for independent human review only.
 */
import {
  assessImprovement,
  type AssessmentOptions,
  type EvaluationRun,
  type ImprovementAssessment
} from "../evaluation/ImprovementEngine";

export type LearningChangeKind =
  | "prompt"
  | "retrieval"
  | "routing"
  | "tool-workflow"
  | "adapter-training";

export interface LearningEvidence {
  readonly sourceRef: string;
  readonly contentDigest: string;
  readonly verifiedAt: string;
  readonly content: string;
  /** Set by the trusted evidence adapter, never by the model or caller. */
  readonly approved: true;
}

export interface LearningEvidenceReader {
  readApproved(input: {
    readonly taskId: string;
    readonly sourceRefs: readonly string[];
  }): Promise<readonly LearningEvidence[]>;
}

export interface LearningProposal {
  readonly proposalId: string;
  readonly taskId: string;
  readonly agentId: string;
  readonly objective: string;
  readonly changeKind: LearningChangeKind;
  readonly evidenceRefs: readonly string[];
  readonly evidenceDigests: readonly string[];
  readonly createdAt: string;
  readonly status: "proposed";
}

export interface TrainingBudget {
  readonly maxRuntimeSeconds: number;
  readonly maxMemoryMB: number;
  readonly maxOutputBytes: number;
}

export interface CandidateTrainingRequest {
  readonly taskId: string;
  readonly approvalRef: string;
  readonly proposalId: string;
  readonly baselineModelId: string;
  readonly datasetRef: string;
  readonly datasetVersion: string;
  readonly budget: TrainingBudget;
  readonly hyperparameters: Readonly<Record<string, string | number | boolean>>;
}

export interface IsolatedTrainingJob {
  readonly jobId: string;
  readonly proposal: LearningProposal;
  readonly baselineModelId: string;
  readonly datasetRef: string;
  readonly datasetVersion: string;
  readonly budget: TrainingBudget;
  readonly hyperparameters: Readonly<Record<string, string | number | boolean>>;
  readonly isolation: "disposable-no-network";
  readonly outputPolicy: "candidate-only";
}

export interface CandidateTrainingResult {
  readonly candidateModelRef: string;
  readonly sandboxRunRef: string;
  readonly completedAt: string;
  readonly metrics: Readonly<Record<string, number>>;
}

export interface TrainingApprovalRequest {
  readonly operation: "train-candidate";
  readonly taskId: string;
  readonly proposalId: string;
  readonly jobDigest: string;
  readonly approvalRef: string;
}

export interface TrainingApprovalVerifier {
  /** Verifies independent human approval bound to this exact training job. */
  verify(input: TrainingApprovalRequest): boolean | Promise<boolean>;
}

export interface TrainingSandbox {
  /**
   * The host implementation must use a disposable, resource-limited worker
   * with no network access, production secrets, or write access to live
   * model/configuration paths. It must return only a candidate artifact.
   */
  run(job: IsolatedTrainingJob): Promise<CandidateTrainingResult>;
}

export interface LearningCandidate {
  readonly candidateId: string;
  readonly proposalId: string;
  readonly baselineModelId: string;
  readonly candidateModelRef: string;
  readonly datasetRef: string;
  readonly datasetVersion: string;
  readonly sandboxRunRef: string;
  readonly completedAt: string;
  readonly metrics: Readonly<Record<string, number>>;
  readonly status: "candidate-only";
}

export interface CandidateAssessment {
  readonly candidateId: string;
  readonly assessment: ImprovementAssessment;
  readonly status: "eligible-for-human-review" | "keep-baseline";
}

export interface PairedEvaluationRuns {
  readonly baselineRun: EvaluationRun;
  readonly candidateRun: EvaluationRun;
}

export interface CandidateEvaluationRunner {
  /** Runs both artifacts against one immutable, versioned benchmark suite. */
  runPaired(input: {
    readonly candidate: LearningCandidate;
    readonly benchmarkVersion: string;
  }): Promise<PairedEvaluationRuns>;
}

export interface AgentLearningToolOptions {
  readonly evidenceReader?: LearningEvidenceReader;
  readonly trainingSandbox?: TrainingSandbox;
  readonly trainingApprovalVerifier?: TrainingApprovalVerifier;
  readonly evaluationRunner?: CandidateEvaluationRunner;
  readonly now?: () => number;
  readonly id?: () => string;
}

const CHANGE_KINDS: readonly LearningChangeKind[] = [
  "prompt", "retrieval", "routing", "tool-workflow", "adapter-training"
];

export class AgentLearningTool {
  private readonly evidenceReader?: LearningEvidenceReader;
  private readonly trainingSandbox?: TrainingSandbox;
  private readonly trainingApprovalVerifier?: TrainingApprovalVerifier;
  private readonly evaluationRunner?: CandidateEvaluationRunner;
  private readonly now: () => number;
  private readonly id: () => string;
  private readonly proposals = new Map<string, LearningProposal>();
  private readonly candidates = new Map<string, LearningCandidate>();

  constructor(options: AgentLearningToolOptions = {}) {
    this.evidenceReader = options.evidenceReader;
    this.trainingSandbox = options.trainingSandbox;
    this.trainingApprovalVerifier = options.trainingApprovalVerifier;
    this.evaluationRunner = options.evaluationRunner;
    this.now = options.now ?? (() => Date.now());
    this.id = options.id ?? (() => crypto.randomUUID());
  }

  /** Create a proposal from evidence the host independently confirms as approved. */
  async propose(input: {
    taskId: string;
    agentId: string;
    objective: string;
    changeKind: LearningChangeKind;
    evidenceRefs: readonly string[];
  }): Promise<LearningProposal> {
    if (!this.evidenceReader) throw new Error("Approved learning evidence reader is not configured");
    if (!input?.taskId?.trim() || !input.agentId?.trim() || !input.objective?.trim()) {
      throw new Error("taskId, agentId, and objective are required");
    }
    if (!CHANGE_KINDS.includes(input.changeKind)) throw new Error("Unsupported learning change kind");
    const refs = normalizeRefs(input.evidenceRefs);
    const evidence = await this.evidenceReader.readApproved({
      taskId: input.taskId,
      sourceRefs: refs
    });
    if (!Array.isArray(evidence) || evidence.length !== refs.length) {
      throw new Error("Evidence reader did not return every requested source");
    }
    const byRef = new Map<string, LearningEvidence>();
    for (const item of evidence) {
      if (!item || item.approved !== true || typeof item.sourceRef !== "string" ||
          typeof item.contentDigest !== "string" || !item.contentDigest.trim() ||
          typeof item.verifiedAt !== "string" || !Number.isFinite(Date.parse(item.verifiedAt)) ||
          typeof item.content !== "string" || !item.content.trim()) {
        throw new Error("Learning evidence is incomplete or not approved");
      }
      if (byRef.has(item.sourceRef)) throw new Error("Evidence reader returned duplicate source references");
      byRef.set(item.sourceRef, item);
    }
    if (refs.some(ref => !byRef.has(ref))) throw new Error("Learning evidence references do not match the request");

    const proposal: LearningProposal = Object.freeze({
      proposalId: this.id(),
      taskId: input.taskId,
      agentId: input.agentId,
      objective: input.objective,
      changeKind: input.changeKind,
      evidenceRefs: Object.freeze([...refs]),
      evidenceDigests: Object.freeze(refs.map(ref => byRef.get(ref)!.contentDigest)),
      createdAt: new Date(this.now()).toISOString(),
      status: "proposed" as const
    });
    if (this.proposals.has(proposal.proposalId)) throw new Error("Duplicate learning proposal id");
    this.proposals.set(proposal.proposalId, proposal);
    return proposal;
  }

  /**
   * Train an isolated candidate only. The live model and production
   * configuration are not reachable through this interface.
   */
  async train(input: CandidateTrainingRequest): Promise<LearningCandidate> {
    if (!this.trainingSandbox) throw new Error("Isolated training sandbox is not configured");
    if (!this.trainingApprovalVerifier) throw new Error("Independent training approval is not configured");
    if (!input?.taskId?.trim() || !input.approvalRef?.trim() || !input.proposalId?.trim() ||
        !input.baselineModelId?.trim() || !input.datasetRef?.trim() || !input.datasetVersion?.trim()) {
      throw new Error("taskId, approvalRef, proposalId, baselineModelId, datasetRef, and datasetVersion are required");
    }
    const proposal = this.proposals.get(input.proposalId);
    if (!proposal) throw new Error("Unknown learning proposal");
    if (proposal.taskId !== input.taskId) {
      throw new Error("Learning proposal belongs to a different task");
    }
    if (proposal.changeKind !== "adapter-training") {
      throw new Error("Only adapter-training proposals can start a training job");
    }
    const budget = validateBudget(input.budget);
    const hyperparameters = validateHyperparameters(input.hyperparameters);
    const jobId = this.id();
    const jobDigest = await digestJob({
      jobId, taskId: input.taskId, proposal, baselineModelId: input.baselineModelId,
      datasetRef: input.datasetRef, datasetVersion: input.datasetVersion,
      budget, hyperparameters
    });
    const approved = await this.trainingApprovalVerifier.verify(Object.freeze({
      operation: "train-candidate" as const,
      taskId: input.taskId,
      proposalId: proposal.proposalId,
      jobDigest,
      approvalRef: input.approvalRef
    }));
    if (approved !== true) throw new Error("Independent training approval was denied");
    const result = await this.trainingSandbox.run(Object.freeze({
      jobId,
      proposal,
      baselineModelId: input.baselineModelId,
      datasetRef: input.datasetRef,
      datasetVersion: input.datasetVersion,
      budget,
      hyperparameters,
      isolation: "disposable-no-network" as const,
      outputPolicy: "candidate-only" as const
    }));
    if (!result || typeof result.candidateModelRef !== "string" || !result.candidateModelRef.trim() ||
        typeof result.sandboxRunRef !== "string" || !result.sandboxRunRef.trim() ||
        typeof result.completedAt !== "string" || !Number.isFinite(Date.parse(result.completedAt)) ||
        !result.metrics || typeof result.metrics !== "object" || Array.isArray(result.metrics)) {
      throw new Error("Training sandbox returned an invalid candidate result");
    }
    const metrics: Record<string, number> = {};
    for (const [key, value] of Object.entries(result.metrics)) {
      if (!key.trim() || !Number.isFinite(value)) throw new Error("Training metrics must be finite numbers");
      metrics[key] = value;
    }
    const candidate: LearningCandidate = Object.freeze({
      candidateId: this.id(),
      proposalId: proposal.proposalId,
      baselineModelId: input.baselineModelId,
      candidateModelRef: result.candidateModelRef,
      datasetRef: input.datasetRef,
      datasetVersion: input.datasetVersion,
      sandboxRunRef: result.sandboxRunRef,
      completedAt: result.completedAt,
      metrics: Object.freeze(metrics),
      status: "candidate-only" as const
    });
    if (this.candidates.has(candidate.candidateId)) throw new Error("Duplicate candidate id");
    this.candidates.set(candidate.candidateId, candidate);
    return candidate;
  }

  /** Ask the trusted host runner to evaluate both artifacts on one benchmark suite. */
  async evaluate(input: {
    candidateId: string;
    benchmarkVersion: string;
    options?: AssessmentOptions;
  }): Promise<CandidateAssessment> {
    if (!this.evaluationRunner) throw new Error("Trusted candidate evaluation runner is not configured");
    if (!input?.candidateId?.trim() || !input.benchmarkVersion?.trim()) {
      throw new Error("candidateId and benchmarkVersion are required");
    }
    const candidate = this.candidates.get(input.candidateId);
    if (!candidate) throw new Error("Unknown learning candidate");
    const runs = await this.evaluationRunner.runPaired({
      candidate,
      benchmarkVersion: input.benchmarkVersion
    });
    if (!runs?.baselineRun || !runs.candidateRun) throw new Error("Evaluation runner returned incomplete paired runs");
    if (runs.baselineRun.datasetVersion !== input.benchmarkVersion ||
        runs.candidateRun.datasetVersion !== input.benchmarkVersion) {
      throw new Error("Evaluation runs do not match the requested benchmark version");
    }
    return this.assess({
      candidateId: candidate.candidateId,
      baselineRun: runs.baselineRun,
      candidateRun: runs.candidateRun,
      options: input.options
    });
  }

  /** Compare paired baseline/candidate runs; never promotes or deploys. */
  assess(input: {
    candidateId: string;
    baselineRun: EvaluationRun;
    candidateRun: EvaluationRun;
    options?: AssessmentOptions;
  }): CandidateAssessment {
    const candidate = this.candidates.get(input?.candidateId);
    if (!candidate) throw new Error("Unknown learning candidate");
    if (input.baselineRun.modelId !== candidate.baselineModelId ||
        input.candidateRun.modelId !== candidate.candidateModelRef) {
      throw new Error("Evaluation runs do not match the registered baseline and candidate artifacts");
    }
    // The benchmark dataset is distinct from the training dataset. The paired
    // evaluator enforces that baseline and candidate use the same benchmark
    // version and exact case IDs.
    const assessment = assessImprovement(input.baselineRun, input.candidateRun, input.options);
    return Object.freeze({
      candidateId: candidate.candidateId,
      assessment,
      status: assessment.eligibleForHumanReview ? "eligible-for-human-review" : "keep-baseline"
    });
  }

  getProposal(proposalId: string): LearningProposal | undefined {
    return this.proposals.get(proposalId);
  }

  getCandidate(candidateId: string): LearningCandidate | undefined {
    return this.candidates.get(candidateId);
  }
}

async function digestJob(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join("");
}

function normalizeRefs(input: readonly string[]): string[] {
  if (!Array.isArray(input) || input.length < 1 || input.length > 50) {
    throw new Error("evidenceRefs must contain between 1 and 50 references");
  }
  const refs = input.map(ref => {
    if (typeof ref !== "string" || !ref.trim() || ref.length > 2048) {
      throw new Error("Evidence references must be non-empty bounded strings");
    }
    return ref;
  });
  if (new Set(refs).size !== refs.length) throw new Error("Evidence references must be unique");
  return refs;
}

function validateBudget(input: TrainingBudget): TrainingBudget {
  if (!input || !Number.isSafeInteger(input.maxRuntimeSeconds) || input.maxRuntimeSeconds < 1 ||
      !Number.isSafeInteger(input.maxMemoryMB) || input.maxMemoryMB < 128 ||
      !Number.isSafeInteger(input.maxOutputBytes) || input.maxOutputBytes < 1) {
    throw new Error("Training budget must set positive runtime/output and at least 128 MB memory limits");
  }
  return Object.freeze({ ...input });
}

function validateHyperparameters(
  input: Readonly<Record<string, string | number | boolean>>
): Readonly<Record<string, string | number | boolean>> {
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).length > 100) {
    throw new Error("Training hyperparameters must be a bounded object");
  }
  const copy: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(input)) {
    if (!key.trim() || key.length > 128 ||
        !(typeof value === "string" || typeof value === "boolean" ||
          (typeof value === "number" && Number.isFinite(value)))) {
      throw new Error("Training hyperparameters must contain bounded primitive values");
    }
    copy[key] = value;
  }
  return Object.freeze(copy);
}
