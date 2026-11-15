import { SkillRegistry, type Skill } from "./SkillRegistry";

export type SkillLifecycleStatus =
  | "proposed"
  | "researching"
  | "drafted"
  | "evaluating"
  | "approved"
  | "active"
  | "deprecated"
  | "quarantined";

export type SkillExerciseEnvironment = "synthetic" | "isolated-lab" | "documentation-only";
export type SkillSourceReviewState = "unreviewed" | "reviewed" | "rejected";

export interface SkillExercise {
  id: string;
  objective: string;
  environment: SkillExerciseEnvironment;
  successCriteria: string[];
  evidenceRequired: string[];
  safetyBoundary: string;
}

export interface SkillSourceReference {
  url: string;
  title: string;
  section: string;
  retrievedAt: string;
  contentSHA256: string;
  confidence: number;
  reviewState: SkillSourceReviewState;
}

export interface SkillAssessment {
  rubric: string[];
  minimumPassingExercises: number;
  requiredCompetencyLevel: 0 | 1 | 2 | 3 | 4 | 5;
  humanReviewRequired: boolean;
}

export interface SkillArtifactInput {
  skill: Skill;
  version: string;
  description: string;
  prerequisites: string[];
  learningObjectives: string[];
  exercises: SkillExercise[];
  sources: SkillSourceReference[];
  assessment: SkillAssessment;
  createdAt: string;
  createdBy: string;
  previousDigest?: string;
}

export interface SkillArtifact extends SkillArtifactInput {
  schemaVersion: 1;
  digest: string;
}

export interface SkillExerciseResult {
  exerciseId: string;
  passed: boolean;
  evidenceRefs: string[];
}

export interface SkillEvaluationInput {
  skillId: string;
  version: string;
  artifactDigest: string;
  evaluatorId: string;
  evaluatedAt: string;
  rubricDigest: string;
  results: SkillExerciseResult[];
}

export interface SkillEvaluation extends SkillEvaluationInput {
  digest: string;
}

export interface SkillApproval {
  skillId: string;
  version: string;
  artifactDigest: string;
  evaluationDigest: string;
  assignmentDigest: string;
  approverId: string;
  approvedAt: string;
  approvalRef: string;
}

export interface SkillPromotionAuthorization {
  skillId: string;
  version: string;
  artifactDigest: string;
  evaluationDigest: string;
  assignmentDigest: string;
  verifiedAt: string;
}

export interface SkillPromotionVerifiers {
  /** Must validate deterministic evaluation evidence, not model self-report. */
  verifyEvaluation(evaluation: SkillEvaluation): Promise<boolean>;
  /** Must validate an authenticated human approval bound to all supplied digests. */
  verifyApproval(approval: SkillApproval): Promise<boolean>;
}

export interface SkillPromotionResult {
  authorized: boolean;
  reason: string;
  authorization?: SkillPromotionAuthorization;
}

const STATUS_TRANSITIONS: Record<SkillLifecycleStatus, readonly SkillLifecycleStatus[]> = {
  proposed: ["researching", "quarantined"],
  researching: ["drafted", "quarantined"],
  drafted: ["evaluating", "quarantined"],
  evaluating: ["approved", "quarantined"],
  approved: ["active", "quarantined"],
  active: ["deprecated", "quarantined"],
  deprecated: [],
  quarantined: []
};

const SHA256 = /^[a-f0-9]{64}$/;
const VERSION = /^\d+\.\d+\.\d+$/;
// Runtime-private capability: callers cannot mint an accepted promotion token
// merely by constructing a structurally compatible TypeScript object.
const verifiedPromotionTokens = new WeakSet<object>();

function stableValue(value: unknown): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(stableValue);
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      if (record[key] === undefined) throw new Error("Canonical data cannot contain undefined values");
      result[key] = stableValue(record[key]);
    }
    return result;
  }
  throw new Error("Canonical data must contain only JSON-compatible values");
}

