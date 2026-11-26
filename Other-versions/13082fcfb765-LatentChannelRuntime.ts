import {
  LatentTransferEnvelopeSchema,
  negotiateLatentCodec,
  validateLatentTransfer,
  type LatentCapability,
  type LatentCodec,
  type LatentCodecSelection,
  type LatentDType,
  type LatentPayloadReference,
  type LatentTransferAuthorization,
  type LatentBlobStore,
  type LatentTransferEnvelope
} from "./LatentChannel";

export interface LatentDigest {
  sha256(bytes: Uint8Array): Promise<string>;
}

export interface LatentReplayGuard {
  /** Atomically records a transfer ID; false means it was already consumed. */
  claim(input: { transferId: string; expiresAt: string; recipientAgentId: string }): Promise<boolean>;
}

export interface LatentChannelHost {
  authorization: LatentTransferAuthorization;
  blobs: LatentBlobStore;
  digest: LatentDigest;
  replay: LatentReplayGuard;
  now(): Date;
  createTransferId(): string;
}

export interface SendLatentInput {
  taskId: string;
  conversationId: string;
  sender: LatentCapability;
  recipient: LatentCapability;
  hiddenState: Float32Array;
  shape: readonly number[];
  dtype: LatentDType;
  ttlMs: number;
}

export interface ReceiveLatentInput {
  envelope: unknown;
  taskId: string;
  senderAgentId: string;
  recipient: LatentCapability;
}

export class LatentChannelRuntime {
  constructor(
    private readonly host: LatentChannelHost,
    private readonly codecs: readonly LatentCodec[]
  ) {}

  async send(input: SendLatentInput): Promise<LatentTransferEnvelope | null> {
    const selection = negotiateLatentCodec(input.sender, input.recipient);
    if (!selection || !Number.isSafeInteger(input.ttlMs) || input.ttlMs <= 0 ||
        input.ttlMs > 5 * 60_000) return null;

    const elements = input.shape.reduce((total, dimension) => total * dimension, 1);
    if (input.shape.length < 1 || input.shape.length > 8 ||
        input.shape.some(dimension => !Number.isSafeInteger(dimension) || dimension <= 0) ||
        !Number.isSafeInteger(elements) || elements !== input.hiddenState.length ||
        elements > 16 * 1024 * 1024) return null;

    const codec = this.findCodec(selection);
    if (!codec || !codec.canEncode(selection.encoderModel) ||
        !codec.canDecode(selection.decoderModel)) return null;

    const bytes = await codec.encode({
      hiddenState: input.hiddenState,
      shape: input.shape,
      dtype: selection.dtype
    });
    if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0 ||
        bytes.byteLength > selection.maxPayloadBytes) return null;

    const now = this.host.now();
    const expiresAt = new Date(now.getTime() + input.ttlMs).toISOString();
    const allowed = await this.host.authorization.authorize({
      taskId: input.taskId,
      conversationId: input.conversationId,
      senderAgentId: input.sender.agentId,
      recipientAgentId: input.recipient.agentId,
      codec: selection,
      payloadByteLength: bytes.byteLength
    });
    if (!allowed) return null;

    const sha256 = await this.host.digest.sha256(bytes);
    if (!/^[a-f0-9]{64}$/i.test(sha256)) throw new Error("Digest provider returned an invalid SHA-256 value");
    const stored = await this.host.blobs.put(bytes, { expiresAt });
    if (stored.byteLength !== bytes.byteLength || stored.sha256.toLowerCase() !== sha256.toLowerCase()) {
      throw new Error("Blob store receipt does not match the encoded payload");
    }

    const envelope = {
      protocolVersion: 1 as const,
      transferId: this.host.createTransferId(),
      taskId: input.taskId,
      conversationId: input.conversationId,
      senderAgentId: input.sender.agentId,
      recipientAgentId: input.recipient.agentId,
      sequence: 0,
      createdAt: now.toISOString(),
      expiresAt,
      codec: selection,
      shape: [...input.shape],
      payload: stored
    };
    return LatentTransferEnvelopeSchema.parse(envelope);
  }

  async receive(input: ReceiveLatentInput): Promise<Float32Array> {
    const envelope = validateLatentTransfer(input.envelope, {
      taskId: input.taskId,
      senderAgentId: input.senderAgentId,
      recipientAgentId: input.recipient.agentId
    }, this.host.now());

    if (envelope.codec.decoderModel.modelId !== input.recipient.model.modelId ||
        envelope.codec.decoderModel.modelRevision !== input.recipient.model.modelRevision) {
      throw new Error("Latent transfer decoder model identity does not match this runtime");
    }
    const capability = input.recipient;
    const advertised = capability.codecs.some(item =>
      item.codecId === envelope.codec.codecId &&
      item.codecVersion === envelope.codec.codecVersion &&
      item.dtypes.includes(envelope.codec.dtype) &&
      item.maxPayloadBytes >= envelope.payload.byteLength
    );
    if (!capability.supportsLatentDecode || !advertised) {
      throw new Error("Recipient does not advertise the negotiated latent codec");
    }

    const codec = this.findCodec(envelope.codec);
    if (!codec || !codec.canDecode(envelope.codec.decoderModel)) {
      throw new Error("No compatible latent decoder is installed");
    }
    const allowed = await this.host.authorization.authorize({
      taskId: envelope.taskId,
      conversationId: envelope.conversationId,
      senderAgentId: envelope.senderAgentId,
      recipientAgentId: envelope.recipientAgentId,
      codec: envelope.codec,
      payloadByteLength: envelope.payload.byteLength
    });
    if (!allowed) throw new Error("Latent transfer is not authorized");

    const bytes = await this.host.blobs.get(envelope.payload.blobRef);
    if (!bytes || bytes.byteLength !== envelope.payload.byteLength) {
      throw new Error("Latent payload is missing or has an unexpected byte length");
    }
    const actualDigest = await this.host.digest.sha256(bytes);
    if (actualDigest.toLowerCase() !== envelope.payload.sha256.toLowerCase()) {
      throw new Error("Latent payload integrity check failed");
    }
    if (!await this.host.replay.claim({
      transferId: envelope.transferId,
      expiresAt: envelope.expiresAt,
      recipientAgentId: envelope.recipientAgentId
    })) {
      throw new Error("Latent transfer has already been consumed");
    }

    const decoded = await codec.decode({
      bytes,
      shape: envelope.shape,
      dtype: envelope.codec.dtype
    });
    const expectedElements = envelope.shape.reduce((total, dimension) => total * dimension, 1);
    if (!(decoded instanceof Float32Array) || decoded.length !== expectedElements) {
      throw new Error("Latent decoder returned an invalid tensor shape");
    }
    return decoded;
  }

  private findCodec(selection: LatentCodecSelection): LatentCodec | undefined {
    return this.codecs.find(codec =>
      codec.codecId === selection.codecId && codec.codecVersion === selection.codecVersion
    );
  }
}
