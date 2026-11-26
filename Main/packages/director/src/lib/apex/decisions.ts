export type GateDecision = "pending" | "approved" | "rejected";

export type Decisions = {
  rule: GateDecision;
  patch: GateDecision;
  release: GateDecision;
};

export const OPEN_DECISIONS: Decisions = { rule: "pending", patch: "pending", release: "pending" };
