import { describe, expect, it } from "vitest";
import { AgentManager, CORE_AGENTS } from "../agents/AgentManager";
import { DelegationGate } from "../security/delegation";
import { SecurityDivision } from "../security/SecurityDivision";
import { TeamExpansionPlanner, TeamExpansionDenied, DEFAULT_TEAM_SIZE, ABSOLUTE_MAX_TEAM_SIZE } from "../agents/TeamExpansionPlanner";

const T0 = Date.parse("2026-01-01T00:00:00Z");
const BROAD_TASK = "Entra ID JWT SAML Kerberos TLS Ghidra disassembly Copilot prompt injection";

function setup(opts: { approvalVerifier?: { verify: (t: string, r: string) => boolean | Promise<boolean> } } = {}) {
  const agents = new AgentManager();
  CORE_AGENTS.forEach(a => agents.registerPermanent(a));
  const gate = new DelegationGate({ verifier: { verify: v => v.signature === "valid" }, now: () => T0 });
  const division = new SecurityDivision({ agents, gate, approvalVerifier: opts.approvalVerifier, maxTeamSize: ABSOLUTE_MAX_TEAM_SIZE });
  const planner = new TeamExpansionPlanner({ division, approvalVerifier: opts.approvalVerifier });
  return { agents, division, planner };
}

describe("TeamExpansionPlanner", () => {
  it("grants up to the default size with no approval needed", async () => {
    const { planner } = setup();
    const team = await planner.expandTeam({ taskId: "t1", taskDescription: BROAD_TASK, requestedTeamSize: DEFAULT_TEAM_SIZE });
    expect(team.members.length).toBeLessThanOrEqual(DEFAULT_TEAM_SIZE);
    expect(planner.getLog()[0].approved).toBe(true);
  });

  it("refuses to exceed the default size without an approval reference", async () => {
    const { planner } = setup();
    await expect(planner.expandTeam({ taskId: "t1", taskDescription: BROAD_TASK, requestedTeamSize: DEFAULT_TEAM_SIZE + 1 }))
      .rejects.toThrow(/requires a verified human approval/);
    let threw: unknown;
    try { await planner.expandTeam({ taskId: "t1", taskDescription: BROAD_TASK, requestedTeamSize: DEFAULT_TEAM_SIZE + 1 }); } catch (e) { threw = e; }
    expect(threw instanceof TeamExpansionDenied).toBe(true);
  });

  it("grants an expansion above default size once a verified approval is given", async () => {
    const { planner } = setup({ approvalVerifier: { verify: (t, r) => t === "t1" && r === "ok" } });
    const team = await planner.expandTeam({
      taskId: "t1", taskDescription: BROAD_TASK, requestedTeamSize: DEFAULT_TEAM_SIZE + 2, approvalRef: "ok"
    });
    expect(team.members.length).toBeLessThanOrEqual(DEFAULT_TEAM_SIZE + 2);
  });

  it("never grants a team larger than the absolute ceiling, even with approval", async () => {
    const { planner } = setup({ approvalVerifier: { verify: () => true } });
    await expect(planner.expandTeam({
      taskId: "t1", taskDescription: BROAD_TASK, requestedTeamSize: ABSOLUTE_MAX_TEAM_SIZE + 1, approvalRef: "ok"
    })).rejects.toThrow(/exceeds the fixed ceiling/);
  });

  it("rejects a non-positive or non-integer requested size before touching approval or the division", async () => {
    const { planner } = setup({ approvalVerifier: { verify: () => true } });
    await expect(planner.expandTeam({ taskId: "t1", taskDescription: BROAD_TASK, requestedTeamSize: 0 })).rejects.toThrow(/positive integer/);
    await expect(planner.expandTeam({ taskId: "t1", taskDescription: BROAD_TASK, requestedTeamSize: 2.5 })).rejects.toThrow(/positive integer/);
  });

  it("possibleSpecialists is fixed and matches the six defined templates, never more", () => {
    const { planner } = setup();
    expect(planner.possibleSpecialists()).toHaveLength(6);
  });

  it("logs both denied and granted attempts, as copies", async () => {
    const { planner } = setup();
    await expect(planner.expandTeam({ taskId: "t1", taskDescription: BROAD_TASK, requestedTeamSize: DEFAULT_TEAM_SIZE + 1 })).rejects.toThrow();
    await planner.expandTeam({ taskId: "t2", taskDescription: BROAD_TASK, requestedTeamSize: 1 });
    const log = planner.getLog();
    expect(log).toHaveLength(2);
    expect(log[0].approved).toBe(false);
    expect(log[1].approved).toBe(true);
    log[0].approved = true;
    expect(planner.getLog()[0].approved).toBe(false);
  });
});
