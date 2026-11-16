/**
 * Agent Message Protocol.
 * Payloads are validated by message type and deeply frozen before publication.
 */
import { z } from "zod";

export const MessageTypeSchema = z.enum([
  "task_assignment", "analysis", "question", "evidence",
  "counterargument", "revision", "validation", "completion",
  "security_boundary_violation"
]);
export type MessageType = z.infer<typeof MessageTypeSchema>;

const PayloadSchemas = {
  task_assignment: z.object({ objective: z.string().min(1) }).strict(),
  analysis: z.object({ analysis: z.string().min(1), confidence: z.number().min(0).max(1).optional() }).strict(),
  question: z.object({ question: z.string().min(1) }).strict(),
  evidence: z.object({ claim: z.string().min(1), sourceRef: z.string().min(1) }).strict(),
  counterargument: z.object({ claim: z.string().min(1), objection: z.string().min(1), evidenceRefs: z.array(z.string()).default([]) }).strict(),
  revision: z.object({ revision: z.string().min(1), addressesMessageIds: z.array(z.string().uuid()) }).strict(),
  validation: z.object({ claim: z.string().min(1), verified: z.boolean(), reason: z.string().optional() }).strict(),
  completion: z.object({ synthesis: z.string().min(1), evidenceRefs: z.array(z.string()) }).strict(),
  security_boundary_violation: z.object({
    event: z.literal("SecurityBoundaryViolation"),
    reason: z.string().min(1),
    findingId: z.string().min(1),
    targetUri: z.string().min(1)
  }).strict()
} as const;

const BaseMessageSchema = z.object({
  protocolVersion: z.literal(1),
  messageId: z.string().uuid(),
  taskId: z.string().min(1),
  conversationId: z.string().min(1),
  senderAgentId: z.string().min(1),
  recipientAgentId: z.string().min(1),
  messageType: MessageTypeSchema,
  payload: z.unknown(),
  evidenceRefs: z.array(z.string()).default([]),
  parentMessageId: z.string().uuid().optional(),
  createdAt: z.string().datetime(),
  sequence: z.number().int().nonnegative()
});

export const AgentMessageSchema = BaseMessageSchema.superRefine((message, ctx) => {
  const parsed = PayloadSchemas[message.messageType].safeParse(message.payload);
  if (!parsed.success) {
    ctx.addIssue({
      code: "custom",
      path: ["payload"],
      message: "Invalid " + message.messageType + " payload: " + parsed.error.issues.map(i => i.message).join("; ")
    });
  }
});
export type AgentMessage = z.infer<typeof AgentMessageSchema>;

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

export class MessageBus {
  private messages: AgentMessage[] = [];
  private listeners = new Map<string, ((msg: AgentMessage) => void)[]>();

  publish(message: AgentMessage): AgentMessage {
    const validated = AgentMessageSchema.parse(message);
    const frozen = deepFreeze(validated);
    this.messages.push(frozen);
    const recipients = frozen.recipientAgentId === "broadcast"
      ? Array.from(this.listeners.keys())
      : [frozen.recipientAgentId];
    for (const recipient of recipients) {
      for (const listener of this.listeners.get(recipient) ?? []) listener(frozen);
    }
    return frozen;
  }

  /**
   * Restores a previously persisted task thread without notifying listeners.
   * Every message is revalidated and sequence/message identifiers must be unique.
   */
  restoreThread(taskId: string, messages: readonly AgentMessage[]): void {
    if (typeof taskId !== "string" || !taskId.trim()) throw new Error("taskId is required");
    if (this.messages.some(message => message.taskId === taskId)) {
      throw new Error("Cannot restore a thread over existing task messages");
    }
    const restored = messages.map(message => deepFreeze(AgentMessageSchema.parse(message)));
    if (restored.some(message => message.taskId !== taskId)) {
      throw new Error("Restored thread contains a message for another task");
    }
    const messageById = new Map<string, AgentMessage>();
    const sequences = new Set<number>();
    for (const message of restored) {
      if (messageById.has(message.messageId) || sequences.has(message.sequence) ||
          this.messages.some(existing => existing.messageId === message.messageId)) {
        throw new Error("Restored thread contains duplicate message identifiers or sequence numbers");
      }
      messageById.set(message.messageId, message);
      sequences.add(message.sequence);
    }
    restored.sort((left, right) => left.sequence - right.sequence);
    for (let index = 0; index < restored.length; index += 1) {
      const message = restored[index];
      if (message.sequence !== index) {
        throw new Error("Restored thread sequence must be contiguous from zero");
      }
      if (message.parentMessageId) {
        const parent = messageById.get(message.parentMessageId);
        if (!parent || parent.sequence >= message.sequence) {
          throw new Error("Restored thread contains a missing or forward parent message");
        }
      }
    }
    this.messages.push(...restored);
  }

  subscribe(agentId: string, callback: (msg: AgentMessage) => void): () => void {
    const listeners = this.listeners.get(agentId) ?? [];
    listeners.push(callback);
    this.listeners.set(agentId, listeners);
    return () => {
      const current = this.listeners.get(agentId) ?? [];
      this.listeners.set(agentId, current.filter(listener => listener !== callback));
    };
  }

  getThread(taskId: string): readonly AgentMessage[] {
    return Object.freeze(
      this.messages.filter(message => message.taskId === taskId).sort((a, b) => a.sequence - b.sequence)
    );
  }
}

export { PayloadSchemas };
