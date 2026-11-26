import { describe, expect, it } from "vitest";
import {
  LatentCapabilitySchema,
  LatentCodecSelectionSchema,
  LatentTransferEnvelopeSchema,
  negotiateLatentCodec,
  validateLatentTransfer
} from "../latent-communication/LatentChannel";

const sender = {
  protocolVersion: 1 as const,
  agentId: "researcher",
  model: { modelId: "model-a", modelRevision: "rev-1" },
  supportsHiddenStateExport: true,
  supportsLatentDecode: false,
  codecs: [{ codecId: "codec-a", codecVersion: "1", dtypes: ["float16" as const, "int8" as const], maxPayloadBytes: 4096 }]
};
const recipient = {
  protocolVersion: 1 as const,
  agentId: "critic",
  model: sender.model,
  supportsHiddenStateExport: false,
  supportsLatentDecode: true,
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
      dtype: "int8",
      maxPayloadBytes: 2048
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
      encoderModel: sender.model, decoderModel: recipient.model, maxPayloadBytes: 2048
    });
    expect(negotiateLatentCodec({ ...sender, supportsHiddenStateExport: false }, recipient)).toBeNull();
    expect(negotiateLatentCodec(sender, { ...recipient, supportsLatentDecode: false })).toBeNull();
    expect(negotiateLatentCodec(sender, { ...recipient, codecs: [{ ...recipient.codecs[0], codecVersion: "2" }] })).toBeNull();
  });

  it("never negotiates heterogeneous model identities or revisions in latent v1", () => {
    expect(negotiateLatentCodec(sender, {
      ...recipient, model: { modelId: "model-b", modelRevision: sender.model.modelRevision }
    })).toBeNull();
    expect(negotiateLatentCodec(sender, {
      ...recipient, model: { modelId: sender.model.modelId, modelRevision: "rev-2" }
    })).toBeNull();
    expect(negotiateLatentCodec(sender, {
      ...recipient, model: { modelId: "model-b", modelRevision: "rev-2" }
    })).toBeNull();

    const valid = transfer();
    const foreignCodec = {
      ...valid.codec,
      decoderModel: { modelId: "model-b", modelRevision: "rev-2" }
    };
    // A forged envelope cannot bypass the negotiation fallback by supplying
    // otherwise matching codec/version/dtype and digest metadata directly.
    expect(LatentCodecSelectionSchema.safeParse(foreignCodec).success).toBe(false);
    expect(LatentTransferEnvelopeSchema.safeParse(transfer({ codec: foreignCodec })).success).toBe(false);
    expect(LatentTransferEnvelopeSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects unbounded tensors and oversized payload references", () => {
    expect(LatentTransferEnvelopeSchema.safeParse(transfer({ shape: [Number.MAX_SAFE_INTEGER, 4] })).success).toBe(false);
    expect(LatentTransferEnvelopeSchema.safeParse(transfer({
      payload: { blobRef: "blob", byteLength: 16 * 1024 * 1024 + 1, sha256: "a".repeat(64) }
    })).success).toBe(false);
    expect(LatentTransferEnvelopeSchema.safeParse(transfer({
      payload: { blobRef: "blob", byteLength: 2049, sha256: "a".repeat(64) }
    })).success).toBe(false);
  });

  it("rejects unsafe sequence numbers and future-dated transfers", () => {
    expect(LatentTransferEnvelopeSchema.safeParse(transfer({
      sequence: Number.MAX_SAFE_INTEGER + 1
    })).success).toBe(false);
    expect(() => validateLatentTransfer(transfer(), {
      taskId: "task-1",
      conversationId: "conversation-1",
      senderAgentId: "researcher",
      recipientAgentId: "critic"
    }, new Date("2026-11-18T11:59:59.999Z"))).toThrow(/future/);
  });

  it("binds transfer identity to the authorized task route and checks expiry", () => {
    const value = transfer();
    expect(validateLatentTransfer(value, {
      taskId: "task-1", conversationId: "conversation-1", senderAgentId: "researcher", recipientAgentId: "critic"
    }, new Date("2026-11-18T12:01:00.000Z")).transferId).toBe(value.transferId);
    expect(() => validateLatentTransfer(value, {
      taskId: "task-2", conversationId: "conversation-1", senderAgentId: "researcher", recipientAgentId: "critic"
    })).toThrow(/identity/);
    expect(() => validateLatentTransfer(value, {
      taskId: "task-1", conversationId: "conversation-1", senderAgentId: "researcher", recipientAgentId: "critic"
    }, new Date("2026-11-18T12:06:00.000Z"))).toThrow(/expired/);
  });
});