async function digest(value: unknown): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new Error("Web Crypto SHA-256 is unavailable");
  const bytes = new TextEncoder().encode(JSON.stringify(stableValue(value)));
  const hash = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join("");
}

function artifactPayload(artifact: SkillArtifact | SkillArtifactInput): SkillArtifactInput {
  const { schemaVersion: _schemaVersion, digest: _digest, ...payload } = artifact as SkillArtifact;
  return payload;
}

function evaluationPayload(evaluation: SkillEvaluation | SkillEvaluationInput): SkillEvaluationInput {
  const { digest: _digest, ...payload } = evaluation as SkillEvaluation;
  return payload;
}

export async function createSkillArtifact(input: SkillArtifactInput): Promise<SkillArtifact> {
  validateArtifactInput(input);
  const payload = { schemaVersion: 1 as const, ...input };
  return { ...payload, digest: await digest(payload) };
}

export async function verifySkillArtifactIntegrity(artifact: SkillArtifact): Promise<boolean> {
  try {
    if (artifact.schemaVersion !== 1 || !SHA256.test(artifact.digest)) return false;
    validateArtifactInput(artifactPayload(artifact));
    return await digest({ schemaVersion: artifact.schemaVersion, ...artifactPayload(artifact) }) === artifact.digest;
  } catch {
    return false;
  }
}

export async function createSkillEvaluation(input: SkillEvaluationInput): Promise<SkillEvaluation> {
  validateEvaluationInput(input);
  return { ...input, digest: await digest(input) };
}

export async function verifySkillEvaluationIntegrity(evaluation: SkillEvaluation): Promise<boolean> {
  try {
    if (!SHA256.test(evaluation.digest)) return false;
    validateEvaluationInput(evaluationPayload(evaluation));
    return await digest(evaluationPayload(evaluation)) === evaluation.digest;
  } catch {
    return false;
  }
}

/** Digest the exact rubric stored in the immutable skill artifact. */
export async function skillRubricDigest(rubric: readonly string[]): Promise<string> {
  if (!Array.isArray(rubric) || rubric.length === 0 ||
      rubric.some(item => typeof item !== "string" || !item.trim())) {
    throw new Error("A non-empty, valid assessment rubric is required");
  }
  return digest([...rubric]);
}

/**
 * Authorizes promotion of a skill artifact only when independent evaluation
 * and authenticated human approval both bind to the exact artifact,
 * evaluation, and assignment digests. This does not grant tools or permissions.
 */
