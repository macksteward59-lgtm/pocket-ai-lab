import { describe, expect, it, vi } from "vitest";
import {
  AgentMessageEnvelopeSchema,
  AgentTaskRequestSchema,
  RuntimeSessionProofSchema,
  canonicalRuntimeSessionProofPayload,
  evaluateRuntimeReadiness
} from "../contracts/AgentProtocol";

const proof = {
  protocolVersion: 1 as const,
  sessionId: "session-1",
  modelId: "qwen-local",
  modelFileSHA256: "a".repeat(64),
  runtimeBuildId: "ios-llama-2026.11",
  expiresAt: "2030-01-01T00:00:00.000Z",
  generationCounter: 1,
  keyId: "device-runtime-key-1",
  signature: "base64-signature",
  algorithm: "Ed25519" as const
};

describe("cross-runtime agent protocol", () => {
  it("accepts the stable task contract and rejects unknown fields", () => {
    expect(AgentTaskRequestSchema.parse({
      protocolVersion: 1, id: "task-1", objective: "Analyze this design", requiredCapabilities: ["reasoning"]
    })).toEqual({
      protocolVersion: 1, id: "task-1", objective: "Analyze this design", requiredCapabilities: ["reasoning"]
    });
    expect(AgentTaskRequestSchema.safeParse({
      protocolVersion: 1, id: "task-1", objective: "Analyze", requiredCapabilities: [], authorized: true
    }).success).toBe(false);
  });

  it("validates the cross-platform message envelope", () => {
    expect(AgentMessageEnvelopeSchema.safeParse({
      protocolVersion: 1,
      messageId: "00000000-0000-4000-8000-000000000001",
      taskId: "task-1",
      conversationId: "conversation-1",
      senderAgentId: "reasoner",
      recipientAgentId: "critic",
      messageType: "analysis",
      payload: { analysis: "proposal" },
      evidenceRefs: [],
      createdAt: "2026-11-13T00:00:00.000Z",
      sequence: 0
    }).success).toBe(true);
  });


  it("encodes the runtime proof into stable length-prefixed signing bytes", () => {
    const encoded = Buffer.from(canonicalRuntimeSessionProofPayload(proof)).toString("base64");
    expect(encoded).toBe("AAAAInBvY2tldC1haS1ydW50aW1lLXNlc3Npb24tcHJvb2YtdjEAAAABMQAAAAlzZXNzaW9uLTEAAAAKcXdlbi1sb2NhbAAAAEBhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhYWFhAAAAEWlvcy1sbGFtYS0yMDI2LjExAAAAGDIwMzAtMDEtMDFUMDA6MDA6MDAuMDAwWgAAAAExAAAAFGRldmljZS1ydW50aW1lLWtleS0xAAAAB0VkMjU1MTk=");
    expect(canonicalRuntimeSessionProofPayload({ ...proof, generationCounter: 2 }))
      .not.toEqual(canonicalRuntimeSessionProofPayload(proof));
  });

  it("requires a complete Ed25519 runtime proof shape", () => {
    expect(RuntimeSessionProofSchema.safeParse(proof).success).toBe(true);
    expect(RuntimeSessionProofSchema.safeParse({ ...proof, modelFileSHA256: "not-a-hash" }).success).toBe(false);
  });

  it("does not report ready without a successful independent verifier", async () => {
    const verifier = { verify: vi.fn().mockResolvedValue(false) };
    await expect(evaluateRuntimeReadiness(proof, {
      modelId: proof.modelId, modelFileSHA256: proof.modelFileSHA256
    }, verifier, new Date("2026-11-13T00:00:00.000Z"))).resolves.toBe("unavailable");
    expect(verifier.verify).toHaveBeenCalledOnce();
  });

  it("reports expired proofs and rejects model substitution before verification", async () => {
    const verifier = { verify: vi.fn().mockResolvedValue(true) };
    await expect(evaluateRuntimeReadiness({
      ...proof, expiresAt: "2020-01-01T00:00:00.000Z"
    }, { modelId: proof.modelId, modelFileSHA256: proof.modelFileSHA256 }, verifier,
    new Date("2026-11-13T00:00:00.000Z"))).resolves.toBe("expired");
    await expect(evaluateRuntimeReadiness(proof, {
      modelId: "different-model", modelFileSHA256: proof.modelFileSHA256
    }, verifier, new Date("2026-11-13T00:00:00.000Z"))).resolves.toBe("unavailable");
    expect(verifier.verify).not.toHaveBeenCalled();
  });

  it("fails closed when the proof verifier throws", async () => {
    const verifier = { verify: vi.fn().mockRejectedValue(new Error("key unavailable")) };
    await expect(evaluateRuntimeReadiness(proof, {
      modelId: proof.modelId, modelFileSHA256: proof.modelFileSHA256
    }, verifier, new Date("2026-11-13T00:00:00.000Z"))).resolves.toBe("unavailable");
  });
});
