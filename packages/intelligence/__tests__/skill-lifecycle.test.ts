import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  authorizeSkillPromotion,
  createSkillArtifact,
  createSkillEvaluation,
  skillAssignmentDigest,
  skillRubricDigest,
  transitionSkillLifecycle,
  verifySkillArtifactIntegrity,
  verifySkillEvaluationIntegrity,
  type SkillApproval,
  type SkillEvaluationInput,
  type SkillPromotionAuthorization
} from "../skills/SkillLifecycle";
import type { Skill } from "../skills/SkillRegistry";

const sha = (value: string) => createHash("sha256").update(value).digest("hex");

const skill: Skill = {
  id: "swift-runtime-analysis",
  layer: 1,
  title: "Swift runtime analysis",
  knowledge: ["Swift concurrency", "iOS runtime lifecycle"],
  specialists: [],
  coreAgents: ["engineer"],
  ecosystem: "general",
  labOnly: false
};

async function makeArtifact(overrides: Record<string, unknown> = {}) {
  return createSkillArtifact({
    skill,
    version: "0.1.0",
    description: "A bounded, non-executable skill artifact for Swift runtime analysis.",
    prerequisites: ["programming-foundations"],
    learningObjectives: ["Explain actor isolation", "Identify unsafe session lifetimes"],
    exercises: [
      {
        id: "actor-isolation",
        objective: "Analyze a supplied actor-isolation example",
        environment: "synthetic",
        successCriteria: ["Identify actor-isolated state"],
        evidenceRequired: ["evaluation-report"],
        safetyBoundary: "Use only the supplied synthetic example; do not execute submitted code."
      },
      {
        id: "session-lifecycle",
        objective: "Review a supplied model-session lifecycle trace",
        environment: "documentation-only",
        successCriteria: ["Identify release ordering defects"],
        evidenceRequired: ["evaluation-report"],
        safetyBoundary: "Read-only trace analysis; no device or runtime actions."
      }
    ],
    sources: [{
      url: "https://developer.apple.com/documentation/swift",
      title: "The Swift Programming Language",
      section: "Concurrency",
      retrievedAt: "2026-11-14T12:00:00.000Z",
      contentSHA256: sha("source snapshot"),
      confidence: 0.95,
      reviewState: "reviewed"
    }],
    assessment: {
      rubric: ["Technical correctness", "Evidence quality"],
      minimumPassingExercises: 2,
      requiredCompetencyLevel: 3,
      humanReviewRequired: true
    },
    createdAt: "2026-11-14T12:00:00.000Z",
    createdBy: "researcher",
    ...overrides
  });
}

async function makeEvaluation(
  artifact: Awaited<ReturnType<typeof makeArtifact>>,
  overrides: Partial<SkillEvaluationInput> = {}
) {
  return createSkillEvaluation({
    skillId: artifact.skill.id,
    version: artifact.version,
    artifactDigest: artifact.digest,
    evaluatorId: "validator",
    evaluatedAt: "2026-11-14T13:00:00.000Z",
    rubricDigest: await skillRubricDigest(artifact.assessment.rubric),
    results: [
      { exerciseId: "actor-isolation", passed: true, evidenceRefs: ["evidence://actor-isolation"] },
      { exerciseId: "session-lifecycle", passed: true, evidenceRefs: ["evidence://session-lifecycle"] }
    ],
    ...overrides
  });
}

async function makeApproval(
  artifact: Awaited<ReturnType<typeof makeArtifact>>,
  evaluation: Awaited<ReturnType<typeof makeEvaluation>>
): Promise<SkillApproval> {
  return {
    skillId: artifact.skill.id,
    version: artifact.version,
    artifactDigest: artifact.digest,
    evaluationDigest: evaluation.digest,
    assignmentDigest: await skillAssignmentDigest(artifact.skill),
    approverId: "human-reviewer",
    approvedAt: "2026-11-14T14:00:00.000Z",
    approvalRef: "approval://review-123"
  };
}