export async function authorizeSkillPromotion(
  artifact: SkillArtifact,
  evaluation: SkillEvaluation,
  approval: SkillApproval,
  verifiers: SkillPromotionVerifiers
): Promise<SkillPromotionResult> {
  if (!await verifySkillArtifactIntegrity(artifact)) return denied("Skill artifact integrity check failed");
  if (!await verifySkillEvaluationIntegrity(evaluation)) return denied("Evaluation integrity check failed");
  if (evaluation.rubricDigest !== await skillRubricDigest(artifact.assessment.rubric)) {
    return denied("Evaluation rubric does not match the exact skill assessment rubric");
  }
  if (artifact.sources.length === 0 || artifact.sources.some(source => source.reviewState !== "reviewed")) {
    return denied("Every source must be reviewed before promotion");
  }
  if (evaluation.skillId !== artifact.skill.id || evaluation.version !== artifact.version ||
      evaluation.artifactDigest !== artifact.digest) {
    return denied("Evaluation is not bound to this exact skill version");
  }
  if (evaluation.evaluatorId === artifact.createdBy) {
    return denied("The skill author cannot be its sole evaluator");
  }

  const resultsById = new Map(evaluation.results.map(result => [result.exerciseId, result]));
  if (resultsById.size !== evaluation.results.length) return denied("Evaluation contains duplicate exercise results");
  const requiredIds = artifact.exercises.map(exercise => exercise.id);
  if (evaluation.results.some(result => !requiredIds.includes(result.exerciseId))) {
    return denied("Evaluation references an unknown exercise");
  }
  const passed = evaluation.results.filter(result => result.passed && result.evidenceRefs.length > 0);
  if (passed.length < artifact.assessment.minimumPassingExercises) {
    return denied("Insufficient passing exercises with evidence");
  }
  const requiredEvidenceExercises = artifact.exercises.filter(exercise => exercise.evidenceRequired.length > 0);
  if (requiredEvidenceExercises.some(exercise =>
    !evaluation.results.some(result =>
      result.exerciseId === exercise.id && result.passed && result.evidenceRefs.length > 0
    )
  )) {
    return denied("A required evidence exercise has not passed");
  }

  try {
    // Reuse the production registry's owner validation without mutating the
    // operational registry or activating the candidate.
    new SkillRegistry([artifact.skill]);
  } catch {
    return denied("Skill assignment contains an unknown owner or invalid metadata");
  }

  const assignmentDigest = await skillAssignmentDigest(artifact.skill);
  if (approval.skillId !== artifact.skill.id ||
      approval.version !== artifact.version ||
      approval.artifactDigest !== artifact.digest ||
      approval.evaluationDigest !== evaluation.digest ||
      approval.assignmentDigest !== assignmentDigest ||
      !approval.approverId.trim() ||
      !approval.approvalRef.trim() ||
      !validTimestamp(approval.approvedAt)) {
    return denied("Human approval does not bind to the exact artifact, evaluation, and assignments");
  }

  let evaluationVerified = false;
  let approvalVerified = false;
  try {
    [evaluationVerified, approvalVerified] = await Promise.all([
      verifiers.verifyEvaluation(evaluation),
      verifiers.verifyApproval(approval)
    ]);
  } catch {
    return denied("A required promotion verifier failed");
  }
  if (!evaluationVerified) return denied("Independent evaluation evidence was not verified");
  if (!approvalVerified) return denied("Human approval was not verified");

  const authorization: SkillPromotionAuthorization = {
    skillId: artifact.skill.id,
    version: artifact.version,
    artifactDigest: artifact.digest,
    evaluationDigest: evaluation.digest,
    assignmentDigest,
    verifiedAt: new Date().toISOString()
  };
  verifiedPromotionTokens.add(authorization);
  return {
    authorized: true,
    reason: "Exact skill artifact, evaluation, assignments, and human approval were verified",
    authorization
  };
}

export async function skillAssignmentDigest(skill: Pick<Skill, "specialists" | "coreAgents">): Promise<string> {
  return digest({
    specialists: [...skill.specialists].sort(),
    coreAgents: [...skill.coreAgents].sort()
  });
}

export function transitionSkillLifecycle(
  current: SkillLifecycleStatus,
  next: SkillLifecycleStatus,
  promotion?: SkillPromotionAuthorization,
  expected?: { skillId: string; version: string; artifactDigest: string }
): SkillLifecycleStatus {
  if (!Object.prototype.hasOwnProperty.call(STATUS_TRANSITIONS, current) ||
      !Object.prototype.hasOwnProperty.call(STATUS_TRANSITIONS, next) ||
      !STATUS_TRANSITIONS[current].includes(next)) {
    throw new Error("Invalid skill lifecycle transition: " + current + " -> " + next);
  }
  if (next === "approved" || next === "active") {
    if (!promotion || !verifiedPromotionTokens.has(promotion) || !expected ||
        promotion.skillId !== expected.skillId ||
        promotion.version !== expected.version ||
        promotion.artifactDigest !== expected.artifactDigest ||
        !SHA256.test(promotion.evaluationDigest) ||
        !SHA256.test(promotion.assignmentDigest) ||
        !validTimestamp(promotion.verifiedAt)) {
      throw new Error("Verified promotion authorization must match the exact skill version and digest");
    }
  }
  return next;
}

