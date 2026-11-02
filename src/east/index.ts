/**
 * East / e3 integration for Pocket AI Lab multi-agent tasks.
 *
 * These tasks are the durable backbone. LLM inference is treated as external.
 * APEX authorization remains the gate for any consequential action.
 */
import { East } from "@elaraai/east";
import e3 from "@elaraai/e3";
import { StringType, StructType, ArrayType, BooleanType } from "@elaraai/east";

// Platform functions (to be implemented in runtimes).
const createAgentTask = East.platform("createAgentTask", [StringType], StringType);
const assignAgent = East.platform("assignAgent", [StringType, StringType], StringType);
const executeAgent = East.platform("executeAgent", [StringType, StringType], StringType);
const runDeliberation = East.platform(
  "runDeliberation",
  [StringType],
  StructType({ synthesis: StringType, evidence: ArrayType(StringType) })
);
const commitTaskEvidence = East.platform(
  "commitTaskEvidence",
  [StringType, StringType],
  BooleanType
);

const objective = e3.input("objective", StringType);
const pocketAILabTask = e3.task(
  "pocketAILabTask",
  [objective],
  East.function(
    [StringType],
    StructType({
      taskId: StringType,
      synthesis: StringType,
      evidenceRefs: ArrayType(StringType),
      evidenceCommitted: BooleanType
    }),
    ($, taskObjective) => {
      const taskId = createAgentTask(taskObjective);
      // Agent assignment/execution adapters remain explicit platform work.
      // They are not authorization receipts and are not inferred from model output.
      const result = runDeliberation(taskId);
      const evidenceCommitted = commitTaskEvidence(taskId, result.synthesis);
      return {
        taskId,
        synthesis: result.synthesis,
        evidenceRefs: result.evidence,
        evidenceCommitted
      };
    }
  )
);

export default e3.package("pocket-ai-lab", "1.0.0", pocketAILabTask);
