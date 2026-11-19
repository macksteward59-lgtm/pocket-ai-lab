import { randomUUID } from "node:crypto";
import {
  LatentCapabilitySchema,
  LatentTransferEnvelopeSchema,
  negotiateLatentCodec,
  validateLatentTransfer,
  type LatentBlobStore,
  type LatentCapability,
  type LatentCodec,
  type LatentCodecSelection,
  type LatentTransferAuthorization,
  type LatentTransferEnvelope
} from "./LatentChannel";

export interface LatentDigest {
  sha256(bytes: Uint8Array): Promise<string>;
}

export interface LatentReplayGuard {
  /** Atomically claims a sender/conversation sequence key until expiry. */
  claim(key: string, expiresAt: string): Promise<boolean>;
}

export class InMemoryLatentReplayGuard implements LatentReplayGuard {
  private readonly claims = new Map<string, number>();
  constructor(private readonly now: () => number = () => Date.now()) {}

  async claim(key: string, expiresAt: string): Promise<boolean> {
    const now = this.now();
    for (const [existing, expiry] of this.claims) {
      if (expiry <= now) this.claims.delete(existing);
    }
    if (this.claims.has(key)) return false;
    const expiry = Date.parse(expiresAt);
    if (!Number.isFinite(expiry) || expiry <= now) return false;
    this.claims.set(key, expiry);
    return true;
  }
}

/**
 * In-memory binary storage for tests and single-process demonstrations only.
 * Production deployments must supply durable, access-controlled blob storage.
 */
export class InMemoryLatentBlobStore implements LatentBlobStore {
  private readonly blobs = new Map<string, { bytes: Uint8Array; expiresAt: number }>();

  constructor(
    private readonly digest: LatentDigest,
    private readonly now: () => number = () => Date.now()
  ) {}

  async put(bytes: Uint8Array, options: { expiresAt: string }) {
    if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) {
      throw new Error("Latent blob must contain non-empty binary data");
    }
    const expiry = Date.parse(options.expiresAt);
    if (!Number.isFinite(expiry) || expiry <= this.now()) {
      throw new Error("Latent blob expiry must be in the future");
    }
    const copy = new Uint8Array(bytes);
    const blobRef = "memory:" + randomUUID();
    const sha256 = await this.digest.sha256(copy);
    this.blobs.set(blobRef, { bytes: copy, expiresAt: expiry });
    return { blobRef, byteLength: copy.byteLength, sha256 };
  }

  async get(blobRef: string): Promise<Uint8Array | null> {
    const entry = this.blobs.get(blobRef);
    if (!entry) return null;
    if (entry.expiresAt <= this.now()) {
      this.blobs.delete(blobRef);
      return null;
    }
    return new Uint8Array(entry.bytes);
  }
}

/**
 * End-to-end host-side channel coordinator. It never puts latent bytes in
 * MessageBus JSON; only the returned envelope is suitable for control-plane
 * delivery. All security-sensitive dependencies are explicit injections.
 */
export class LatentChannelRuntime {
  constructor(private readonly options: {
    localCapability: LatentCapability;
    codec: LatentCodec;
    blobStore: LatentBlobStore;
    authorization: LatentTransferAuthorization;
    digest: LatentDigest;
    replayGuard: LatentReplayGuard;
    now?: () => Date;
  }) {
    const parsed = LatentCapabilitySchema.parse(options.localCapability);
    if (!parsed.supportsHiddenStateExport && !parsed.supportsLatentDecode) {
      throw new Error("Local runtime advertises neither latent export nor latent decode");
    }
  }

  async send(input: {
    taskId: string;
    conversationId: string;
    recipient: LatentCapability;
    sequence: number;
    hiddenState: Float32Array;
    shape: readonly number[];
    expiresAt: string;
  }): Promise<LatentTransferEnvelope> {
    const now = this.options.now?.() ?? new Date();
    const sender = LatentCapabilitySchema.parse(this.options.localCapability);
    const recipient = LatentCapabilitySchema.parse(input.recipient);
    const selection = negotiateLatentCodec(sender, recipient);
    if (!selection) throw new Error("No compatible latent codec; caller must fall back to text");
    this.assertCodec(selection, sender.model, recipient.model);

    const elements = checkedElementCount(input.shape);
    if (elements !== input.hiddenState.length) {
      throw new Error("Latent tensor shape does not match hidden-state length");
    }
    if (Date.parse(input.expiresAt) <= now.getTime()) {
      throw new Error("Latent transfer expiry must be in the future");
    }

    const bytes = await this.options.codec.encode({
      hiddenState: input.hiddenState,
      shape: input.shape,
      dtype: selection.dtype
    });
    if (bytes.byteLength === 0 || bytes.byteLength > selection.maxPayloadBytes) {
      throw new Error("Encoded latent payload exceeds negotiated codec limits");
    }

    const authorized = await this.options.authorization.authorize({
      taskId: input.taskId,
      conversationId: input.conversationId,
      senderAgentId: sender.agentId,
      recipientAgentId: recipient.agentId,
      codec: selection,
      payloadByteLength: bytes.byteLength
    });
    if (!authorized) throw new Error("Latent transfer denied by host authorization policy");

    const expectedDigest = (await this.options.digest.sha256(bytes)).toLowerCase();
    const payload = await this.options.blobStore.put(bytes, { expiresAt: input.expiresAt });
    if (payload.byteLength !== bytes.byteLength || payload.sha256.toLowerCase() !== expectedDigest) {
      throw new Error("Binary store returned an inconsistent payload receipt");
    }

    return LatentTransferEnvelopeSchema.parse({
      protocolVersion: 1,
      transferId: randomUUID(),
      taskId: input.taskId,
      conversationId: input.conversationId,
      senderAgentId: sender.agentId,
      recipientAgentId: recipient.agentId,
      sequence: input.sequence,
      createdAt: now.toISOString(),
      expiresAt: input.expiresAt,
      codec: selection,
      shape: [...input.shape],
      payload
    });
  }

