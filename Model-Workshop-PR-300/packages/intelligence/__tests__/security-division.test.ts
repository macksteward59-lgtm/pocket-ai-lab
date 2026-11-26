import { describe, expect, it } from "vitest";
import { AgentManager, CORE_AGENTS } from "../agents/AgentManager";
import { DelegationGate, type DelegationVoucher } from "../security/delegation";
import { SecurityDivision, type ApprovalVerifier } from "../security/SecurityDivision";
import { ToolRegistry, type ToolDescriptor } from "../security/tools";

const T0 = Date.parse("2026-01-01T00:00:00Z");

function setup(opts: { approvalVerifier?: ApprovalVerifier; maxTeamSize?: number; toolRegistry?: ToolRegistry } = {}) {
  const agents = new AgentManager();
  CORE_AGENTS.forEach(agent => agents.registerPermanent(agent));
  const gate = new DelegationGate({ verifier: { verify: v => v.signature === "valid" }, now: () => T0 });
  const toolRegistry = opts.toolRegistry ?? new ToolRegistry();
  toolRegistry.list().forEach(tool => toolRegistry.declareAvailable(tool.id));
  const division = new SecurityDivision({ agents, gate, ...opts, toolRegistry });
  return { agents, gate, division };
}

function voucherFor(agentId: string, over: Partial<DelegationVoucher> = {}): DelegationVoucher {
  return {
    voucherId: "v-" + Math.random().toString(36).slice(2),
    agentId, taskId: "task-1", tool: "static-analyzer", scopeRef: "scope-1",
    issuedAt: new Date(T0 - 1000).toISOString(),
    expiresAt: new Date(T0 + 60_000).toISOString(),
    signature: "valid",
    ...over
  };
}

const ENTRA_TASK = "Analyze the token validation flow in a custom Entra ID setup for JWT bypass vectors";

