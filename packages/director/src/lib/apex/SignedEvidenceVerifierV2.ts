import { createHash, createPublicKey, verify as verifySignature, type KeyObject } from "node:crypto";

const DOMAIN = "pocket-ai-apex-signed-evidence-v2";
const FIELD_LIMITS = [64, 8, 128, 256, 128, 256, 64, 256, 128, 128, 128, 256, 64, 128, 64, 128] as const;

export interface ApexTrustedEvidenceKey {
  readonly keyId: string;
  readonly publicKeySPKIDERBase64: string;
  readonly allowedRuntimeIdentities: readonly string[];
  readonly allowedRuntimeVersions: readonly string[];
  readonly notBefore: string;
  readonly notAfter: string;
  readonly revokedAt?: string | null;
}

export interface ApexSignedEvidenceV2 {
  readonly protocolVersion: 2;
  readonly keyId: string;
  readonly conversationRequestId: string;
  readonly attemptId: string;
  readonly modelId: string;
  readonly modelFileHash: string;
  readonly runtimeSessionId: string;
  readonly runtimeVersion: string;
  readonly deviceId: string;
  readonly runtimeIdentity: string;
  readonly challengeNonce: string;
  readonly generationResultHash: string;
  readonly attestedAt: string;
  readonly healthCheckId: string;
  readonly algorithm: "Ed25519";
  readonly signature: string;
}

export interface ApexEvidenceAttemptBinding {
  readonly conversationRequestId: string;
  readonly attemptId: string;
  readonly modelId: string;
  readonly modelFileHash: string;
  readonly runtimeSessionId: string;
  readonly deviceId: string;
  readonly runtimeIdentity: string;
  readonly challengeNonce: string;
  readonly healthCheckId: string;
}

export interface ApexEvidenceReplayStore {
  /** Must atomically reject reuse of a keyId/challengeNonce pair across all attempts. */
  accept(input: { attemptId: string; challengeNonce: string; keyId: string }): Promise<boolean>;
}

export type ApexEvidenceVerificationFailure =
  | "invalid_shape" | "unsupported_protocol" | "invalid_binding"
  | "unknown_key" | "key_not_valid" | "runtime_not_allowed"
  | "stale_evidence" | "clock_unavailable" | "invalid_signature" | "replay"
  | "replay_store_unavailable";

export type ApexEvidenceVerificationResult =
  | { readonly ok: true; readonly status: "verified_candidate"; readonly keyId: string; readonly evidenceDigest: string }
  | { readonly ok: false; readonly status: "rejected"; readonly reason: ApexEvidenceVerificationFailure };

/**
 * Canonical v2 signing bytes. Every field is UTF-8 with a 4-byte unsigned
 * big-endian byte length. Domain separation and length prefixes prevent
 * delimiter ambiguity and bind the health check and runtime identity.
 */
export function canonicalApexEvidenceV2(evidence: ApexSignedEvidenceV2): Buffer | null {
  const values = [
    DOMAIN,
    String(evidence.protocolVersion),
    evidence.keyId,
    evidence.conversationRequestId,
    evidence.attemptId,
    evidence.modelId,
    evidence.modelFileHash.toLowerCase(),
    evidence.runtimeSessionId,
    evidence.runtimeVersion,
    evidence.deviceId,
    evidence.runtimeIdentity,
    evidence.challengeNonce,
    evidence.generationResultHash.toLowerCase(),
    evidence.attestedAt,
    evidence.healthCheckId,
    evidence.algorithm
  ];
  const chunks: Buffer[] = [];
  for (let index = 0; index < values.length; index += 1) {
    const bytes = Buffer.from(values[index], "utf8");
    if (bytes.length === 0 || bytes.length > FIELD_LIMITS[index]) return null;
    const prefix = Buffer.alloc(4);
    prefix.writeUInt32BE(bytes.length, 0);
    chunks.push(prefix, bytes);
  }
  return Buffer.concat(chunks);
}

