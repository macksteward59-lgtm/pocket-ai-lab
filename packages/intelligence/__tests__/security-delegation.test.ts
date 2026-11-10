import { describe, expect, it } from "vitest";
import { DelegationGate, type DelegationVoucher } from "../security/delegation";

const T0 = Date.parse("2026-01-01T00:00:00Z");
let seq = 0;

function voucher(over: Partial<DelegationVoucher> = {}): DelegationVoucher {
  return {
    voucherId: "v-" + ++seq,
    agentId: "agent-1",
    taskId: "task-1",
    tool: "static-analyzer",
    scopeRef: "scope-1",
    issuedAt: new Date(T0 - 1000).toISOString(),
    expiresAt: new Date(T0 + 5 * 60 * 1000).toISOString(),
    signature: "valid",
    ...over
  };
}
const request = { agentId: "agent-1", taskId: "task-1", tool: "static-analyzer", scopeRef: "scope-1" };

function gate(extra: { now?: () => number; maxVoucherLifetimeMs?: number; maxAuditEntries?: number } = {}) {
  return new DelegationGate({
    verifier: { verify: v => v.signature === "valid" },
    now: () => T0,
    ...extra
  });
}

describe("delegation gate", () => {
  it("denies everything when no verifier is configured (fail closed)", async () => {
    const decision = await new DelegationGate().authorize(request, voucher());
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/fail closed/);
  });

  it("allows a valid voucher that matches agent, task, tool, and scope", async () => {
    const decision = await gate().authorize(request, voucher());
    expect(decision.allowed).toBe(true);
  });

  it("denies a missing voucher and incomplete requests", async () => {
    expect((await gate().authorize(request)).allowed).toBe(false);
    expect((await gate().authorize({ ...request, tool: " " }, voucher())).allowed).toBe(false);
  });

  it("denies when the signature is invalid, the verifier says false, or the verifier throws", async () => {
    expect((await gate().authorize(request, voucher({ signature: "forged" }))).allowed).toBe(false);
    const throwing = new DelegationGate({ verifier: { verify: () => { throw new Error("boom"); } }, now: () => T0 });
    const decision = await throwing.authorize(request, voucher());
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/verification failed/);
  });

  it("denies a voucher issued for a different agent, task, tool, or scope", async () => {
    const g = gate();
    expect((await g.authorize(request, voucher({ agentId: "other" }))).reason).toMatch(/different agent/);
    expect((await g.authorize(request, voucher({ taskId: "other" }))).reason).toMatch(/different task/);
    expect((await g.authorize(request, voucher({ tool: "other" }))).reason).toMatch(/cover this tool/);
    expect((await g.authorize(request, voucher({ scopeRef: "other" }))).reason).toMatch(/different scope/);
  });

  it("enforces expiry, not-yet-valid, bad timestamps, and maximum lifetime", async () => {
    const g = gate();
    expect((await g.authorize(request, voucher({ expiresAt: new Date(T0 - 1).toISOString() }))).reason).toMatch(/expired/);
    expect((await g.authorize(request, voucher({ issuedAt: new Date(T0 + 1000).toISOString() }))).reason).toMatch(/not yet valid/);
    expect((await g.authorize(request, voucher({ issuedAt: "garbage" }))).reason).toMatch(/invalid/);
    const longLived = voucher({ expiresAt: new Date(T0 + 60 * 60 * 1000).toISOString() });
    expect((await g.authorize(request, longLived)).reason).toMatch(/lifetime/);
  });

  it("makes vouchers single-use", async () => {
    const g = gate();
    const v = voucher();
    expect((await g.authorize(request, v)).allowed).toBe(true);
    const replay = await g.authorize(request, v);
    expect(replay.allowed).toBe(false);
    expect(replay.reason).toMatch(/already used/);
  });

  it("allows only one of two concurrent requests with the same voucher", async () => {
    const g = new DelegationGate({
      verifier: { verify: async v => { await new Promise(r => setTimeout(r, 5)); return v.signature === "valid"; } },
      now: () => T0
    });
    const v = voucher();
    const results = await Promise.all([g.authorize(request, v), g.authorize(request, v)]);
    expect(results.filter(r => r.allowed)).toHaveLength(1);
  });

  it("does not consume a voucher on a denied attempt", async () => {
    const g = gate();
    const v = voucher();
    expect((await g.authorize({ ...request, tool: "wrong-tool" }, v)).allowed).toBe(false);
    expect((await g.authorize(request, v)).allowed).toBe(true);
  });

  it("keeps an audit trail of allows and denials, capped, and returns copies", async () => {
    const g = gate({ maxAuditEntries: 3 });
    await g.authorize(request, voucher());
    await g.authorize(request, voucher({ signature: "forged" }));
    await g.authorize(request);
    await g.authorize(request, voucher());
    const log = g.getAuditLog();
    expect(log).toHaveLength(3);
    expect(log[log.length - 1].allowed).toBe(true);
    log[0].allowed = true; // mutating the copy must not change the gate's record
    expect(g.getAuditLog()[0].allowed).toBe(false);
  });

  it("records denials decided outside the gate", () => {
    const g = gate();
    expect(g.recordDenial(request, "not on team").allowed).toBe(false);
    expect(g.getAuditLog()[0].reason).toBe("not on team");
  });
});
