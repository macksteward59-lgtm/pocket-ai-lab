import { describe, expect, it } from "vitest";
import {
  AgentLearningTool,
  type LearningEvidenceReader,
  type TrainingSandbox,
  type CandidateTrainingRequest
} from "../learning/AgentLearningTool";
import type { EvaluationRun } from "../evaluation/ImprovementEngine";

function run(modelId: string, runId: string, score: number): EvaluationRun {
  return {
    runId,
    modelId,
    datasetVersion: "eval-v1",
    completedAt: "2026-11-18T12:00:00.000Z",
    results: Array.from({ length: 5 }, (_, index) => ({
      caseId: "case-" + index,
      score,
      passed: score >= 0.7,
      safetyViolation: false,
      latencyMs: 100
    }))
  };
}

function makeEvidenceReader(approved = true): LearningEvidenceReader {
  return {
    async readApproved({ sourceRefs }) {
      return sourceRefs.map(sourceRef => ({
        sourceRef,
        contentDigest: "sha256:" + sourceRef,
        verifiedAt: "2026-11-18T12:00:00.000Z",
        content: "Reviewed learning material",
        approved: approved as true
      }));
    }
  };
}

function makeTool(sandbox?: TrainingSandbox) {
  let next = 0;
  return new AgentLearningTool({
    evidenceReader: makeEvidenceReader(),
    trainingSandbox: sandbox,
    now: () => Date.parse("2026-11-18T12:00:00.000Z"),
    id: () => "id-" + (++next)
  });
}

async function adapterProposal(tool: AgentLearningTool) {
  return tool.propose({
    taskId: "task-1",
    agentId: "engineer",
    objective: "Improve adapter quality without changing the baseline",
    changeKind: "adapter-training",
    evidenceRefs: ["reviewed:dataset-notes"]
  });
}

const trainingRequest = (proposalId: string): CandidateTrainingRequest => ({
  proposalId,
  baselineModelId: "baseline-model",
  datasetRef: "approved-dataset",
  datasetVersion: "eval-v1",
  budget: { maxRuntimeSeconds: 300, maxMemoryMB: 1024, maxOutputBytes: 50_000_000 },
  hyperparameters: { epochs: 2, learningRate: 0.0001, method: "lora" }
});

