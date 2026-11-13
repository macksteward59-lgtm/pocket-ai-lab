/**
 * Cross-runtime protocol shared by TypeScript and native Swift orchestration.
 * Keep wire names and enum values in sync with runtime/ios/Sources/PocketLlamaEngine/AgentProtocol.swift.
 * These contracts describe work and runtime claims; they do not grant permissions.
 */
import { z } from "zod";

export const AgentTaskRequestSchema = z.object({
  protocolVersion: z.literal(1),
  id: z.string().min(1),
  objective: z.string().min(1),
  requiredCapabilities: z.array(z.string().min(1))
}).strict();
export type AgentTaskRequest = z.infer<typeof AgentTaskRequestSchema>;

export const AgentMessageTypeSchema = z.enum([
  "task_assignment", "analysis", "question", "evidence",
  "counterargument", "revision", "validation", "completion",
  "security_boundary_violation"
]);
export type AgentMessageType = z.infer<typeof AgentMessageTypeSchema>;

export const AgentMessageEnvelopeSchema = z.object({
  protocolVersion: z.literal(1),
  messageId: z.string().uuid(),
  taskId: z.string().min(1),
  conversationId: z.string().min(1),
  senderAgentId: z.string().min(1),
  recipientAgentId: z.string().min(1),
  messageType: AgentMessageTypeSchema,
  payload: z.unknown(),
  evidenceRefs: z.array(z.string()),
  parentMessageId: z.string().uuid().optional(),
  createdAt: z.string().datetime(),
  sequence: z.number().int().nonnegative()
}).strict();
export type AgentMessageEnvelope = z.infer<typeof AgentMessageEnvelopeSchema>;

export const RuntimeReadinessStateSchema = z.enum([
  "unavailable", "loading", "ready", "expired"
]);
export type RuntimeReadinessState = z.infer<typeof RuntimeReadinessStateSchema>;

/**
 * A claim emitted by a runtime. It is not trusted until a separately injected
 * verifier authenticates the signature and binds it to the requested model/file.
 */
export const RuntimeSessionProofSchema = z.object({
  protocolVersion: z.literal(1),
  sessionId: z.string().min(1),
  modelId: z.string().min(1),
  modelFileSHA256: z.string().regex(/^[a-f0-9]{64}$/i),
  runtimeBuildId: z.string().min(1),
  expiresAt: z.string().datetime(),
  generationCounter: z.number().int().positive(),
  keyId: z.string().min(1),
  signature: z.string().min(1),
  algorithm: z.literal("Ed25519")
}).strict();
export type RuntimeSessionProof = z.infer<typeof RuntimeSessionProofSchema>;

export interface RuntimeProofVerifier {
  verify(proof: RuntimeSessionProof, expected: {
    modelId: string;
    modelFileSHA256: string;
  }): Promise<boolean>;
}

/** Readiness is fail-closed; a structurally valid but unauthenticated proof is not ready. */
export async function evaluateRuntimeReadiness(
  proof: RuntimeSessionProof | null,
  expected: { modelId: string; modelFileSHA256: string },
  verifier: RuntimeProofVerifier,
  now: Date = new Date()
): Promise<RuntimeReadinessState> {
  if (!proof) return "unavailable";
  const parsed = RuntimeSessionProofSchema.safeParse(proof);
  if (!parsed.success) return "unavailable";
  if (Date.parse(proof.expiresAt) <= now.getTime()) return "expired";
  if (proof.modelId !== expected.modelId ||
      proof.modelFileSHA256.toLowerCase() !== expected.modelFileSHA256.toLowerCase()) {
    return "unavailable";
  }
  try {
    return await verifier.verify(proof, expected) ? "ready" : "unavailable";
  } catch {
    return "unavailable";
  }
}
