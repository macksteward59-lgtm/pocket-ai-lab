/**
 * East / e3 integration for Pocket AI Lab multi-agent tasks.
 *
 * The task graph calls platform functions. Their implementations live in
 * platform.ts and are supplied at compile time. LLM inference stays behind
 * InferenceProvider. APEX authorization is not implemented here: the task's
 * `authorized` field is whatever `commitTaskEvidence` returns, and that
 * function returns false. A device-evidence candidate that the compliance
 * helper marks `candidate_only` is still not authorization.
 */

import { East } from "@elaraai/east";
import e3 from "@elaraai/e3";
import { StringType, StructType, ArrayType, BooleanType } from "@elaraai/east";
import { EAST_DELIBERATION_AGENTS, type EastPlatformRuntime } from "./platform";

export { createEastPlatform, EastPlatformError, EAST_DELIBERATION_AGENTS } from "./platform";
export type {
  EastAssignment,
  EastEvidenceGate,
  EastEvidenceRejectionReason,
  EastEvidenceSubmission,
  EastModelBinding,
  EastPlatformDependencies,
  EastPlatformErrorCode,
  EastPlatformRuntime,
  EastTaskRecord
} from "./platform";

const createAgentTask = East.platform("createAgentTask", [StringType], StringType);
const assignAgent = East.platform("assignAgent", [StringType, StringType], StringType);
const executeAgent = East.asyncPlatform("executeAgent", [StringType, StringType], StringType);
const runDeliberation = East.asyncPlatform(
  "runDeliberation",
  [StringType],
  StructType({ synthesis: StringType, evidence: ArrayType(StringType) })
);
const commitTaskEvidence = East.asyncPlatform("commitTaskEvidence", [StringType, StringType], BooleanType);

const taskOutput = StructType({
  taskId: StringType,
  synthesis: StringType,
  evidenceRefs: ArrayType(StringType),
  authorized: BooleanType
});

export const pocketAILabTaskFunction = East.asyncFunction(
  [StringType],
  taskOutput,
  ($, objective) => {
    let taskId = createAgentTask(objective);
    for (const agentId of EAST_DELIBERATION_AGENTS) {
      taskId = assignAgent(taskId, agentId);
    }
    const result = runDeliberation(taskId);
    const committed = commitTaskEvidence(taskId, result.synthesis);
    return {
      taskId,
      synthesis: result.synthesis,
      evidenceRefs: result.evidence,
      authorized: committed
    };
  }
);

const pocketAILabTask = e3.task(
  "pocketAILabTask",
  [e3.input("objective", StringType)],
  pocketAILabTaskFunction
);

function bindEastPlatform(runtime: EastPlatformRuntime) {
  return [
    createAgentTask.implement(objective => runtime.createAgentTask(objective)),
    assignAgent.implement((taskId, agentId) => runtime.assignAgent(taskId, agentId)),
    executeAgent.implement((taskId, agentId) => runtime.executeAgent(taskId, agentId)),
    runDeliberation.implement(taskId => runtime.runDeliberation(taskId)),
    commitTaskEvidence.implement(async (taskId, synthesis) => {
      await runtime.commitTaskEvidence(taskId, synthesis);
      return false;
    })
  ];
}

export function compilePocketAILabTask(runtime: EastPlatformRuntime) {
  return East.compileAsync(pocketAILabTaskFunction, bindEastPlatform(runtime));
}

export default e3.package("pocket-ai-lab", "1.0.0", pocketAILabTask);
