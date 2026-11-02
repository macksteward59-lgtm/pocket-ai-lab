/**
 * Bounded deliberation. Consensus requires independent affirmative validation
 * and no unresolved counterarguments; absence of objections is not consensus.
 */
import { AgentMessage } from "../message-bus/MessageBus";

export type DeliberationStage =
  | "independent" | "cross-review" | "challenge" | "revision"
  | "verification" | "synthesis";

export interface DeliberationResult {
  stage: DeliberationStage;
  rounds: number;
  consensus: boolean;
  disagreementCount: number;
  finalSynthesis?: string;
  evidenceRefs: string[];
  notes: string[];
}

export class DeliberationEngine {
  constructor(private readonly maxRounds = 2) {
    if (!Number.isInteger(maxRounds) || maxRounds < 0 || maxRounds > 5) {
      throw new Error("maxRounds must be an integer between 0 and 5");
    }
  }

  async runCycle(
    taskId: string,
    messages: AgentMessage[],
    onStage: (stage: DeliberationStage, msgs: AgentMessage[]) => Promise<AgentMessage[]>
  ): Promise<DeliberationResult> {
    if (!taskId.trim()) throw new Error("taskId is required");
    let current = [...messages];
    const notes: string[] = [];
    let rounds = 0;

    for (const stage of ["independent", "cross-review"] as const) {
      current = await onStage(stage, [...current]);
    }
    while (rounds < this.maxRounds) {
      const before = current.length;
      current = await onStage("challenge", [...current]);
      current = await onStage("revision", [...current]);
      rounds++;
      notes.push("Round " + rounds + ": " + (current.length - before) + " new messages");
    }

    current = await onStage("verification", [...current]);
    const synthesisMessages = await onStage("synthesis", [...current]);
    const taskMessages = [...current, ...synthesisMessages].filter(m => m.taskId === taskId);
    const objections = taskMessages.filter(m => m.messageType === "counterargument");
    const validations = taskMessages.filter(m => m.messageType === "validation");
    const affirmative = validations.filter(m => {
      const payload = m.payload as { verified?: unknown };
      return payload.verified === true;
    });
    const negative = validations.some(m => (m.payload as { verified?: unknown }).verified === false);
    const distinctValidators = new Set(affirmative.map(m => m.senderAgentId));
    const consensus = objections.length === 0 && !negative && distinctValidators.size >= 1;

    const completion = synthesisMessages.find(m => m.messageType === "completion");
    const finalSynthesis = completion
      ? (completion.payload as { synthesis: string }).synthesis
      : undefined;
    if (!completion) notes.push("No completion message was produced; synthesis is unavailable.");
    if (objections.length > 0) notes.push("Unresolved counterarguments remain; consensus withheld.");
    if (distinctValidators.size === 0) notes.push("No affirmative validation was recorded; consensus withheld.");

    return {
      stage: "synthesis",
      rounds,
      consensus,
      disagreementCount: objections.length,
      finalSynthesis,
      evidenceRefs: [...new Set(taskMessages.flatMap(m => m.evidenceRefs))],
      notes
    };
  }
}
