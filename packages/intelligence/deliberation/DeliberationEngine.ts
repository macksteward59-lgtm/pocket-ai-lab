/**
 * Deliberation Engine — bounded collaborative reasoning
 */

import { AgentMessage } from "../message-bus/MessageBus";

export type DeliberationStage = "independent" | "cross-review" | "challenge" | "revision" | "verification" | "synthesis";

export interface DeliberationResult {
  stage: DeliberationStage;
  rounds: number;
  consensus: boolean;
  finalSynthesis?: string;
  evidenceRefs: string[];
}

export class DeliberationEngine {
  private maxRounds = 2;

  async runCycle(
    taskId: string,
    messages: AgentMessage[],
    onStage: (stage: DeliberationStage, msgs: AgentMessage[]) => Promise<AgentMessage[]>
  ): Promise<DeliberationResult> {
    let current = messages;
    let rounds = 0;

    current = await onStage("independent", current);
    current = await onStage("cross-review", current);

    while (rounds < this.maxRounds) {
      current = await onStage("challenge", current);
      current = await onStage("revision", current);
      rounds++;
    }

    current = await onStage("verification", current);
    const synthesisMsgs = await onStage("synthesis", current);

    return {
      stage: "synthesis",
      rounds,
      consensus: true, // simplified; real impl checks agreement
      finalSynthesis: synthesisMsgs.find(m => m.messageType === "completion")?.payload as string,
      evidenceRefs: current.flatMap(m => m.evidenceRefs)
    };
  }
}