function canonicalBase64(value: string, expectedBytes: number): Buffer | null {
  if (!value || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return null;
  const decoded = Buffer.from(value, "base64");
  if (decoded.length !== expectedBytes || decoded.toString("base64") !== value) return null;
  return decoded;
}

function isNonEmptyBoundedString(value: unknown, maximumBytes: number): value is string {
  return typeof value === "string" && value.trim().length > 0 &&
    Buffer.byteLength(value, "utf8") <= maximumBytes;
}

function isSHA256(value: string): boolean {
  return /^[a-f0-9]{64}$/i.test(value);
}

function isISODate(value: string): number | null {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value ? parsed : null;
}

function exactShape(value: unknown): value is ApexSignedEvidenceV2 {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const expected = [
    "protocolVersion", "keyId", "conversationRequestId", "attemptId", "modelId",
    "modelFileHash", "runtimeSessionId", "runtimeVersion", "deviceId",
    "runtimeIdentity", "challengeNonce", "generationResultHash", "attestedAt",
    "healthCheckId", "algorithm", "signature"
  ];
  if (Object.keys(record).length !== expected.length ||
      !expected.every(key => Object.prototype.hasOwnProperty.call(record, key))) return false;
  const stringFields = [
    "keyId", "conversationRequestId", "attemptId", "modelId", "modelFileHash",
    "runtimeSessionId", "runtimeVersion", "deviceId", "runtimeIdentity",
    "challengeNonce", "generationResultHash", "attestedAt", "healthCheckId",
    "algorithm", "signature"
  ];
  return record.protocolVersion === 2 &&
    record.algorithm === "Ed25519" &&
    stringFields.every(key => typeof record[key] === "string" && (record[key] as string).length > 0);
}

function bindingMatches(evidence: ApexSignedEvidenceV2, expected: ApexEvidenceAttemptBinding): boolean {
  return evidence.conversationRequestId === expected.conversationRequestId &&
    evidence.attemptId === expected.attemptId &&
    evidence.modelId === expected.modelId &&
    evidence.modelFileHash.toLowerCase() === expected.modelFileHash.toLowerCase() &&
    evidence.runtimeSessionId === expected.runtimeSessionId &&
    evidence.deviceId === expected.deviceId &&
    evidence.runtimeIdentity === expected.runtimeIdentity &&
    evidence.challengeNonce === expected.challengeNonce &&
    evidence.healthCheckId === expected.healthCheckId;
}

/**
 * Verifies a signed device/runtime evidence candidate. Success means only that
 * the candidate signature and bindings are valid. It does not approve actions,
 * issue a receipt, persist an APEX decision, or set an authorized flag.
 */
export class ApexSignedEvidenceVerifier {
  private readonly keys: ReadonlyMap<string, {
    readonly publicKey: KeyObject;
    readonly runtimeIdentities: ReadonlySet<string>;
    readonly runtimeVersions: ReadonlySet<string>;
    readonly notBefore: number;
    readonly notAfter: number;
    readonly revokedAt: number | null;
  }>;
  private readonly replayStore: ApexEvidenceReplayStore;
  private readonly maxEvidenceAgeMs: number;
  private readonly futureSkewMs: number;
  private readonly now: () => number;

  constructor(options: {
    trustedKeys: readonly ApexTrustedEvidenceKey[];
    replayStore: ApexEvidenceReplayStore;
    maxEvidenceAgeMs?: number;
    futureSkewMs?: number;
    now?: () => number;
  }) {
    if (!options || !options.replayStore || typeof options.replayStore.accept !== "function") {
      throw new Error("A fail-closed replay store is required");
    }
    this.replayStore = options.replayStore;
    this.maxEvidenceAgeMs = options.maxEvidenceAgeMs ?? 30_000;
    this.futureSkewMs = options.futureSkewMs ?? 1_000;
    this.now = options.now ?? Date.now;
    if (!Number.isSafeInteger(this.maxEvidenceAgeMs) || this.maxEvidenceAgeMs < 1 ||
        !Number.isSafeInteger(this.futureSkewMs) || this.futureSkewMs < 0) {
      throw new Error("Evidence freshness bounds are invalid");
    }

    const grouped = new Map<string, ApexTrustedEvidenceKey[]>();
    const trustedKeys: unknown[] = Array.isArray(options.trustedKeys) ? options.trustedKeys : [];
    for (const candidate of trustedKeys) {
      if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) continue;
      const key = candidate as ApexTrustedEvidenceKey;
      if (typeof key.keyId !== "string") continue;
      const list = grouped.get(key.keyId) ?? [];
      list.push(key);
      grouped.set(key.keyId, list);
    }
    const usable = new Map<string, {
      publicKey: KeyObject;
      runtimeIdentities: ReadonlySet<string>;
      runtimeVersions: ReadonlySet<string>;
      notBefore: number;
      notAfter: number;
      revokedAt: number | null;
    }>();
    for (const [keyId, entries] of grouped) {
      if (entries.length !== 1) continue;
      const source = entries[0];
      const hasRevocation = source.revokedAt !== undefined && source.revokedAt !== null;
      const revokedAt = hasRevocation && typeof source.revokedAt === "string"
        ? isISODate(source.revokedAt)
        : null;
      const der = typeof source.publicKeySPKIDERBase64 === "string"
        ? canonicalBase64(source.publicKeySPKIDERBase64, 44)
        : null;
      const notBefore = typeof source.notBefore === "string" ? isISODate(source.notBefore) : null;
      const notAfter = typeof source.notAfter === "string" ? isISODate(source.notAfter) : null;
      const runtimeIdentitiesValid = Array.isArray(source.allowedRuntimeIdentities) &&
        source.allowedRuntimeIdentities.length > 0 && source.allowedRuntimeIdentities.length <= 32 &&
        source.allowedRuntimeIdentities.every(value => isNonEmptyBoundedString(value, 128));
      const runtimeVersionsValid = Array.isArray(source.allowedRuntimeVersions) &&
        source.allowedRuntimeVersions.length > 0 && source.allowedRuntimeVersions.length <= 32 &&
        source.allowedRuntimeVersions.every(value => isNonEmptyBoundedString(value, 128));
      if (!isNonEmptyBoundedString(keyId, 128) ||
          !isNonEmptyBoundedString(source.publicKeySPKIDERBase64, 256) || !der ||
          notBefore === null || notAfter === null || notAfter <= notBefore ||
          (hasRevocation && revokedAt === null) || !runtimeIdentitiesValid || !runtimeVersionsValid) continue;
      try {
        const publicKey = createPublicKey({ key: der, format: "der", type: "spki" });
        if (publicKey.asymmetricKeyType !== "ed25519") continue;
        usable.set(keyId, {
          publicKey,
          runtimeIdentities: new Set(source.allowedRuntimeIdentities),
          runtimeVersions: new Set(source.allowedRuntimeVersions),
          notBefore,
          notAfter,
          revokedAt
        });
      } catch {
        // Invalid provisioned key is excluded; verification remains fail-closed.
      }
    }
    this.keys = usable;
  }

  async verify(
    evidence: unknown,
    expected: ApexEvidenceAttemptBinding
  ): Promise<ApexEvidenceVerificationResult> {
    if (!exactShape(evidence)) return this.reject("invalid_shape");
    if (evidence.protocolVersion !== 2 || evidence.algorithm !== "Ed25519") {
      return this.reject("unsupported_protocol");
    }
    if (!expected ||
        Object.values(expected).some(value => typeof value !== "string" || value.length === 0) ||
        !isSHA256(expected.modelFileHash) ||
        !isSHA256(evidence.modelFileHash) || !isSHA256(evidence.generationResultHash) ||
        !bindingMatches(evidence, expected)) {
      return this.reject("invalid_binding");
    }

    const key = this.keys.get(evidence.keyId);
    if (!key) return this.reject("unknown_key");
    let now: number;
    try {
      now = this.now();
    } catch {
      return this.reject("clock_unavailable");
    }
    if (!Number.isSafeInteger(now)) return this.reject("clock_unavailable");
    const attestedAt = isISODate(evidence.attestedAt);
    if (now < key.notBefore || now >= key.notAfter ||
        (key.revokedAt !== null && now >= key.revokedAt)) {
      return this.reject("key_not_valid");
    }
    if (!key.runtimeIdentities.has(evidence.runtimeIdentity) ||
        !key.runtimeVersions.has(evidence.runtimeVersion)) {
      return this.reject("runtime_not_allowed");
    }
    if (attestedAt === null || attestedAt > now + this.futureSkewMs ||
        now - attestedAt > this.maxEvidenceAgeMs) {
      return this.reject("stale_evidence");
    }

    const signature = canonicalBase64(evidence.signature, 64);
    const payload = canonicalApexEvidenceV2(evidence);
    if (!signature || !payload || !verifySignature(null, payload, key.publicKey, signature)) {
      return this.reject("invalid_signature");
    }

    try {
      const accepted = await this.replayStore.accept({
        attemptId: evidence.attemptId,
        challengeNonce: evidence.challengeNonce,
        keyId: evidence.keyId
      });
      if (!accepted) return this.reject("replay");
    } catch {
      return this.reject("replay_store_unavailable");
    }

    return {
      ok: true,
      status: "verified_candidate",
      keyId: evidence.keyId,
      evidenceDigest: createHash("sha256").update(payload).digest("hex")
    };
  }

  private reject(reason: ApexEvidenceVerificationFailure): ApexEvidenceVerificationResult {
    return { ok: false, status: "rejected", reason };
  }
}
