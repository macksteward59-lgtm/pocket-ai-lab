import { createHash } from "node:crypto";
import type { LatentDigest } from "../../packages/intelligence/latent-communication/LatentChannelRuntime";

/** Node host adapter. Native iOS should use CryptoKit behind the same contract. */
export class NodeSha256Digest implements LatentDigest {
  async sha256(bytes: Uint8Array): Promise<string> {
    return createHash("sha256").update(bytes).digest("hex");
  }
}
