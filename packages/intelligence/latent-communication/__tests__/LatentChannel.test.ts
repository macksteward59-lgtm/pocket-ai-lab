import { describe, expect, it } from "vitest";
import {
  LatentCapabilitySchema,
  LatentTransferEnvelopeSchema,
  negotiateLatentCodec,
  validateLatentTransfer
} from "../LatentChannel";

const sender = {
  protocolVersion: 1 as const,
  agentId: "researcher",
  model: { modelId: "model-a", modelRevision: "rev-1" },
  supportsHiddenStateExport: true,
  codecs: [{ codecId: "codec-a", codecVersion: "1", dtypes: ["float16" as const, "int8" as const], maxPayloadBytes: 4096 }]
};
const recipient = {
  protocolVersion: 1 as const,
  agentId: "critic",
  model: { modelId: "model-b", modelRevision: "rev-2" },
  supportsHiddenStateExport: true,
  codecs: [{ codecId: "codec-a", codecVersion: "1", dtypes: ["int8" as const], maxPayloadBytes: 2048 }]
};

function transfer(overrides: Record<string, unknown> = {}) {
  return {
    protocolVersion: 1,
    transferId: "7d2e3a1a-10b2-4b34-8c4e-0d6e7c65b104",
    taskId: "task-1",
    conversationId: "conversation-1",
    senderAgentId: "researcher",
    recipientAgentId: "critic",
    sequence: 0,
    createdAt: "2026-11-18T12:00:00.000Z",
    expiresAt: "2026-11-18T12:05:00.000Z",
    codec: {
      codecId: "codec-a",
      codecVersion: "1",
      encoderModel: sender.model,
      decoderModel: recipient.model,
      dtype: "int8"
    },
    shape: [16, 32],
    payload: { blobRef: "blob-1", byteLength: 512, sha256: "a".repeat(64) },
    ...overrides
  };
}

describe("latent communication contract", () => {
  it("validates capability metadata", () => {
    expect(LatentCapabilitySchema.safeParse(sender).success).toBe(true);
    expect(LatentCapabilitySchema.safeParse({ ...sender, codecs: [{ ...sender.codecs[0], maxPayloadBytes: 0 }] }).success).toBe(false);
  });

  it("negotiates only exact shared codec versions and dtypes", () => {
    expect(negotiateLatentCodec(sender, recipient)).toMatchObject({
      codecId: "codec-a", codecVersion: "1", dtype: "int8",
      encoderModel: sender.model, decoderModel: recipient.model
    });
    expect(negotiateLatentCodec(sender, { ...recipient, supportsHiddenStateExport: false })).toBeNull();
    expect(negotiateLatentCodec(sender, { ...recipient, codecs: [{ ...recipient.codecs[0], codecVersion: "2" }] })).toBeNull();
  });

  it("rejects unbounded tensors and oversized payload references", () => {
    expect(LatentTransferEnvelopeSchema.safeParse(transfer({ shape: [Number.MAX_SAFE_INTEGER, 4] })).success).toBe(false);
    expect(LatentTransferEnvelopeSchema.safeParse(transfer({
      payload: { blobRef: "blob", byteLength: 16 * 1024 * 1024 + 1, sha256: "a".repeat(64) }
    })).success).toBe(false);
  });

  it("binds transfer identity to the authorized task route and checks expiry", () => {
    const value = transfer();
    expect(validateLatentTransfer(value, {
      taskId: "task-1", senderAgentId: "researcher", recipientAgentId: "critic"
    }, new Date("2026-11-18T12:01:00.000Z")).transferId).toBe(value.transferId);
    expect(() => validateLatentTransfer(value, {
      taskId: "task-2", senderAgentId: "researcher", recipientAgentId: "critic"
    })).toThrow(/identity/);
    expect(() => validateLatentTransfer(value, {
      taskId: "task-1", senderAgentId: "researcher", recipientAgentId: "critic"
    }, new Date("2026-11-18T12:06:00.000Z"))).toThrow(/expired/);
  });
});