function validateArtifactInput(input: SkillArtifactInput): void {
  if (!input || !input.skill || !VERSION.test(input.version)) throw new Error("Skill version must use semantic x.y.z form");
  if (!input.description?.trim() || !input.createdBy?.trim() || !validTimestamp(input.createdAt)) {
    throw new Error("Skill description, creator, and valid creation timestamp are required");
  }
  if (!Array.isArray(input.prerequisites) || input.prerequisites.some(item => typeof item !== "string" || !item.trim()) ||
      !Array.isArray(input.learningObjectives) ||
      input.learningObjectives.length === 0 || input.learningObjectives.some(item => typeof item !== "string" || !item.trim())) {
    throw new Error("Skill learning objectives must be non-empty");
  }
  if (!Array.isArray(input.exercises) || input.exercises.length === 0) {
    throw new Error("At least one bounded exercise is required");
  }
  const exerciseIds = new Set<string>();
  for (const exercise of input.exercises) {
    if (!["synthetic", "isolated-lab", "documentation-only"].includes(exercise.environment) ||
        !exercise.id.trim() || exerciseIds.has(exercise.id) || !exercise.objective.trim() ||
        !exercise.safetyBoundary.trim() || exercise.successCriteria.length === 0 ||
        exercise.successCriteria.some(item => !item.trim()) ||
        exercise.evidenceRequired.some(item => !item.trim())) {
      throw new Error("Exercise definitions must be unique, bounded, and complete");
    }
    exerciseIds.add(exercise.id);
  }
  if (!Array.isArray(input.sources) || input.sources.length === 0) {
    throw new Error("At least one provenance source is required");
  }
  for (const source of input.sources) {
    let parsed: URL;
    try { parsed = new URL(source.url); } catch { throw new Error("Source URL is invalid"); }
    if (parsed.protocol !== "https:" || !source.title.trim() || !source.section.trim() ||
        !validTimestamp(source.retrievedAt) || !SHA256.test(source.contentSHA256) ||
        !Number.isFinite(source.confidence) || source.confidence < 0 || source.confidence > 1 ||
        !["unreviewed", "reviewed", "rejected"].includes(source.reviewState)) {
      throw new Error("Source provenance is incomplete or invalid");
    }
  }
  const assessment = input.assessment;
  if (!assessment || !Array.isArray(assessment.rubric) || assessment.rubric.length === 0 ||
      assessment.rubric.some(item => !item.trim()) ||
      !Number.isInteger(assessment.minimumPassingExercises) ||
      assessment.minimumPassingExercises < 1 || assessment.minimumPassingExercises > input.exercises.length ||
      ![0, 1, 2, 3, 4, 5].includes(assessment.requiredCompetencyLevel) ||
      typeof assessment.humanReviewRequired !== "boolean") {
    throw new Error("Skill assessment rubric or thresholds are invalid");
  }
  if (input.previousDigest !== undefined && !SHA256.test(input.previousDigest)) {
    throw new Error("Previous skill digest must be SHA-256");
  }
  new SkillRegistry([input.skill]);
}

function validateEvaluationInput(input: SkillEvaluationInput): void {
  if (!input.skillId.trim() || !VERSION.test(input.version) || !SHA256.test(input.artifactDigest) ||
      !input.evaluatorId.trim() || !validTimestamp(input.evaluatedAt) || !SHA256.test(input.rubricDigest) ||
      !Array.isArray(input.results) || input.results.some(result =>
        !result.exerciseId.trim() || typeof result.passed !== "boolean" ||
        !Array.isArray(result.evidenceRefs) || result.evidenceRefs.some(ref => !ref.trim())
      )) {
    throw new Error("Skill evaluation record is invalid");
  }
}

function validTimestamp(value: string): boolean {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString() === value;
}

function denied(reason: string): SkillPromotionResult {
  return { authorized: false, reason };
}
