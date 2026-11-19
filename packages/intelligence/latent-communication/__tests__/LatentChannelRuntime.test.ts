import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  InMemoryLatentBlobStore,
  InMemoryLatentReplayGuard,
  LatentChannelRuntime,
  type LatentDigest
} from "../LatentChannelRuntime";
import { AffineInt8LatentCodec } from "../AffineInt8LatentCodec";

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
    codec, blobStore: store, authorization, digest, replay, now
  });
  const recipient = new LatentChannelRuntime({
    localCapability: capability("critic", "recipient"),
    codec, blobStore: store, authorization, digest, replay, now
  });
  return { sender, recipient, store, now };
}

describe("latent channel runtime proof of concept", () => {
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
    const result = await recipient.receive(envelope, { taskId: "task-1", senderAgentId: "researcher" });
    await expect(recipient.receive(envelope, { taskId: "other-task", senderAgentId: "researcher" })).rejects.toThrow(/identity/);
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
      taskId: "task-1", senderAgentId: "researcher"
    })).rejects.toThrow(/sender model identity/);
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
    await recipient.receive(envelope, { taskId: "task-1", senderAgentId: "researcher" });
    await expect(recipient.receive(envelope, { taskId: "task-1", senderAgentId: "researcher" })).rejects.toThrow(/replay|duplicate/);
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
    await expect(recipient.receive(envelope, { taskId: "task-1", senderAgentId: "researcher" })).rejects.toThrow(/digest mismatch/);
  });
});