describe("Skill lifecycle integrity and promotion", () => {
  it("creates canonical content digests and detects artifact tampering", async () => {
    const artifact = await makeArtifact();
    expect(await verifySkillArtifactIntegrity(artifact)).toBe(true);
    const tampered = {
      ...artifact,
      skill: { ...artifact.skill, title: "Tampered title" }
    };
    expect(await verifySkillArtifactIntegrity(tampered)).toBe(false);
  });

  it("validates and digests evaluation records", async () => {
    const artifact = await makeArtifact();
    const evaluation = await makeEvaluation(artifact);
    expect(await verifySkillEvaluationIntegrity(evaluation)).toBe(true);
    expect(await verifySkillEvaluationIntegrity({ ...evaluation, results: [] })).toBe(false);
  });

  it("requires independently verified evaluation and exact human approval", async () => {
    const artifact = await makeArtifact();
    const evaluation = await makeEvaluation(artifact);
    const approval = await makeApproval(artifact, evaluation);
    const result = await authorizeSkillPromotion(artifact, evaluation, approval, {
      verifyEvaluation: async candidate => candidate.digest === evaluation.digest,
      verifyApproval: async candidate => candidate.approvalRef === approval.approvalRef
    });
    expect(result.authorized).toBe(true);
    expect(result.authorization).toMatchObject({
      skillId: artifact.skill.id,
      version: artifact.version,
      artifactDigest: artifact.digest,
      evaluationDigest: evaluation.digest,
      assignmentDigest: await skillAssignmentDigest(artifact.skill)
    });
  });

  it("rejects evaluations whose rubric digest differs from the artifact rubric", async () => {
    const artifact = await makeArtifact();
    const mismatched = await makeEvaluation(artifact, { rubricDigest: sha("a different rubric") });
    const result = await authorizeSkillPromotion(
      artifact, mismatched, await makeApproval(artifact, mismatched),
      { verifyEvaluation: async () => true, verifyApproval: async () => true }
    );
    expect(result).toMatchObject({ authorized: false });
    expect(result.reason).toMatch(/rubric does not match/);
  });

  it("rejects approval copied from another skill digest or assignment set", async () => {
    const artifact = await makeArtifact();
    const evaluation = await makeEvaluation(artifact);
    const approval = { ...await makeApproval(artifact, evaluation), artifactDigest: sha("different artifact") };
    const result = await authorizeSkillPromotion(artifact, evaluation, approval, {
      verifyEvaluation: async () => true,
      verifyApproval: async () => true
    });
    expect(result).toMatchObject({ authorized: false });
    expect(result.reason).toMatch(/does not bind/);
  });

  it("rejects self-evaluation, unreviewed sources, and missing exercise evidence", async () => {
    const artifact = await makeArtifact();
    const selfEvaluation = await makeEvaluation(artifact, { evaluatorId: "researcher" });
    const approval = await makeApproval(artifact, selfEvaluation);
    const selfResult = await authorizeSkillPromotion(artifact, selfEvaluation, approval, {
      verifyEvaluation: async () => true,
      verifyApproval: async () => true
    });
    expect(selfResult.reason).toMatch(/cannot be its sole evaluator/);

    const unreviewed = await makeArtifact({
      sources: [{
        url: "https://developer.apple.com/documentation/swift",
        title: "Swift",
        section: "Concurrency",
        retrievedAt: "2026-11-14T12:00:00.000Z",
        contentSHA256: sha("source snapshot"),
        confidence: 0.9,
        reviewState: "unreviewed"
      }]
    });
    const unreviewedEvaluation = await makeEvaluation(unreviewed);
    const unreviewedResult = await authorizeSkillPromotion(
      unreviewed, unreviewedEvaluation, await makeApproval(unreviewed, unreviewedEvaluation),
      { verifyEvaluation: async () => true, verifyApproval: async () => true }
    );
    expect(unreviewedResult.reason).toMatch(/source must be reviewed/);

    const incomplete = await makeEvaluation(artifact, {
      results: [{ exerciseId: "actor-isolation", passed: true, evidenceRefs: [] }]
    });
    const incompleteResult = await authorizeSkillPromotion(
      artifact, incomplete, await makeApproval(artifact, incomplete),
      { verifyEvaluation: async () => true, verifyApproval: async () => true }
    );
    expect(incompleteResult.reason).toMatch(/Insufficient passing exercises/);
  });

  it("fails closed when a verifier throws or rejects", async () => {
    const artifact = await makeArtifact();
    const evaluation = await makeEvaluation(artifact);
    const approval = await makeApproval(artifact, evaluation);
    const thrown = await authorizeSkillPromotion(artifact, evaluation, approval, {
      verifyEvaluation: async () => { throw new Error("offline"); },
      verifyApproval: async () => true
    });
    expect(thrown.authorized).toBe(false);
    expect(thrown.reason).toMatch(/verifier failed/);

    const rejected = await authorizeSkillPromotion(artifact, evaluation, approval, {
      verifyEvaluation: async () => false,
      verifyApproval: async () => true
    });
    expect(rejected.authorized).toBe(false);
  });

  it("requires an unforgeable, digest-bound promotion before approval and activation", async () => {
    const artifact = await makeArtifact();
    expect(() => transitionSkillLifecycle("proposed", "active")).toThrow(/Invalid skill lifecycle/);
    expect(() => transitionSkillLifecycle("evaluating", "approved")).toThrow(/promotion authorization/);

    const evaluation = await makeEvaluation(artifact);
    const approval = await makeApproval(artifact, evaluation);
    const verified = await authorizeSkillPromotion(artifact, evaluation, approval, {
      verifyEvaluation: async () => true,
      verifyApproval: async () => true
    });
    const authorization = verified.authorization!;
    expect(Object.isFrozen(authorization)).toBe(true);
    expect(Reflect.set(authorization, "evaluationDigest", sha("tampered evaluation"))).toBe(false);
    expect(Reflect.set(authorization, "assignmentDigest", sha("tampered assignments"))).toBe(false);
    const expected = {
      skillId: artifact.skill.id,
      version: artifact.version,
      artifactDigest: artifact.digest
    };

    expect(transitionSkillLifecycle("evaluating", "approved", authorization, expected)).toBe("approved");
    expect(transitionSkillLifecycle("approved", "active", authorization, expected)).toBe("active");
    expect(() => transitionSkillLifecycle("approved", "active", {
      ...authorization, artifactDigest: sha("wrong")
    }, expected)).toThrow(/promotion authorization/);

    const fabricated = {
      skillId: artifact.skill.id,
      version: artifact.version,
      artifactDigest: artifact.digest,
      evaluationDigest: evaluation.digest,
      assignmentDigest: await skillAssignmentDigest(artifact.skill),
      verifiedAt: "2026-11-14T14:00:00.000Z"
    };
    expect(() => transitionSkillLifecycle("evaluating", "approved", fabricated, expected))
      .toThrow(/promotion authorization/);
    expect(() => transitionSkillLifecycle("quarantined", "researching")).toThrow(/Invalid skill lifecycle/);
  });

  it("requires every evidence-mandated exercise even when the passing threshold is lower", async () => {
    const artifact = await makeArtifact({
      assessment: {
        rubric: ["Technical correctness", "Evidence quality"],
        minimumPassingExercises: 1,
        requiredCompetencyLevel: 3,
        humanReviewRequired: true
      }
    });
    const evaluation = await makeEvaluation(artifact, {
      results: [
        { exerciseId: "actor-isolation", passed: true, evidenceRefs: ["evidence://actor-isolation"] },
        { exerciseId: "session-lifecycle", passed: false, evidenceRefs: [] }
      ]
    });
    const result = await authorizeSkillPromotion(
      artifact, evaluation, await makeApproval(artifact, evaluation),
      { verifyEvaluation: async () => true, verifyApproval: async () => true }
    );
    expect(result.authorized).toBe(false);
    expect(result.reason).toMatch(/required evidence exercise has not passed/);
  });

  it("keeps the artifact descriptive and does not add tool or permission grants", async () => {
    const artifact = await makeArtifact();
    expect(artifact.skill).not.toHaveProperty("tools");
    expect(artifact.skill).not.toHaveProperty("permissions");
    expect(artifact.exercises.every(exercise => exercise.safetyBoundary.length > 0)).toBe(true);
  });
});
