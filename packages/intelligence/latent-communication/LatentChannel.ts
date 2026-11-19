/**
 * Versioned binary side-channel contract for agent latent representations.
 *
 * This module defines metadata and host interfaces only. It does not encode,
 * decode, persist, or transmit model hidden states. Implementations must supply
 * a model-specific codec, binary store, and independent authorization policy.
 */
import { z } from "zod";

export const LATENT_CHANNEL_PROTOCOL_VERSION = 1 as const;
export const MAX_LATENT_PAYLOAD_BYTES = 16 * 1024 * 1024;
export const MAX_LATENT_RANK = 8;
export const MAX_LATENT_ELEMENTS = 16 * 1024 * 1024;

export const LatentDTypeSchema = z.enum(["float16", "float32", "int8"]);
export type LatentDType = z.infer<typeof LatentDTypeSchema>;

const ModelIdentitySchema = z.object({
  modelId: z.string().min(1).max(256),
  modelRevision: z.string().min(1).max(256)
}).strict();

export const LatentCapabilitySchema = z.object({
  protocolVersion: z.literal(LATENT_CHANNEL_PROTOCOL_VERSION),
  agentId: z.string().min(1).max(128),
  model: ModelIdentitySchema,
  supportsHiddenStateExport: z.boolean(),
  codecs: z.array(z.object({
    codecId: z.string().min(1).max(128),
    codecVersion: z.string().min(1).max(64),
    dtypes: z.array(LatentDTypeSchema).min(1).max(3),
    maxPayloadBytes: z.number().int().positive().max(MAX_LATENT_PAYLOAD_BYTES)
  }).strict()).max(32)
}).strict();
export type LatentCapability = z.infer<typeof LatentCapabilitySchema>;

export const LatentCodecSelectionSchema = z.object({
  codecId: z.string().min(1).max(128),
  codecVersion: z.string().min(1).max(64),
  encoderModel: ModelIdentitySchema,
  decoderModel: ModelIdentitySchema,
  dtype: LatentDTypeSchema,
  maxPayloadBytes: z.number().int().positive().max(MAX_LATENT_PAYLOAD_BYTES)
}).strict();
export type LatentCodecSelection = z.infer<typeof LatentCodecSelectionSchema>;

export const LatentPayloadReferenceSchema = z.object({
  blobRef: z.string().min(1).max(1024),
  byteLength: z.number().int().positive().max(MAX_LATENT_PAYLOAD_BYTES),
  sha256: z.string().regex(/^[a-f0-9]{64}$/i)
}).strict();
export type LatentPayloadReference = z.infer<typeof LatentPayloadReferenceSchema>;

export const LatentTransferEnvelopeSchema = z.object({
  protocolVersion: z.literal(LATENT_CHANNEL_PROTOCOL_VERSION),
  transferId: z.string().uuid(),
  taskId: z.string().min(1).max(256),
  conversationId: z.string().min(1).max(256),
  senderAgentId: z.string().min(1).max(128),
  recipientAgentId: z.string().min(1).max(128),
  sequence: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  codec: LatentCodecSelectionSchema,
  shape: z.array(z.number().int().positive().max(MAX_LATENT_ELEMENTS)).min(1).max(MAX_LATENT_RANK),
  payload: LatentPayloadReferenceSchema
}).strict().superRefine((transfer, ctx) => {
  const elements = transfer.shape.reduce((total, dimension) => total * dimension, 1);
  if (!Number.isSafeInteger(elements) || elements > MAX_LATENT_ELEMENTS) {
    ctx.addIssue({ code: "custom", path: ["shape"], message: "Latent tensor exceeds the element limit" });
  }
  if (transfer.payload.byteLength > transfer.codec.maxPayloadBytes) {
    ctx.addIssue({ code: "custom", path: ["payload", "byteLength"], message: "Payload exceeds the negotiated codec limit" });
  }
  if (Date.parse(transfer.expiresAt) <= Date.parse(transfer.createdAt)) {
    ctx.addIssue({ code: "custom", path: ["expiresAt"], message: "Transfer expiry must be after creation" });
  }
});
export type LatentTransferEnvelope = z.infer<typeof LatentTransferEnvelopeSchema>;

export interface LatentTransferAuthorization {
  authorize(input: {
    taskId: string;
    conversationId: string;
    senderAgentId: string;
    recipientAgentId: string;
    codec: LatentCodecSelection;
    payloadByteLength: number;
  }): Promise<boolean>;
}

export interface LatentBlobStore {
  put(bytes: Uint8Array, options: { expiresAt: string }): Promise<LatentPayloadReference>;
  get(blobRef: string): Promise<Uint8Array | null>;
}

/** Model/runtime-specific implementation; never assume hidden-state portability. */
export interface LatentCodec {
  readonly codecId: string;
  readonly codecVersion: string;
  canEncode(model: { modelId: string; modelRevision: string }): boolean;
  canDecode(model: { modelId: string; modelRevision: string }): boolean;
  encode(input: {
    hiddenState: Float32Array;
    shape: readonly number[];
    dtype: LatentDType;
  }): Promise<Uint8Array>;
  decode(input: {
    bytes: Uint8Array;
    shape: readonly number[];
    dtype: LatentDType;
  }): Promise<Float32Array>;
}

/**
 * Negotiation is deliberately exact-match. If either runtime cannot export
 * hidden states or no codec is mutually supported, callers must use text.
 */
export function negotiateLatentCodec(
  sender: LatentCapability,
  recipient: LatentCapability
): LatentCodecSelection | null {
  const source = LatentCapabilitySchema.safeParse(sender);
  const target = LatentCapabilitySchema.safeParse(recipient);
  if (!source.success || !target.success ||
      !sender.supportsHiddenStateExport || !recipient.supportsHiddenStateExport) return null;

  for (const encoder of sender.codecs) {
    const decoder = recipient.codecs.find(candidate =>
      candidate.codecId === encoder.codecId &&
      candidate.codecVersion === encoder.codecVersion
    );
    if (!decoder) continue;
    const dtype = encoder.dtypes.find(value => decoder.dtypes.includes(value));
    if (!dtype) continue;
    return LatentCodecSelectionSchema.parse({
      codecId: encoder.codecId,
      codecVersion: encoder.codecVersion,
      encoderModel: sender.model,
      decoderModel: recipient.model,
      dtype,
      maxPayloadBytes: Math.min(encoder.maxPayloadBytes, decoder.maxPayloadBytes)
    });
  }
  return null;
}

/** Validate bounded metadata before any blob lookup or decoder invocation. */
export function validateLatentTransfer(
  input: unknown,
  expected: { taskId: string; senderAgentId: string; recipientAgentId: string },
  now: Date = new Date()
): LatentTransferEnvelope {
  const transfer = LatentTransferEnvelopeSchema.parse(input);
  if (transfer.taskId !== expected.taskId ||
      transfer.senderAgentId !== expected.senderAgentId ||
      transfer.recipientAgentId !== expected.recipientAgentId) {
    throw new Error("Latent transfer identity does not match the authorized route");
  }
  if (Date.parse(transfer.expiresAt) <= now.getTime()) {
    throw new Error("Latent transfer has expired");
  }
  return transfer;
}