  async receive(
    envelopeInput: unknown,
    expected: { taskId: string; senderAgentId: string }
  ): Promise<{
    hiddenState: Float32Array;
    shape: number[];
    transferId: string;
    senderAgentId: string;
  }> {
    const local = LatentCapabilitySchema.parse(this.options.localCapability);
    const envelope = validateLatentTransfer(envelopeInput, {
      taskId: expected.taskId,
      senderAgentId: expected.senderAgentId,
      recipientAgentId: local.agentId
    }, this.options.now?.() ?? new Date());

    if (!local.supportsLatentDecode) throw new Error("Local runtime does not support latent decoding");
    if (envelope.codec.codecId !== this.options.codec.codecId ||
        envelope.codec.codecVersion !== this.options.codec.codecVersion) {
      throw new Error("No local decoder matches the negotiated codec");
    }
    this.assertCodec(envelope.codec, envelope.codec.encoderModel, local.model);
    if (!this.options.codec.canEncode(envelope.codec.encoderModel)) {
      throw new Error("Local codec does not recognize the sender model identity");
    }
    if (!sameModel(envelope.codec.decoderModel, local.model)) {
      throw new Error("Latent transfer targets a different model identity or revision");
    }

    const authorized = await this.options.authorization.authorize({
      taskId: envelope.taskId,
      conversationId: envelope.conversationId,
      senderAgentId: envelope.senderAgentId,
      recipientAgentId: envelope.recipientAgentId,
      codec: envelope.codec,
      payloadByteLength: envelope.payload.byteLength
    });
    if (!authorized) throw new Error("Latent receive denied by host authorization policy");

    const bytes = await this.options.blobStore.get(envelope.payload.blobRef);
    if (!bytes) throw new Error("Latent binary payload is missing or expired");
    if (bytes.byteLength !== envelope.payload.byteLength) {
      throw new Error("Latent binary payload length mismatch");
    }
    const actualDigest = (await this.options.digest.sha256(bytes)).toLowerCase();
    if (actualDigest !== envelope.payload.sha256.toLowerCase()) {
      throw new Error("Latent binary payload digest mismatch");
    }

    const replayKey = [envelope.taskId, envelope.conversationId, envelope.senderAgentId, envelope.sequence].join(":");
    if (!await this.options.replayGuard.claim(replayKey, envelope.expiresAt)) {
      throw new Error("Latent transfer replay or duplicate sequence rejected");
    }

    const hiddenState = await this.options.codec.decode({
      bytes,
      shape: envelope.shape,
      dtype: envelope.codec.dtype
    });
    const expectedElements = checkedElementCount(envelope.shape);
    if (hiddenState.length !== expectedElements ||
        Array.from(hiddenState).some(value => !Number.isFinite(value))) {
      throw new Error("Decoded latent tensor failed shape or numeric validation");
    }
    return {
      hiddenState,
      shape: [...envelope.shape],
      transferId: envelope.transferId,
      senderAgentId: envelope.senderAgentId
    };
  }

  private assertCodec(
    selection: LatentCodecSelection,
    encoderModel: { modelId: string; modelRevision: string },
    decoderModel: { modelId: string; modelRevision: string }
  ): void {
    if (selection.codecId !== this.options.codec.codecId ||
        selection.codecVersion !== this.options.codec.codecVersion) {
      throw new Error("Local codec does not match negotiated codec identity");
    }
    const encoderSupported = this.options.codec.canEncode(encoderModel);
    const decoderSupported = this.options.codec.canDecode(decoderModel);
    if (!encoderSupported || !decoderSupported) {
      throw new Error("Codec does not support the negotiated model identity pair");
    }
  }
}

function sameModel(
  left: { modelId: string; modelRevision: string },
  right: { modelId: string; modelRevision: string }
): boolean {
  return left.modelId === right.modelId && left.modelRevision === right.modelRevision;
}

function checkedElementCount(shape: readonly number[]): number {
  if (!Array.isArray(shape) || shape.length < 1 || shape.length > 8) {
    throw new Error("Latent tensor rank is outside supported bounds");
  }
  const elements = shape.reduce((total, dimension) => {
    if (!Number.isSafeInteger(dimension) || dimension <= 0) {
      throw new Error("Latent tensor dimensions must be positive safe integers");
    }
    return total * dimension;
  }, 1);
  if (!Number.isSafeInteger(elements) || elements > 16 * 1024 * 1024) {
    throw new Error("Latent tensor exceeds the element limit");
  }
  return elements;
}
