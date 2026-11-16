import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  ApexSignedEvidenceVerifier,
  canonicalApexEvidenceV2,
  type ApexEvidenceAttemptBinding,
  type ApexEvidenceReplayStore,
  type ApexSignedEvidenceV2,
  type ApexTrustedEvidenceKey
} from "../../director/src/lib/apex/trust";

class MemoryReplayStore implements ApexEvidenceReplayStore {
  readonly accepted = new Set<string>();
  fail = false;

  async accept(input: { attemptId: string; challengeNonce: string; keyId: string }): Promise<boolean> {
    if (this.fail) throw new Error("replay store unavailable");
    const key = [input.keyId, input.challengeNonce].join(":");
    if (this.accepted.has(key)) return false;
    this.accepted.add(key);
    return true;
  }
}

const now = Date.parse("2026-11-16T18:00:00.000Z");
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const publicDER = publicKey.export({ format: "der", type: "spki" }) as Buffer;
const digest = (value: string) => createHash("sha256").update(value).digest("hex");

const expected: ApexEvidenceAttemptBinding = {
  conversationRequestId: "conversation-1",
  attemptId: "attempt-1",
  modelId: "sha256-" + digest("model"),
  modelFileHash: digest("model-file"),
  runtimeSessionId: "runtime-session-1",
  deviceId: "iphone-air-test-device",
  runtimeIdentity: "pocket-runtime-ios-v2",
  challengeNonce: "nonce-issued-by-host-0001",
  healthCheckId: "health-check-1"
};

function signedEvidence(overrides: Partial<ApexSignedEvidenceV2> = {}): ApexSignedEvidenceV2 {
  const unsigned: ApexSignedEvidenceV2 = {
    protocolVersion: 2,
    keyId: "runtime-key-1",
    conversationRequestId: expected.conversationRequestId,
    attemptId: expected.attemptId,
    modelId: expected.modelId,
    modelFileHash: expected.modelFileHash,
    runtimeSessionId: expected.runtimeSessionId,
    runtimeVersion: "llama-runtime-1.2.0",
    deviceId: expected.deviceId,
    runtimeIdentity: expected.runtimeIdentity,
    challengeNonce: expected.challengeNonce,
    generationResultHash: digest("actual generated output"),
    attestedAt: new Date(now).toISOString(),
    healthCheckId: expected.healthCheckId,
    algorithm: "Ed25519",
    signature: ""
  };
  const candidate = { ...unsigned, ...overrides, signature: "" };
  const payload = canonicalApexEvidenceV2(candidate);
  if (!payload) throw new Error("test evidence did not canonicalize");
  return { ...candidate, signature: sign(null, payload, privateKey).toString("base64") };
}

function trustedKey(overrides: Partial<ApexTrustedEvidenceKey> = {}): ApexTrustedEvidenceKey {
  return {
    keyId: "runtime-key-1",
    publicKeySPKIDERBase64: publicDER.toString("base64"),
    allowedRuntimeIdentities: ["pocket-runtime-ios-v2"],
    allowedRuntimeVersions: ["llama-runtime-1.2.0"],
    notBefore: new Date(now - 60_000).toISOString(),
    notAfter: new Date(now + 60_000).toISOString(),
    ...overrides
  };
}

function verifier(store = new MemoryReplayStore(), keys = [trustedKey()]) {
  return new ApexSignedEvidenceVerifier({ trustedKeys: keys, replayStore: store, now: () => now });
}

