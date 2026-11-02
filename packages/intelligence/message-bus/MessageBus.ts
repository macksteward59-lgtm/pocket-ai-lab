/**
 * Agent Message Protocol Implementation
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

export const AgentMessageSchema = z.object({
  messageId: z.string().uuid(),
  taskId: z.string(),
  conversationId: z.string(),
  senderAgentId: z.string(),
  recipientAgentId: z.string().or(z.literal("broadcast")),
  messageType: MessageTypeSchema,
  payload: z.unknown(),
  evidenceRefs: z.array(z.string()).default([]),
  parentMessageId: z.string().uuid().optional(),
  createdAt: z.string().datetime(),
  sequence: z.number().int().nonnegative()
});

export type AgentMessage = z.infer<typeof AgentMessageSchema>;

export class MessageBus {
  private messages: AgentMessage[] = [];
  private listeners = new Map<string, ((msg: AgentMessage) => void)[]>();

  publish(msg: AgentMessage): void {
    const validated = AgentMessageSchema.parse(msg);
    this.messages.push(validated);
    const recipients = validated.recipientAgentId === "broadcast"
      ? Array.from(this.listeners.keys())
      : [validated.recipientAgentId];
    for (const rid of recipients) {
      this.listeners.get(rid)?.forEach(cb => cb(validated));
    }
  }

  subscribe(agentId: string, callback: (msg: AgentMessage) => void): void {
    if (!this.listeners.has(agentId)) this.listeners.set(agentId, []);
    this.listeners.get(agentId)!.push(callback);
  }

  getThread(taskId: string): AgentMessage[] {
    return this.messages.filter(m => m.taskId === taskId).sort((a, b) => a.sequence - b.sequence);
  }
}
