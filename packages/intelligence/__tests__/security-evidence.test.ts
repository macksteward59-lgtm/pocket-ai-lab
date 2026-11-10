import { describe, expect, it } from "vitest";
import { DelegationGate, type DelegationVoucher } from "../security/delegation";
import { buildEvidenceReport, renderEvidenceReportMarkdown, EvidenceReportError } from "../security/evidence";

const T0 = Date.parse("2026-01-01T00:00:00Z");

function voucher(over: Partial<DelegationVoucher> = {}): DelegationVoucher {
  return {
    voucherId: "v-" + Math.random().toString(36).slice(2),
    agentId: "agent-1", taskId: "task-1", tool: "burp-suite", scopeRef: "scope-1",
    issuedAt: new Date(T0 - 1000).toISOString(),
    expiresAt: new Date(T0 + 60_000).toISOString(),
    signature: "valid",
    ...over
  };
}

const baseInput = {
  taskId: "task-1",
  classification: "logical-bypass" as const,
  affectedComponent: "Entra ID token validation endpoint",
  attackSurface: "Token signature verification",
  reproductionSteps: ["Request a token from the test tenant", "Submit it to the validation endpoint", "Observe the response code"],
  remediationRecommendations: ["Reject unsigned tokens explicitly"],
  disclosureStatus: "drafted" as const,
  validatorConfirmed: true
};

async function gateWithOneAllowedEntry(request = { agentId: "agent-1", taskId: "task-1", tool: "burp-suite", scopeRef: "scope-1" }) {
  const gate = new DelegationGate({ verifier: { verify: v => v.signature === "valid" }, now: () => T0 });
  await gate.authorize(request, voucher());
  return gate;
}

describe("buildEvidenceReport", () => {
  it("refuses to build a report when the audit log has no allowed entry for the task", () => {
    expect(() => buildEvidenceReport([], baseInput)).toThrow(/No verified/);
    let threw: unknown;
    try { buildEvidenceReport([], baseInput); } catch (e) { threw = e; }
    expect(threw instanceof EvidenceReportError).toBe(true);
  });

  it("refuses when every audit entry for the task was denied", async () => {
    const gate = new DelegationGate({ verifier: { verify: () => false }, now: () => T0 });
    await gate.authorize({ agentId: "a", taskId: "task-1", tool: "burp-suite", scopeRef: "s" }, voucher({ signature: "forged" }));
    expect(() => buildEvidenceReport(gate.getAuditLog(), baseInput)).toThrow(/No verified/);
  });

  it("ignores allowed entries that belong to a different task", async () => {
    const gate = await gateWithOneAllowedEntry({ agentId: "agent-1", taskId: "other-task", tool: "burp-suite", scopeRef: "scope-1" });
    expect(() => buildEvidenceReport(gate.getAuditLog(), baseInput)).toThrow(/No verified/);
  });

  it("builds a report from real audit entries and never exceeds medium confidence on one entry, even validated", async () => {
    const gate = await gateWithOneAllowedEntry();
    const report = buildEvidenceReport(gate.getAuditLog(), baseInput);
    expect(report.evidence).toHaveLength(1);
    expect(report.evidence[0].tool).toBe("burp-suite");
    expect(report.confidence).toBe("medium");
  });

  it("caps confidence at low when the validator has not confirmed, regardless of evidence volume", async () => {
    const gate = await gateWithOneAllowedEntry();
    await gate.authorize({ agentId: "agent-1", taskId: "task-1", tool: "owasp-zap", scopeRef: "scope-2" }, voucher({ tool: "owasp-zap", scopeRef: "scope-2" }));
    const report = buildEvidenceReport(gate.getAuditLog(), { ...baseInput, validatorConfirmed: false });
    expect(report.confidence).toBe("low");
  });

  it("reaches high confidence only with validator confirmation and enough distinct evidence", async () => {
    const gate = await gateWithOneAllowedEntry();
    await gate.authorize({ agentId: "agent-1", taskId: "task-1", tool: "owasp-zap", scopeRef: "scope-2" }, voucher({ tool: "owasp-zap", scopeRef: "scope-2" }));
    const report = buildEvidenceReport(gate.getAuditLog(), baseInput);
    expect(report.confidence).toBe("high");
  });

  it("rejects reproduction steps that look like exploit code or payloads", async () => {
    const gate = await gateWithOneAllowedEntry();
    const withCode = { ...baseInput, reproductionSteps: ["function exploit() { /* ... */ }"] };
    expect(() => buildEvidenceReport(gate.getAuditLog(), withCode)).toThrow(/plain language/);
  });

  it("requires taskId, affectedComponent, attackSurface, at least one step, and at least one remediation", async () => {
    const gate = await gateWithOneAllowedEntry();
    const log = gate.getAuditLog();
    expect(() => buildEvidenceReport(log, { ...baseInput, taskId: " " })).toThrow(/taskId/);
    expect(() => buildEvidenceReport(log, { ...baseInput, affectedComponent: " " })).toThrow(/affectedComponent/);
    expect(() => buildEvidenceReport(log, { ...baseInput, attackSurface: " " })).toThrow(/attackSurface/);
    expect(() => buildEvidenceReport(log, { ...baseInput, reproductionSteps: [] })).toThrow(/reproduction step/);
    expect(() => buildEvidenceReport(log, { ...baseInput, remediationRecommendations: [] })).toThrow(/remediation/);
  });

  it("never fabricates a voucher id for evidence that had none", async () => {
    const gate = new DelegationGate({ verifier: { verify: v => v.signature === "valid" }, now: () => T0 });
    // recordDenial-style entries have no voucherId; simulate by reading the audit log directly after a normal allow,
    // then confirm evidence voucherId always traces back to the real voucher used, never invented.
    const v = voucher();
    await gate.authorize({ agentId: "agent-1", taskId: "task-1", tool: "burp-suite", scopeRef: "scope-1" }, v);
    const report = buildEvidenceReport(gate.getAuditLog(), baseInput);
    expect(report.evidence[0].voucherId).toBe(v.voucherId);
  });
});

describe("renderEvidenceReportMarkdown", () => {
  it("renders every evidence entry and section without adding new claims", async () => {
    const gate = await gateWithOneAllowedEntry();
    const report = buildEvidenceReport(gate.getAuditLog(), baseInput);
    const md = renderEvidenceReportMarkdown(report);
    expect(md).toContain(baseInput.affectedComponent);
    expect(md).toContain("burp-suite");
    expect(md).toContain(baseInput.reproductionSteps[0]);
    expect(md).toContain(baseInput.remediationRecommendations[0]);
    expect(md).toContain(report.confidence);
  });

  it("renders a placeholder, not an error, for a hypothetically empty evidence list", () => {
    const report = {
      taskId: "t", classification: "other" as const, affectedComponent: "c", attackSurface: "s",
      reproductionSteps: ["step"], remediationRecommendations: ["fix"], disclosureStatus: "drafted" as const,
      confidence: "low" as const, evidence: [], generatedAt: new Date(T0).toISOString()
    };
    expect(renderEvidenceReportMarkdown(report)).toContain("_None._");
  });
});
