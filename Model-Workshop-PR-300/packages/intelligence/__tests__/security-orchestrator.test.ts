import { describe, expect, it } from "vitest";
import { Orchestrator } from "../orchestrator/Orchestrator";
import { SecurityDivision } from "../security/SecurityDivision";
import { DelegationGate } from "../security/delegation";

const inference = { generate: async () => ({ payload: {} }) };
const getResources = () => ({ availableMemoryMB: 4096, loadedModels: [] as string[] });

describe("orchestrator security integration", () => {
  it("exposes a security division that denies tool use by default (no verifier supplied)", async () => {
    const orchestrator = new Orchestrator({ inference, getResources });
    expect(orchestrator.security).toBeInstanceOf(SecurityDivision);

    const team = await orchestrator.security.assemble("task-1", "Audit the JWT validation in our OAuth flow");
    const member = team.members[0];
    const decision = await orchestrator.security.requestToolUse(team, member.agentId, "static-analyzer", "scope-1");
    expect(decision.allowed).toBe(false);
    team.release();
  });

  it("refuses operational tasks by default and leaves no specialists behind", async () => {
    const orchestrator = new Orchestrator({ inference, getResources });
    await expect(
      orchestrator.security.assemble("task-1", "Run a brute force attack against the Kerberos service", { approvalRef: "x" })
    ).rejects.toThrow(/human approval/);
    expect(orchestrator.security.activeSpecialistCount()).toBe(0);
  });

  it("uses a supplied delegation gate and keeps the permanent agents intact", async () => {
    const gate = new DelegationGate();
    const orchestrator = new Orchestrator({ inference, getResources, delegationGate: gate });
    const team = await orchestrator.security.assemble("task-1", "Review Entra ID conditional access");
    await orchestrator.security.requestToolUse(team, team.members[0].agentId, "tool", "scope");
    expect(gate.getAuditLog()).toHaveLength(1);
    team.release();
    expect(orchestrator.agents.listPermanent()).toHaveLength(8);
  });
});
