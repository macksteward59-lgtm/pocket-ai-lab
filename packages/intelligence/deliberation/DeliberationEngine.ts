/**
 * Deliberation Engine — bounded collaborative reasoning
 * Does not claim consensus unless evidence of agreement exists.
 */

import { AgentMessage } from "../message-bus/MessageBus";

export type DeliberationStage = "independent" | "cross-review" | "challenge" | "revision" | "verification" | "synthesis";

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
  private maxRounds = 2;

  async runCycle(
    taskId: string,
    messages: AgentMessage[],
    onStage: (stage: DeliberationStage, msgs: AgentMessage[]) => Promise<AgentMessage[]>
  ): Promise<DeliberationResult> {
    let current = [...messages];
    let rounds = 0;
    const notes: string[] = [];

    current = await onStage("independent", current);
    current = await onStage("cross-review", current);

    while (rounds < this.maxRounds) {
      const before = current.length;
      current = await onStage("challenge", current);
      current = await onStage("revision", current);
      rounds++;
      notes.push(`Round ${rounds}: ${current.length - before} new messages`);
    }

    current = await onStage("verification", current);
    const synthesisMsgs = await onStage("synthesis", current);

    // Consensus only if we see explicit validation messages that agree, or no unresolved counterarguments
    const counterarguments = current.filter(m => m.messageType === "counterargument");
    const validations = current.filter(m => m.messageType === "validation");
    const verifiedTrue = validations.filter(v => {
      const p = v.payload as any;
      return p && typeof p === "object" && p.verified === true;
    }).length;

    const consensus = counterarguments.length === 0 || (validations.length > 0 && verifiedTrue >= validations.length / 2);
    const completion = synthesisMsgs.find(m => m.messageType === "completion");
    const finalSynthesis = completion
      ? ((completion.payload as any)?.synthesis ?? String(completion.payload))
      : undefined;

    return {
      stage: "synthesis",
      rounds,
      consensus,
      disagreementCount: counterarguments.length,
      finalSynthesis,
      evidenceRefs: current.flatMap(m => m.evidenceRefs),
      notes
    };
  }
}