describe("security division", () => {
  it("assembles non-permanent, lab-scoped specialists and releases them cleanly", async () => {
    const { agents, division } = setup();
    const team = await division.assemble("task-1", ENTRA_TASK);

    expect(team.useCoreSecurityAgent).toBe(false);
    expect(team.members.length).toBeGreaterThanOrEqual(2);
    for (const member of team.members) {
      const profile = agents.getAgent(member.agentId);
      expect(profile?.permanent).toBe(false);
      expect(profile?.permissions).toEqual(["lab"]);
    }
    expect(division.activeSpecialistCount()).toBe(team.members.length);

    team.release();
    team.release(); // idempotent
    expect(division.activeSpecialistCount()).toBe(0);
    for (const member of team.members) expect(agents.getAgent(member.agentId)).toBeUndefined();
    expect(agents.getAgent("security")).toBeDefined(); // core agents untouched
  });

  it("falls back to the core security agent when nothing matches", async () => {
    const { division } = setup();
    const team = await division.assemble("task-1", "Unrelated roadmap planning");
    expect(team.members).toEqual([]);
    expect(team.useCoreSecurityAgent).toBe(true);
  });

  it("respects the maximum team size", async () => {
    const { division } = setup({ maxTeamSize: 1 });
    const team = await division.assemble("task-1", "Entra ID JWT SAML Kerberos TLS Ghidra disassembly");
    expect(team.members).toHaveLength(1);
  });

  it("refuses operational tasks without a verifier, with a bad approval, or when the verifier throws", async () => {
    const task = "Run a brute force attack against the Kerberos service";

    const none = setup();
    await expect(none.division.assemble("task-1", task, { approvalRef: "appr-1" })).rejects.toThrow(/human approval/);
    expect(none.division.activeSpecialistCount()).toBe(0);

    const denying = setup({ approvalVerifier: { verify: () => false } });
    await expect(denying.division.assemble("task-1", task, { approvalRef: "appr-1" })).rejects.toThrow(/human approval/);

    const throwing = setup({ approvalVerifier: { verify: () => { throw new Error("down"); } } });
    await expect(throwing.division.assemble("task-1", task, { approvalRef: "appr-1" })).rejects.toThrow(/human approval/);

    const noRef = setup({ approvalVerifier: { verify: () => true } });
    await expect(noRef.division.assemble("task-1", task)).rejects.toThrow(/human approval/);
  });

  it("assembles an operational task only when the approval verifies for that task", async () => {
    const task = "Run a brute force attack against the Kerberos service";
    const { division } = setup({ approvalVerifier: { verify: (taskId, ref) => taskId === "task-1" && ref === "appr-1" } });
    const team = await division.assemble("task-1", task, { approvalRef: "appr-1" });
    expect(team.members.length).toBeGreaterThan(0);
    await expect(division.assemble("task-2", task, { approvalRef: "appr-1" })).rejects.toThrow(/human approval/);
  });

  it("attaches skill ids from the registry to each team member", async () => {
    const { division } = setup();
    const team = await division.assemble("task-1", ENTRA_TASK);
    const identity = team.members.find(m => m.templateId === "identity-security");
    expect(identity).toBeDefined();
    expect(identity!.skills.length).toBeGreaterThan(0);
    expect(identity!.skills).toContain("jwt-verification");
  });

  it("decides tool use through the gate for active team members requesting a permitted analysis tool", async () => {
    const { division, gate } = setup();
    const team = await division.assemble("task-1", "Analyze the binary for static analysis issues");
    const member = team.members.find(m => m.templateId === "reverse-engineering")!;

    const allowed = await division.requestToolUse(team, member.agentId, "ghidra", "scope-1", voucherFor(member.agentId, { tool: "ghidra" }));
    expect(allowed.allowed).toBe(true);

    const noVoucher = await division.requestToolUse(team, member.agentId, "ghidra", "scope-1");
    expect(noVoucher.allowed).toBe(false);

    const outsider = await division.requestToolUse(team, "security", "ghidra", "scope-1", voucherFor("security", { tool: "ghidra" }));
    expect(outsider.allowed).toBe(false);
    expect(outsider.reason).toMatch(/not an active member/);

    team.release();
    const afterRelease = await division.requestToolUse(team, member.agentId, "ghidra", "scope-1", voucherFor(member.agentId, { tool: "ghidra" }));
    expect(afterRelease.allowed).toBe(false);
    expect(gate.getAuditLog().length).toBe(4);
  });

  it("denies a tool the tool registry does not allow this specialist to request", async () => {
    const { division } = setup();
    const team = await division.assemble("task-1", ENTRA_TASK);
    const identity = team.members.find(m => m.templateId === "identity-security")!;
    const decision = await division.requestToolUse(team, identity.agentId, "ghidra", "scope-1", voucherFor(identity.agentId, { tool: "ghidra" }));
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/may not request/);
  });


  it("denies tools whose host adapters are not installed", async () => {
    const registry = new ToolRegistry();
    const { division } = setup({ toolRegistry: registry });
    const team = await division.assemble("task-1", "Analyze the binary for static analysis issues");
    const member = team.members.find(m => m.templateId === "reverse-engineering")!;
    registry.declareUnavailable("ghidra");
    const decision = await division.requestToolUse(team, member.agentId, "ghidra", "scope-1", voucherFor(member.agentId, { tool: "ghidra" }));
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/not installed or available/);
  });

  it("denies an unknown tool without consulting the gate", async () => {
    const { division } = setup();
    const team = await division.assemble("task-1", ENTRA_TASK);
    const member = team.members[0];
    const decision = await division.requestToolUse(team, member.agentId, "not-a-real-tool", "scope-1");
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toMatch(/Unknown tool/);
  });

  it("requires a verified human approval for an active tool, separate from any task-level operational approval", async () => {
    const activeOnly: ToolDescriptor = {
      id: "gated-review",
      name: "Gated review",
      application: "Test fixture. The default catalog has no active tools.",
      mode: "active",
      specialists: ["identity-security"]
    };
    const activeRegistry = new ToolRegistry([activeOnly]);
    activeRegistry.declareAvailable("gated-review");
    const { division } = setup({
      approvalVerifier: { verify: (taskId, ref) => taskId === "task-1" && ref === "tool-approval" },
      toolRegistry: activeRegistry
    });
    const team = await division.assemble("task-1", "Review OAuth and OIDC flows");
    const identity = team.members.find(m => m.templateId === "identity-security")!;

    const noApproval = await division.requestToolUse(team, identity.agentId, "gated-review", "scope-1", voucherFor(identity.agentId, { tool: "gated-review" }));
    expect(noApproval.allowed).toBe(false);
    expect(noApproval.reason).toMatch(/human approval/);

    const approved = await division.requestToolUse(
      team, identity.agentId, "gated-review", "scope-1", voucherFor(identity.agentId, { tool: "gated-review" }), "tool-approval"
    );
    expect(approved.allowed).toBe(true);
  });

  it("allows an analysis-mode tool with no approval reference at all", async () => {
    const { division } = setup();
    const team = await division.assemble("task-1", "Analyze the binary for static analysis issues");
    const member = team.members.find(m => m.templateId === "reverse-engineering")!;
    const decision = await division.requestToolUse(team, member.agentId, "ghidra", "scope-1", voucherFor(member.agentId, { tool: "ghidra" }));
    expect(decision.allowed).toBe(true);
  });

  it("releases every specialist for a task on releaseTask", async () => {
    const { division } = setup();
    await division.assemble("task-1", ENTRA_TASK);
    await division.assemble("task-1", "Review Kerberos and TLS configuration");
    expect(division.activeSpecialistCount()).toBeGreaterThan(0);
    division.releaseTask("task-1");
    expect(division.activeSpecialistCount()).toBe(0);
  });

  it("requires a task id", async () => {
    await expect(setup().division.assemble(" ", ENTRA_TASK)).rejects.toThrow(/taskId is required/);
  });
});

describe("AgentManager.releaseSpecialist", () => {
  it("removes specialists and their sessions but never permanent agents", () => {
    const agents = new AgentManager();
    CORE_AGENTS.forEach(agent => agents.registerPermanent(agent));
    const id = agents.createSpecialist({ id: "x", role: "r", description: "d", capabilities: [], permissions: ["lab"] });
    agents.startSession(id, "task-1", "model-1");
    expect(agents.releaseSpecialist(id)).toBe(true);
    expect(agents.getAgent(id)).toBeUndefined();
    expect(agents.releaseSpecialist("security")).toBe(false);
    expect(agents.getAgent("security")).toBeDefined();
    expect(agents.releaseSpecialist("does-not-exist")).toBe(false);
  });
});