describe("AgentLearningTool", () => {
  it("creates proposals only from host-approved evidence", async () => {
    const tool = makeTool();
    const proposal = await adapterProposal(tool);
    expect(proposal.status).toBe("proposed");
    expect(proposal.evidenceRefs).toEqual(["reviewed:dataset-notes"]);
    expect(Object.isFrozen(proposal)).toBe(true);
  });

  it("fails closed when approved evidence is unavailable or unapproved", async () => {
    const noReader = new AgentLearningTool();
    await expect(adapterProposal(noReader)).rejects.toThrow(/reader is not configured/);
    const untrusted = new AgentLearningTool({ evidenceReader: makeEvidenceReader(false) });
    await expect(adapterProposal(untrusted)).rejects.toThrow(/not approved/);
  });

  it("rejects duplicate evidence references and invalid proposal metadata", async () => {
    const tool = makeTool();
    await expect(tool.propose({
      taskId: "task-1", agentId: "engineer", objective: "Improve",
      changeKind: "adapter-training", evidenceRefs: ["same", "same"]
    })).rejects.toThrow(/unique/);
    await expect(tool.propose({
      taskId: "", agentId: "engineer", objective: "Improve",
      changeKind: "adapter-training", evidenceRefs: ["source"]
    })).rejects.toThrow(/required/);
  });

  it("runs training only through an injected isolated candidate-only sandbox", async () => {
    let observed: unknown;
    const sandbox: TrainingSandbox = {
      async run(job) {
        observed = job;
        return {
          candidateModelRef: "candidate-model",
          sandboxRunRef: "sandbox-run-1",
          completedAt: "2026-11-18T12:05:00.000Z",
          metrics: { trainLoss: 0.42 }
        };
      }
    };
    const tool = makeTool(sandbox);
    const proposal = await adapterProposal(tool);
    const candidate = await tool.train(trainingRequest(proposal.proposalId));
    expect(observed).toMatchObject({
      isolation: "disposable-no-network",
      outputPolicy: "candidate-only",
      baselineModelId: "baseline-model",
      datasetVersion: "eval-v1"
    });
    expect(candidate.status).toBe("candidate-only");
    expect(candidate.candidateModelRef).toBe("candidate-model");
  });

  it("does not train non-training proposals or run without a sandbox", async () => {
    const tool = makeTool();
    const proposal = await tool.propose({
      taskId: "task-1", agentId: "researcher", objective: "Improve retrieval",
      changeKind: "retrieval", evidenceRefs: ["source"]
    });
    await expect(tool.train(trainingRequest(proposal.proposalId))).rejects.toThrow(/sandbox is not configured/);

    const withSandbox = makeTool({ async run() {
      throw new Error("should not run");
    } });
    const nonTraining = await withSandbox.propose({
      taskId: "task-2", agentId: "researcher", objective: "Improve retrieval",
      changeKind: "retrieval", evidenceRefs: ["source"]
    });
    await expect(withSandbox.train(trainingRequest(nonTraining.proposalId))).rejects.toThrow(/Only adapter-training/);
  });

  it("rejects invalid resource budgets before invoking the sandbox", async () => {
    let calls = 0;
    const tool = makeTool({ async run() {
      calls += 1;
      throw new Error("unexpected");
    } });
    const proposal = await adapterProposal(tool);
    await expect(tool.train({
      ...trainingRequest(proposal.proposalId),
      budget: { maxRuntimeSeconds: 0, maxMemoryMB: 1, maxOutputBytes: 0 }
    })).rejects.toThrow(/budget/);
    expect(calls).toBe(0);
  });

  it("requires paired evaluation to match the exact registered baseline, candidate, and dataset", async () => {
    const tool = makeTool({ async run() {
      return {
        candidateModelRef: "candidate-model",
        sandboxRunRef: "sandbox-run-1",
        completedAt: "2026-11-18T12:05:00.000Z",
        metrics: { trainLoss: 0.42 }
      };
    } });
    const proposal = await adapterProposal(tool);
    const candidate = await tool.train(trainingRequest(proposal.proposalId));
    expect(() => tool.assess({
      candidateId: candidate.candidateId,
      baselineRun: run("wrong-baseline", "baseline-run", 0.6),
      candidateRun: run("candidate-model", "candidate-run", 0.8)
    })).toThrow(/do not match/);
    expect(() => tool.assess({
      candidateId: candidate.candidateId,
      baselineRun: run("baseline-model", "baseline-run", 0.6),
      candidateRun: { ...run("candidate-model", "candidate-run", 0.8), datasetVersion: "wrong-version" }
    })).toThrow(/dataset version/);
  });

  it("returns human-review eligibility but never promotes a candidate", async () => {
    const tool = makeTool({ async run() {
      return {
        candidateModelRef: "candidate-model",
        sandboxRunRef: "sandbox-run-1",
        completedAt: "2026-11-18T12:05:00.000Z",
        metrics: { trainLoss: 0.42 }
      };
    } });
    const proposal = await adapterProposal(tool);
    const candidate = await tool.train(trainingRequest(proposal.proposalId));
    const result = tool.assess({
      candidateId: candidate.candidateId,
      baselineRun: run("baseline-model", "baseline-run", 0.6),
      candidateRun: run("candidate-model", "candidate-run", 0.8)
    });
    expect(result.status).toBe("eligible-for-human-review");
    expect(result.assessment.recommendation).toBe("review_candidate");
    expect(tool.getCandidate(candidate.candidateId)?.status).toBe("candidate-only");
  });

  it("keeps the baseline when paired benchmark quality does not improve", async () => {
    const tool = makeTool({ async run() {
      return {
        candidateModelRef: "candidate-model",
        sandboxRunRef: "sandbox-run-1",
        completedAt: "2026-11-18T12:05:00.000Z",
        metrics: { trainLoss: 0.42 }
      };
    } });
    const proposal = await adapterProposal(tool);
    const candidate = await tool.train(trainingRequest(proposal.proposalId));
    const result = tool.assess({
      candidateId: candidate.candidateId,
      baselineRun: run("baseline-model", "baseline-run", 0.8),
      candidateRun: run("candidate-model", "candidate-run", 0.7)
    });
    expect(result.status).toBe("keep-baseline");
    expect(result.assessment.recommendation).toBe("keep_baseline");
  });
});
