/**
 * APEX policy mappings for agent actions.
 *
 * Declarative and fail-closed. The specialists may research and analyze, but
 * this table does not execute anything and does not set `authorized`.
 * Consequential execution, authorizing a target, expanding scope, self-approval,
 * overriding a human, and manufacturing trusted evidence are forbidden.
 * Unknown action names are forbidden. This is not an APEX trust contract.
 */
export type PolicyControl = "delegation-voucher" | "scope-reference" | "human-approval";

export type AgentAction =
  | "analyze-local"
  | "tool-use-analysis"
  | "tool-use-active"
  | "execute-consequential-operation"
  | "authorize-target"
  | "expand-scope"
  | "approve-own-action"
  | "override-human-approval"
  | "manufacture-trusted-evidence";

export type PolicyRule =
  | { kind: "permitted"; controls: PolicyControl[] }
  | { kind: "forbidden"; reason: string };

const FORBIDDEN = (reason: string): PolicyRule => ({ kind: "forbidden", reason });

export const APEX_POLICY: Record<AgentAction, PolicyRule> = {
  "analyze-local": { kind: "permitted", controls: [] },
  "tool-use-analysis": { kind: "permitted", controls: ["delegation-voucher", "scope-reference"] },
  "tool-use-active": { kind: "permitted", controls: ["delegation-voucher", "scope-reference", "human-approval"] },
  "execute-consequential-operation": FORBIDDEN("This layer does not execute consequential operations"),
  "authorize-target": FORBIDDEN("Agents cannot authorize a target; only a human via APEX can"),
  "expand-scope": FORBIDDEN("Agents cannot expand testing scope"),
  "approve-own-action": FORBIDDEN("An agent cannot approve its own action"),
  "override-human-approval": FORBIDDEN("Agents cannot override human approval"),
  "manufacture-trusted-evidence": FORBIDDEN("Agents cannot manufacture trusted evidence")
};

export const FORBIDDEN_AGENT_ACTIONS: AgentAction[] = (Object.keys(APEX_POLICY) as AgentAction[])
  .filter(action => APEX_POLICY[action].kind === "forbidden");

/** Looks up an action. Anything not in the table, including prototype keys, is forbidden. */
export function evaluatePolicy(action: string): PolicyRule {
  if (typeof action !== "string" || !Object.prototype.hasOwnProperty.call(APEX_POLICY, action)) {
    return FORBIDDEN("Unknown action class (fail closed)");
  }
  const rule = APEX_POLICY[action as AgentAction];
  return rule.kind === "permitted" ? { kind: "permitted", controls: [...rule.controls] } : { ...rule };
}
