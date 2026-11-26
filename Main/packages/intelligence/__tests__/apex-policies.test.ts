import { describe, expect, it } from "vitest";
import { APEX_POLICY, FORBIDDEN_AGENT_ACTIONS, evaluatePolicy } from "../policies/apexPolicies";

describe("APEX policy table", () => {
  it("permits analysis and tool use, each requiring its controls", () => {
    expect(evaluatePolicy("analyze-local")).toEqual({ kind: "permitted", controls: [] });
    expect(evaluatePolicy("tool-use-analysis").kind).toBe("permitted");
    const active = evaluatePolicy("tool-use-active");
    expect(active.kind).toBe("permitted");
    if (active.kind === "permitted") expect(active.controls).toContain("human-approval");
  });

  it("forbids every action a specialist must never take on its own", () => {
    for (const action of ["execute-consequential-operation", "authorize-target", "expand-scope", "approve-own-action", "override-human-approval", "manufacture-trusted-evidence"] as const) {
      const rule = evaluatePolicy(action);
      expect(rule.kind).toBe("forbidden");
    }
    expect(FORBIDDEN_AGENT_ACTIONS.length).toBe(6);
  });

  it("treats unknown action names, non-strings, and prototype-pollution attempts as forbidden", () => {
    expect(evaluatePolicy("totally-made-up").kind).toBe("forbidden");
    expect(evaluatePolicy(123 as never).kind).toBe("forbidden");
    expect(evaluatePolicy("toString").kind).toBe("forbidden");
    expect(evaluatePolicy("constructor").kind).toBe("forbidden");
    expect(evaluatePolicy("hasOwnProperty").kind).toBe("forbidden");
  });

  it("returns defensive copies of control lists", () => {
    const rule = evaluatePolicy("tool-use-active");
    if (rule.kind === "permitted") {
      rule.controls.push("tampered" as never);
      const again = evaluatePolicy("tool-use-active");
      if (again.kind === "permitted") expect(again.controls).not.toContain("tampered");
    }
    expect(APEX_POLICY["tool-use-active"].kind).toBe("permitted");
  });
});
