import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  InMemoryLatentBlobStore,
  InMemoryLatentReplayGuard,
  LatentChannelRuntime,
  type LatentDigest
} from "../latent-communication/LatentChannelRuntime";
import { AffineInt8LatentCodec } from "../latent-communication/AffineInt8LatentCodec";

const digest: LatentDigest = {
  async sha256(bytes) {
    return createHash("sha256").update(bytes).digest("hex");
  }
};
const model = { modelId: "shared-model", modelRevision: "sha256:revision-1" };
const codec = new AffineInt8LatentCodec(model);

function capability(agentId: string, role: "sender" | "recipient") {
  return {
    protocolVersion: 1 as const,
    agentId,
    model,
    supportsHiddenStateExport: role === "sender",
    supportsLatentDecode: role === "recipient",
    codecs: [{
      codecId: codec.codecId,
      codecVersion: codec.codecVersion,
      dtypes: ["int8" as const],
      maxPayloadBytes: 64 * 1024
    }]
  };
}

function setup(authorization = { async authorize() { return true; } }) {
  const now = () => new Date("2026-11-19T04:00:00.000Z");
  const store = new InMemoryLatentBlobStore(digest, () => now().getTime());
  const replay = new InMemoryLatentReplayGuard(() => now().getTime());
  const sender = new LatentChannelRuntime({
    localCapability: capability("researcher", "sender"),
    codec, blobStore: store, authorization, digest, replayGuard: replay, now
  });
  const recipient = new LatentChannelRuntime({
    localCapability: capability("critic", "recipient"),
    codec, blobStore: store, authorization, digest, replayGuard: replay, now
  });
  return { sender, recipient, store, now };
}