describe("APEX signed evidence v2", () => {
  it("verifies an exact attempt-bound Ed25519 candidate but never returns authorization", async () => {
    const store = new MemoryReplayStore();
    const result = await verifier(store).verify(signedEvidence(), expected);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.status).toBe("verified_candidate");
      expect(result.evidenceDigest).toMatch(/^[a-f0-9]{64}$/);
      expect("authorized" in result).toBe(false);
      expect("receipt" in result).toBe(false);
    }
    expect(store.accepted.size).toBe(1);
  });

  it("rejects tampering of every signed claim", async () => {
    const original = signedEvidence();
    const tampered = { ...original, generationResultHash: digest("tampered generated output") };
    const result = await verifier().verify(tampered, expected);
    expect(result).toEqual({ ok: false, status: "rejected", reason: "invalid_signature" });
  });

  it("rejects mismatched attempt bindings before accepting replay state", async () => {
    const store = new MemoryReplayStore();
    const result = await verifier(store).verify(signedEvidence(), { ...expected, deviceId: "other-device" });
    expect(result).toEqual({ ok: false, status: "rejected", reason: "invalid_binding" });
    expect(store.accepted.size).toBe(0);
  });

  it("rejects unknown, duplicate, expired, and revoked trusted keys", async () => {
    const unknown = await verifier().verify(signedEvidence({ keyId: "unknown-key" }), expected);
    expect(unknown).toEqual({ ok: false, status: "rejected", reason: "unknown_key" });

    const duplicate = await verifier(new MemoryReplayStore(), [trustedKey(), trustedKey()]).verify(signedEvidence(), expected);
    expect(duplicate).toEqual({ ok: false, status: "rejected", reason: "unknown_key" });

    const expired = await verifier(new MemoryReplayStore(), [
      trustedKey({ notAfter: new Date(now - 1).toISOString() })
    ]).verify(signedEvidence(), expected);
    expect(expired).toEqual({ ok: false, status: "rejected", reason: "key_not_valid" });

    const revoked = await verifier(new MemoryReplayStore(), [
      trustedKey({ revokedAt: new Date(now - 1).toISOString() })
    ]).verify(signedEvidence(), expected);
    expect(revoked).toEqual({ ok: false, status: "rejected", reason: "key_not_valid" });
  });

  it("rejects a runtime identity or version outside the key allowlist", async () => {
    const result = await verifier().verify(
      signedEvidence({ runtimeVersion: "llama-runtime-1.2.1" }),
      expected
    );
    expect(result).toEqual({ ok: false, status: "rejected", reason: "runtime_not_allowed" });
  });

  it("rejects stale and future-dated evidence", async () => {
    const stale = await verifier().verify(
      signedEvidence({ attestedAt: new Date(now - 60_000).toISOString() }),
      expected
    );
    expect(stale).toEqual({ ok: false, status: "rejected", reason: "stale_evidence" });

    const future = await verifier().verify(
      signedEvidence({ attestedAt: new Date(now + 5_000).toISOString() }),
      expected
    );
    expect(future).toEqual({ ok: false, status: "rejected", reason: "stale_evidence" });
  });

  it("rejects replay and replay-store failures closed", async () => {
    const store = new MemoryReplayStore();
    const check = verifier(store);
    expect((await check.verify(signedEvidence(), expected)).ok).toBe(true);
    expect(await check.verify(signedEvidence(), expected)).toEqual({
      ok: false, status: "rejected", reason: "replay"
    });

    const crossAttempt = new MemoryReplayStore();
    const crossAttemptVerifier = verifier(crossAttempt);
    expect((await crossAttemptVerifier.verify(signedEvidence(), expected)).ok).toBe(true);
    const secondEvidence = signedEvidence({ attemptId: "attempt-2" });
    const secondBinding = { ...expected, attemptId: "attempt-2" };
    expect(await crossAttemptVerifier.verify(secondEvidence, secondBinding)).toEqual({
      ok: false, status: "rejected", reason: "replay"
    });

    const unavailable = new MemoryReplayStore();
    unavailable.fail = true;
    expect(await verifier(unavailable).verify(signedEvidence(), expected)).toEqual({
      ok: false, status: "rejected", reason: "replay_store_unavailable"
    });
  });

  it("uses length-prefixed canonical fields so delimiter characters cannot collide", () => {
    const first = signedEvidence({ deviceId: "device\nruntimeIdentity:spoof" });
    const second = signedEvidence({ deviceId: "device", runtimeIdentity: "runtimeIdentity:spoof" });
    const firstPayload = canonicalApexEvidenceV2(first);
    const secondPayload = canonicalApexEvidenceV2(second);
    expect(firstPayload).not.toEqual(secondPayload);
  });

  it("rejects malformed shapes and invalid hash bindings", async () => {
    expect(await verifier().verify({ ...signedEvidence(), authorized: true }, expected)).toEqual({
      ok: false, status: "rejected", reason: "invalid_shape"
    });
    expect(await verifier().verify(signedEvidence(), { ...expected, modelFileHash: "not-a-hash" })).toEqual({
      ok: false, status: "rejected", reason: "invalid_binding"
    });
  });
});
