import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { GOVERNANCE_ADVISORY_INVARIANT, specialistPrompt } from "../agents/specialists/dynamicCatalog";
import { MessageBus } from "../message-bus/MessageBus";
import { DeliberationEngine } from "../deliberation/DeliberationEngine";
import { Orchestrator } from "../orchestrator/Orchestrator";
import { MemoryManager } from "../memory/MemoryManager";
import { AuditLedger } from "../security/AuditLedger";

describe("Gate 0.1 regression checks", () => {
  it("keeps published message payloads immutable", () => {
    const bus = new MessageBus();
    const message = bus.publish({
      protocolVersion: 1,
      messageId: crypto.randomUUID(),
      taskId: "gate-0.1",
      conversationId: "gate-0.1",
      senderAgentId: "reasoner",
      recipientAgentId: "broadcast",
      messageType: "analysis",
      payload: { analysis: "proposal" },
      evidenceRefs: [],
      createdAt: new Date().toISOString(),
      sequence: 0
    });
    expect(Object.isFrozen(message.payload)).toBe(true);
    expect((message.payload as { analysis: string }).analysis).toBe("proposal");
  });

  it("does not claim consensus without validation", async () => {
    const result = await new DeliberationEngine().runCycle("gate-0.1", [], async () => []);
    expect(result.consensus).toBe(false);
    expect(result.finalSynthesis).toBeUndefined();
  });

  it("requires an explicit inference provider instead of placeholder execution", () => {
    expect(() => new Orchestrator({
      inference: undefined as never,
      getResources: () => ({ availableMemoryMB: 4096, loadedModels: [] })
    })).toThrow(/InferenceProvider must be supplied/);
  });

  it("preserves unverified provenance in memory", async () => {
    const memory = new MemoryManager();
    const id = await memory.write({
      layer: "episodic",
      content: "proposal",
      provenance: { agentId: "director", verified: false, sourceRefs: [] }
    });
    const entry = (memory as unknown as {
      store: Array<{ id: string; provenance: { verified: boolean } }>
    }).store.find(item => item.id === id);
    expect(entry?.provenance.verified).toBe(false);
  });

  it("keeps the governance advisory invariant in front of specialist prompts", () => {
    const prompt = specialistPrompt("azure-tenant-isolation", "Record the finding.");
    expect(prompt.startsWith(GOVERNANCE_ADVISORY_INVARIANT)).toBe(true);
    expect(prompt).toContain("forbidden from drafting working exploit tools");
  });

  it("reaches REVIEW_READY and spawns reviewers only for an in-scope upload", async () => {
    const orchestrator = new Orchestrator({
      inference: { async generate() { return { payload: { analysis: "unused" } }; } },
      getResources: () => ({ availableMemoryMB: 4096, loadedModels: [] })
    });
    const dir = await mkdtemp(path.join(tmpdir(), "gate01-governance-"));
    try {
      const ready = await orchestrator.handleScanTelemetryUpload({
        taskId: "gate01-ready",
        sourceFormat: "burp",
        content: "<issues/>",
        sidecarUrl: "http://127.0.0.1:8765",
        ledger: new AuditLedger(path.join(dir, "ready.jsonl")),
        fetchImpl: async () => new Response(JSON.stringify(reviewBody(true)), { status: 200 })
      });
      expect(ready.reviewPackage.state).toBe("REVIEW_READY");
      expect(ready.specialistIds.length).toBeGreaterThan(0);
      expect(ready.authorized).toBe(false);
      expect(ready.evidence.requiresHumanApproval).toBe(true);
      expect(JSON.stringify(ready).includes('"authorized":true')).toBe(false);

      const dropped = await orchestrator.handleScanTelemetryUpload({
        taskId: "gate01-drop",
        sourceFormat: "nessus",
        content: "bad",
        sidecarUrl: "http://127.0.0.1:8765",
        ledger: new AuditLedger(path.join(dir, "drop.jsonl")),
        fetchImpl: async () => new Response(JSON.stringify(reviewBody(false)), { status: 200 })
      });
      expect(dropped.reviewPackage.findings).toEqual([]);
      expect(dropped.reviewPackage.state).toBe("REJECTED");
      expect(dropped.specialistIds).toEqual([]);
      expect(dropped.authorized).toBe(false);
      const violation = orchestrator.bus.getThread("gate01-drop")
        .find(message => message.messageType === "security_boundary_violation");
      expect(violation?.payload).toMatchObject({ event: "SecurityBoundaryViolation" });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

function reviewBody(inScope: boolean) {
  const id = crypto.randomUUID();
  return {
    authorized: false,
    boundary_violations: inScope ? [] : [{
      event: "SecurityBoundaryViolation",
      event_id: crypto.randomUUID(),
      reason: "Target is outside the operator allowlist",
      finding_id: id,
      asset: {
        target_uri: "https://other.example/login",
        base_domain: "other.example",
        is_in_scope: false
      },
      authorized: false
    }],
    review_package: {
      package_id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      source_format: "burp",
      state: inScope ? "REVIEW_READY" : "REJECTED",
      authorized: false,
      requires_human_approval: true,
      audit_trail_logs: [inScope ? "REVIEW_READY" : "REJECTED"],
      findings: inScope ? [{
        finding_id: id,
        title: "TLS certificate missing on the login host",
        vulnerability_type: "tls",
        severity: "Low",
        confidence_level: "Certain",
        affected_parameters: [],
        reproduction_checklists: ["Apply the header outside this pipeline."],
        asset: {
          target_uri: "https://app.example.com/login",
          base_domain: "app.example.com",
          is_in_scope: true
        },
        authorized: false
      }] : []
    }
  };
}