describe("latent channel runtime proof of concept", () => {
  it("matches the v1 cross-runtime affine-int8 byte fixture", async () => {
    const bytes = await codec.encode({
      hiddenState: Float32Array.from([-1, 0, 1]),
      shape: [3],
      dtype: "int8"
    });
    expect(Array.from(bytes)).toEqual([0, 0, 128, 191, 0, 0, 128, 63, 129, 0, 127]);
  });

  it("transfers a quantized tensor out of band and reconstructs within bounded error", async () => {
    const { sender, recipient } = setup();
    const vector = Float32Array.from({ length: 1024 }, (_, i) => Math.sin(i / 19) * 2.5);
    const envelope = await sender.send({
      taskId: "task-1",
      conversationId: "conversation-1",
      recipient: capability("critic", "recipient"),
      sequence: 0,
      hiddenState: vector,
      shape: [1024],
      expiresAt: "2026-11-19T04:05:00.000Z"
    });
    const result = await recipient.receive(envelope, { taskId: "task-1", conversationId: "conversation-1", senderAgentId: "researcher" });
    await expect(recipient.receive(envelope, { taskId: "other-task", conversationId: "conversation-1", senderAgentId: "researcher" })).rejects.toThrow(/identity/);
    await expect(recipient.receive(envelope, { taskId: "task-1", conversationId: "different-conversation", senderAgentId: "researcher" })).rejects.toThrow(/identity/);
    let squaredError = 0;
    for (let i = 0; i < vector.length; i += 1) {
      squaredError += (vector[i] - result.hiddenState[i]) ** 2;
    }
    const rmse = Math.sqrt(squaredError / vector.length);
    expect(result.hiddenState).toHaveLength(vector.length);
    expect(rmse).toBeLessThan(0.02);
    expect(envelope.payload.byteLength).toBe(8 + vector.length);
    expect(envelope.payload.byteLength).toBeLessThan(vector.byteLength * 0.3);
  });

  it("handles constant vectors and extreme finite Float32 ranges without overflow", async () => {
    const edgeCodec = new AffineInt8LatentCodec(model);
    const constant = Float32Array.from([7.25, 7.25, 7.25]);
    const constantBytes = await edgeCodec.encode({ hiddenState: constant, shape: [3], dtype: "int8" });
    const constantDecoded = await edgeCodec.decode({ bytes: constantBytes, shape: [3], dtype: "int8" });
    expect(Array.from(constantDecoded)).toEqual([7.25, 7.25, 7.25]);

    const extreme = Float32Array.from([-3e38, -1e38, 0, 1e38, 3e38]);
    const extremeBytes = await edgeCodec.encode({ hiddenState: extreme, shape: [5], dtype: "int8" });
    const extremeDecoded = await edgeCodec.decode({ bytes: extremeBytes, shape: [5], dtype: "int8" });
    expect(Array.from(extremeDecoded).every(Number.isFinite)).toBe(true);
    expect(extremeDecoded[0]).toBe(extreme[0]);
    expect(extremeDecoded[4]).toBe(extreme[4]);
  });

  it("rejects malformed shapes and invalid sequence values before storing payloads", async () => {
    const { sender, store } = setup();
    await expect(sender.send({
      taskId: "task-1", conversationId: "conversation-1",
      recipient: capability("critic", "recipient"), sequence: -1,
      hiddenState: new Float32Array([1]), shape: [1],
      expiresAt: "2026-11-19T04:05:00.000Z"
    })).rejects.toThrow(/sequence/);
    await expect(codec.encode({
      hiddenState: new Float32Array([1]), shape: [1, 0], dtype: "int8"
    })).rejects.toThrow(/dimensions/);
    expect(await store.get("not-created")).toBeNull();
  });

  it("rejects heterogeneous model revisions instead of guessing latent compatibility", async () => {
    const { sender } = setup();
    await expect(sender.send({
      taskId: "task-1",
      conversationId: "conversation-1",
      recipient: { ...capability("critic", "recipient"), model: { ...model, modelRevision: "revision-2" } },
      sequence: 0,
      hiddenState: new Float32Array([0.1, 0.2]),
      shape: [2],
      expiresAt: "2026-11-19T04:05:00.000Z"
    })).rejects.toThrow(/compatible latent codec|model identity/);
  });

  it("rejects forged cross-model envelopes before authorization or blob lookup", async () => {
    let authorizations = 0;
    const { sender, recipient, store } = setup({
      async authorize() { authorizations += 1; return true; }
    });
    const envelope = await sender.send({
      taskId: "task-1",
      conversationId: "conversation-1",
      recipient: capability("critic", "recipient"),
      sequence: 11,
      hiddenState: new Float32Array([0.1, 0.2]),
      shape: [2],
      expiresAt: "2026-11-19T04:05:00.000Z"
    });
    expect(authorizations).toBe(1);
    let blobLookups = 0;
    const originalGet = store.get.bind(store);
    store.get = async ref => { blobLookups += 1; return originalGet(ref); };

    const forged = {
      ...envelope,
      codec: {
        ...envelope.codec,
        decoderModel: { modelId: "unrelated-model", modelRevision: model.modelRevision }
      }
    };
    await expect(recipient.receive(forged, {
      taskId: "task-1", conversationId: "conversation-1", senderAgentId: "researcher"
    })).rejects.toThrow(/identical model ID and revision/);
    expect(authorizations).toBe(1);
    expect(blobLookups).toBe(0);
  });

  it("rejects envelopes claiming a different encoder model revision", async () => {
    const { sender, recipient } = setup();
    const envelope = await sender.send({
      taskId: "task-1",
      conversationId: "conversation-1",
      recipient: capability("critic", "recipient"),
      sequence: 1,
      hiddenState: new Float32Array([0.1, 0.2]),
      shape: [2],
      expiresAt: "2026-11-19T04:05:00.000Z"
    });
    const tampered = {
      ...envelope,
      codec: {
        ...envelope.codec,
        encoderModel: { ...model, modelRevision: "unrecognized-revision" }
      }
    };
    await expect(recipient.receive(tampered, {
      taskId: "task-1", conversationId: "conversation-1", senderAgentId: "researcher"
    })).rejects.toThrow(/identical model ID and revision/);
  });

  it("fails closed when host authorization denies transfer", async () => {
    const { sender } = setup({ async authorize() { return false; } });
    await expect(sender.send({
      taskId: "task-1",
      conversationId: "conversation-1",
      recipient: capability("critic", "recipient"),
      sequence: 0,
      hiddenState: new Float32Array([0.1, 0.2]),
      shape: [2],
      expiresAt: "2026-11-19T04:05:00.000Z"
    })).rejects.toThrow(/authorization/);
  });

  it("rejects replayed sender sequence numbers", async () => {
    const { sender, recipient } = setup();
    const envelope = await sender.send({
      taskId: "task-1",
      conversationId: "conversation-1",
      recipient: capability("critic", "recipient"),
      sequence: 7,
      hiddenState: new Float32Array([0.1, 0.2, 0.3]),
      shape: [3],
      expiresAt: "2026-11-19T04:05:00.000Z"
    });
    await recipient.receive(envelope, { taskId: "task-1", conversationId: "conversation-1", senderAgentId: "researcher" });
    await expect(recipient.receive(envelope, { taskId: "task-1", conversationId: "conversation-1", senderAgentId: "researcher" })).rejects.toThrow(/replay|duplicate/);
  });

  it("rejects tampered binary payloads before decode", async () => {
    const { sender, recipient, store } = setup();
    const envelope = await sender.send({
      taskId: "task-1",
      conversationId: "conversation-1",
      recipient: capability("critic", "recipient"),
      sequence: 8,
      hiddenState: new Float32Array([0.1, 0.2, 0.3]),
      shape: [3],
      expiresAt: "2026-11-19T04:05:00.000Z"
    });
    const originalGet = store.get.bind(store);
    store.get = async ref => {
      const bytes = await originalGet(ref);
      if (bytes) bytes[8] = bytes[8] ^ 1;
      return bytes;
    };
    await expect(recipient.receive(envelope, { taskId: "task-1", conversationId: "conversation-1", senderAgentId: "researcher" })).rejects.toThrow(/digest mismatch/);
  });
});
