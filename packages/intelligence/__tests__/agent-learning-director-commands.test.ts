import { describe, expect, it } from "vitest";
import { AgentLearningTool } from "../learning/AgentLearningTool";
import { DirectorCommandRouter, parseDirectorCommand } from "../director/DirectorCommandRouter";
import { DirectorCapabilities } from "../director/DirectorCapabilities";
import { MemoryManager } from "../memory/MemoryManager";
import { ToolDirector } from "../tooling/ToolDirector";
import { ToolRegistry } from "../security/tools";

function learningTool() {
  let trainingCalls = 0;
  const tool = new AgentLearningTool({
    evidenceReader: {
      async readApproved({ sourceRefs }) {
        return sourceRefs.map(sourceRef => ({
          sourceRef, contentDigest: "digest-" + sourceRef,
          verifiedAt: "2026-11-18T12:00:00.000Z",
          content: "approved source", approved: true as const
        }));
      }
    },
    trainingApprovalVerifier: { async verify() { return true; } },
    trainingSandbox: {
      async run() {
        trainingCalls += 1;
        return {
          candidateModelRef: "candidate-1",
          sandboxRunRef: "sandbox-1",
          completedAt: "2026-11-18T12:05:00.000Z",
          metrics: { loss: 0.4 }
        };
      }
    }
  });
  return { tool, getTrainingCalls: () => trainingCalls };
}

function router(learning: AgentLearningTool) {
  return new DirectorCommandRouter(
    new DirectorCapabilities({ memory: new MemoryManager() }),
    new ToolDirector({ registry: new ToolRegistry() }),
    learning
  );
}

describe("Director agent-learning commands", () => {
  it("adds only the bounded learning commands to the finite vocabulary", () => {
    expect(parseDirectorCommand({
      kind: "propose-agent-learning", agentId: "engineer", objective: "Improve code quality",
      changeKind: "adapter-training", evidenceRefs: ["approved:source-1"]
    })).toMatchObject({ kind: "propose-agent-learning", agentId: "engineer" });
    expect(() => parseDirectorCommand({
      kind: "propose-agent-learning", agentId: "engineer", objective: "Improve",
      changeKind: "adapter-training", evidenceRefs: ["source"], shell: "unsafe"
    })).toThrow(/outside the selected command contract/);
    expect(() => parseDirectorCommand({
      kind: "propose-agent-learning", agentId: "engineer", objective: "Improve",
      changeKind: "unknown", evidenceRefs: ["source"]
    })).toThrow(/change kind/);
    expect(parseDirectorCommand({
      kind: "evaluate-agent-candidate", candidateId: "candidate-1", benchmarkVersion: "bench-v1"
    })).toMatchObject({ kind: "evaluate-agent-candidate", candidateId: "candidate-1" });
  });

  it("routes proposals through the host-approved evidence reader and binds the task id", async () => {
    const { tool } = learningTool();
    const result = await router(tool).dispatch({ taskId: "director-task-1" }, {
      kind: "propose-agent-learning", agentId: "engineer",
      objective: "Improve the adapter using reviewed examples",
      changeKind: "adapter-training", evidenceRefs: ["approved:source-1"]
    });
    expect(result).toMatchObject({
      taskId: "director-task-1", agentId: "engineer", status: "proposed",
      evidenceRefs: ["approved:source-1"]
    });
  });

  it("routes training only through digest-bound approval and the isolated sandbox", async () => {
    const { tool, getTrainingCalls } = learningTool();
    const commands = router(tool);
    const proposal = await commands.dispatch({ taskId: "director-task-2" }, {
      kind: "propose-agent-learning", agentId: "engineer", objective: "Train a candidate adapter",
      changeKind: "adapter-training", evidenceRefs: ["approved:source-2"]
    }) as { proposalId: string };
    const result = await commands.dispatch({ taskId: "director-task-2" }, {
      kind: "train-agent-candidate", proposalId: proposal.proposalId,
      baselineModelId: "baseline-1", datasetRef: "approved:training-set",
      datasetVersion: "bench-v1",
      budget: { maxRuntimeSeconds: 120, maxMemoryMB: 1024, maxOutputBytes: 1000000 },
      hyperparameters: { method: "lora", epochs: 2 },
      approvalRef: "human-approved-job"
    });
    expect(result).toMatchObject({ candidateModelRef: "candidate-1", status: "candidate-only" });
    expect(getTrainingCalls()).toBe(1);
  });

  it("routes evaluation to the trusted runner using only a candidate id and benchmark version", async () => {
    const learning = new AgentLearningTool({
      evidenceReader: {
        async readApproved({ sourceRefs }) {
          return sourceRefs.map(sourceRef => ({
            sourceRef, contentDigest: "digest", verifiedAt: "2026-11-18T12:00:00.000Z",
            content: "approved", approved: true as const
          }));
        }
      },
      trainingApprovalVerifier: { async verify() { return true; } },
      trainingSandbox: { async run() {
        return {
          candidateModelRef: "candidate-1", sandboxRunRef: "sandbox-1",
          completedAt: "2026-11-18T12:05:00.000Z", metrics: { loss: 0.4 }
        };
      } },
      evaluationRunner: {
        async runPaired() {
          const makeRun = (modelId: string, runId: string, score: number) => ({
            modelId, runId, datasetVersion: "bench-v1", completedAt: "2026-11-18T12:10:00.000Z",
            results: Array.from({ length: 5 }, (_, index) => ({
              caseId: "case-" + index, score, passed: score >= 0.7,
              safetyViolation: false, latencyMs: 100
            }))
          });
          return {
            baselineRun: makeRun("baseline-1", "baseline-run", 0.6),
            candidateRun: makeRun("candidate-1", "candidate-run", 0.8)
          };
        }
      }
    });
    const commands = router(learning);
    const proposal = await commands.dispatch({ taskId: "task-eval" }, {
      kind: "propose-agent-learning", agentId: "engineer", objective: "Train candidate",
      changeKind: "adapter-training", evidenceRefs: ["approved:training-source"]
    }) as { proposalId: string };
    const candidate = await commands.dispatch({ taskId: "task-eval" }, {
      kind: "train-agent-candidate", proposalId: proposal.proposalId, baselineModelId: "baseline-1",
      datasetRef: "training-data", datasetVersion: "train-v1",
      budget: { maxRuntimeSeconds: 60, maxMemoryMB: 512, maxOutputBytes: 1000000 },
      hyperparameters: { method: "lora" }, approvalRef: "approval"
    }) as { candidateId: string };
    const result = await commands.dispatch({ taskId: "task-eval" }, {
      kind: "evaluate-agent-candidate", candidateId: candidate.candidateId, benchmarkVersion: "bench-v1"
    });
    expect(result).toMatchObject({ status: "eligible-for-human-review" });
  });

  it("does not expose arbitrary execution or automatic promotion commands", () => {
    expect(() => parseDirectorCommand({ kind: "promote-model", candidateId: "candidate-1" }))
      .toThrow(/Unsupported Director command/);
    expect(() => parseDirectorCommand({ kind: "run-shell", command: "..." }))
      .toThrow(/Unsupported Director command/);
  });
});
