import { describe, expect, it } from "vitest";
import { LatentChannelRuntime, type LatentChannelHost } from "../latent-communication/LatentChannelRuntime";
import type { LatentCapability, LatentCodec } from "../latent-communication/LatentChannel";

const sender: LatentCapability = {
  protocolVersion: 1, agentId: "reasoner",
  model: { modelId: "shared-model", modelRevision: "sha-model-1" },
  supportsHiddenStateExport: true, supportsLatentDecode: false,
  codecs: [{ codecId: "same-model-int8", codecVersion: "1", dtypes: ["int8"], maxPayloadBytes: 4096 }]
};
const recipient: LatentCapability = {
  protocolVersion: 1, agentId: "critic",
  model: { modelId: "shared-model", modelRevision: "sha-model-1" },
  supportsHiddenStateExport: false, supportsLatentDecode: true,
  codecs: [{ codecId: "same-model-int8", codecVersion: "1", dtypes: ["int8"], maxPayloadBytes: 4096 }]
};

function fixture(options: { allowed?: boolean; digest?: string } = {}) {
  const blobs = new Map<string, Uint8Array>();
  const consumed = new Set<string>();
  let id = 0;
  const host: LatentChannelHost = {
    authorization: { authorize: async () => options.allowed ?? true },
    blobs: {
      put: async (bytes, { expiresAt }) => {
        const blobRef = "blob-" + (++id);
        blobs.set(blobRef, bytes.slice());
        return { blobRef, byteLength: bytes.byteLength, sha256: await host.digest.sha256(bytes) };
      },
      get: async blobRef => blobs.get(blobRef)?.slice() ?? null
    },
    digest: { sha256: async bytes => options.digest ?? Array.from(bytes).map(x => x.toString(16).padStart(2, "0")).join("").padEnd(64, "0").slice(0, 64) },
    replay: {
      claim: async ({ transferId }) => {
        if (consumed.has(transferId)) return false;
        consumed.add(transferId);
        return true;
      }
    },
    now: () => new Date("2026-11-19T12:00:00.000Z"),
    createTransferId: () => "7d2e3a1a-10b2-4b34-8c4e-0d6e7c65b104"
  };
  const codec: LatentCodec = {
    codecId: "same-model-int8", codecVersion: "1",
    canEncode: model => model.modelId === "shared-model" && model.modelRevision === "sha-model-1",
    canDecode: model => model.modelId === "shared-model" && model.modelRevision === "sha-model-1",
    encode: async ({ hiddenState }) => new Uint8Array(hiddenState.map(value => Math.max(-127, Math.min(127, Math.round(value * 10))) + 128)),
    decode: async ({ bytes }) => Float32Array.from(bytes, value => (value - 128) / 10)
  };
  return { runtime: new LatentChannelRuntime(host, [codec]), blobs, host };
}

describe("LatentChannelRuntime", () => {
  it("encodes, authorizes, stores, verifies, and decodes a bounded transfer", async () => {
    const f = fixture();
    const envelope = await f.runtime.send({
      taskId: "task-1", conversationId: "conversation-1",
      sender, recipient, hiddenState: new Float32Array([0.1, -0.2, 0.3, 0.4]),
      shape: [2, 2], dtype: "int8", ttlMs: 60_000
    });
    expect(envelope?.payload.byteLength).toBe(4);
    const decoded = await f.runtime.receive({
      envelope, taskId: "task-1", senderAgentId: "reasoner", recipient
    });
    expect(Array.from(decoded)).toEqual([0.1, -0.2, 0.3, 0.4]);
  });

  it("falls back when no compatible codec or authorization is available", async () => {
    const denied = fixture({ allowed: false });
    await expect(denied.runtime.send({
      taskId: "task-1", conversationId: "conversation-1",
      sender, recipient, hiddenState: new Float32Array([0.1]), shape: [1],
      dtype: "int8", ttlMs: 60_000
    })).resolves.toBeNull();
    const incompatible = fixture();
    await expect(incompatible.runtime.send({
      taskId: "task-1", conversationId: "conversation-1",
      sender, recipient: { ...recipient, model: { modelId: "other", modelRevision: "rev-2" } },
      hiddenState: new Float32Array([0.1]), shape: [1], dtype: "int8", ttlMs: 60_000
    })).resolves.toBeNull();
  });

  it("rejects altered payload bytes before invoking the decoder", async () => {
    const f = fixture();
    const envelope = await f.runtime.send({
      taskId: "task-1", conversationId: "conversation-1",
      sender, recipient, hiddenState: new Float32Array([0.1]), shape: [1],
      dtype: "int8", ttlMs: 60_000
    });
    f.blobs.set(envelope!.payload.blobRef, new Uint8Array([0]));
    await expect(f.runtime.receive({
      envelope, taskId: "task-1", senderAgentId: "reasoner", recipient
    })).rejects.toThrow(/integrity/);
  });

  it("rejects replayed transfers", async () => {
    const f = fixture();
    const envelope = await f.runtime.send({
      taskId: "task-1", conversationId: "conversation-1",
      sender, recipient, hiddenState: new Float32Array([0.1]), shape: [1],
      dtype: "int8", ttlMs: 60_000
    });
    const input = { envelope, taskId: "task-1", senderAgentId: "reasoner", recipient };
    await f.runtime.receive(input);
    await expect(f.runtime.receive(input)).rejects.toThrow(/already been consumed/);
  });

  it("rejects invalid tensor dimensions and TTLs before storage", async () => {
    const f = fixture();
    await expect(f.runtime.send({
      taskId: "task-1", conversationId: "conversation-1",
      sender, recipient, hiddenState: new Float32Array([0.1, 0.2]),
      shape: [1], dtype: "int8", ttlMs: 60_000
    })).resolves.toBeNull();
    await expect(f.runtime.send({
      taskId: "task-1", conversationId: "conversation-1",
      sender, recipient, hiddenState: new Float32Array([0.1]),
      shape: [1], dtype: "int8", ttlMs: 10 * 60_000
    })).resolves.toBeNull();
    expect(f.blobs.size).toBe(0);
  });
});
