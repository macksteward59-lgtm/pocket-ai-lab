/**
 * Agent Message Protocol Implementation
 * Messages are immutable once published. Payloads are typed per messageType where practical.
 */

import { z } from "zod";

export const MessageTypeSchema = z.enum([
  "task_assignment",
  "analysis",
  "question",
  "evidence",
  "counterargument",
  "revision",
  "validation",
  "completion"
]);

export type MessageType = z.infer<typeof MessageTypeSchema>;

// Discriminated payload schemas (extensible)
const AnalysisPayload = z.object({ analysis: z.string(), confidence: z.number().min(0).max(1).optional() });
const CounterargumentPayload = z.object({ claim: z.string(), objection: z.string(), evidenceRefs: z.array(z.string()).optional() });
const ValidationPayload = z.object({ claim: z.string(), verified: z.boolean(), reason: z.string().optional() });
const CompletionPayload = z.object({ synthesis: z.string(), evidenceRefs: z.array(z.string()) });

export const AgentMessageSchema = z.object({
  messageId: z.string().uuid(),
  taskId: z.string(),
  conversationId: z.string(),
  senderAgentId: z.string(),
  recipientAgentId: z.string().or(z.literal("broadcast")),
  messageType: MessageTypeSchema,
  payload: z.unknown(), // validated further by type-specific helpers
  evidenceRefs: z.array(z.string()).default([]),
  parentMessageId: z.string().uuid().optional(),
  createdAt: z.string().datetime(),
  sequence: z.number().int().nonnegative()
});

export type AgentMessage = z.infer<typeof AgentMessageSchema>;

export class MessageBus {
  private messages: AgentMessage[] = [];
  private listeners = new Map<string, ((msg: AgentMessage) => void)[]>();

  publish(msg: AgentMessage): AgentMessage {
    const validated = AgentMessageSchema.parse(msg);
    // Freeze so published messages cannot be mutated
    const frozen = Object.freeze({ ...validated, payload: Object.freeze(validated.payload) }) as AgentMessage;
    this.messages.push(frozen);

    const recipients = frozen.recipientAgentId === "broadcast"
      ? Array.from(this.listeners.keys())
      : [frozen.recipientAgentId];
    for (const rid of recipients) {
      this.listeners.get(rid)?.forEach(cb => cb(frozen));
    }
    return frozen;
  }

  subscribe(agentId: string, callback: (msg: AgentMessage) => void): void {
    if (!this.listeners.has(agentId)) this.listeners.set(agentId, []);
    this.listeners.get(agentId)!.push(callback);
  }

  getThread(taskId: string): readonly AgentMessage[] {
    return this.messages.filter(m => m.taskId === taskId).sort((a, b) => a.sequence - b.sequence);
  }
}

// Helpers for typed payloads
export const PayloadSchemas = {
  analysis: AnalysisPayload,
  counterargument: CounterargumentPayload,
  validation: ValidationPayload,
  completion: CompletionPayload
} as const;
