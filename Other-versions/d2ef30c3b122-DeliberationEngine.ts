/**
 * Bounded deliberation. Objections are unresolved until a revision explicitly
 * references them; consensus requires affirmative validator confirmation.
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
    const revisions = taskMessages.filter(m => m.messageType === "revision");
    const addressed = new Set(revisions.flatMap(message =>
      (message.payload as { addressesMessageIds: string[] }).addressesMessageIds
    ));
    const unresolved = objections.filter(message => !addressed.has(message.messageId));
    const validations = taskMessages.filter(
      message => message.messageType === "validation" && message.senderAgentId === "validator"
    );
    const affirmative = validations.some(
      message => (message.payload as { verified: boolean }).verified === true
    );
    const negative = validations.some(
      message => (message.payload as { verified: boolean }).verified === false
    );
    const consensus = unresolved.length === 0 && affirmative && !negative;

    const completion = synthesisMessages.find(
      message => message.messageType === "completion" && message.senderAgentId === "director"
    );
    const finalSynthesis = completion
      ? (completion.payload as { synthesis: string }).synthesis
      : undefined;
    if (!completion) notes.push("No valid Director completion message was produced.");
    if (unresolved.length) notes.push(unresolved.length + " counterargument(s) remain unresolved.");
    if (!affirmative) notes.push("The Validator did not affirm the result; consensus withheld.");
    if (negative) notes.push("The Validator recorded a negative finding; consensus withheld.");

    return {
      stage: "synthesis",
      rounds,
      consensus,
      disagreementCount: unresolved.length,
      finalSynthesis,
      evidenceRefs: [...new Set(taskMessages.flatMap(message => message.evidenceRefs))],
      notes
    };
  }
}
