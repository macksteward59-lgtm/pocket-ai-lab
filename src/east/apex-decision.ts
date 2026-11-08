/**
 * Read-only acceptance of the existing APEX decision constant.
 *
 * The only decision East may surface is `OPEN_DECISIONS` while every gate
 * is still `pending`. This file does not verify signatures, issue receipts,
 * persist a decision, consult the trust placeholder, or grant authorization.
 * Any other shape, including an `authorized` field or a `signature` field,
 * is rejected.
 */

import { createHash } from "node:crypto";
import { OPEN_DECISIONS } from "../../packages/director/src/lib/apex/decisions";

/** A decision older than this is a replay, not a live read. */
export const APEX_DECISION_MAX_AGE_MS = 5_000;

/** How far an issuedAt timestamp may sit ahead of East's clock. */
export const APEX_DECISION_FUTURE_SKEW_MS = 1_000;

export type EastApexCloseReason =
  | "missing"
  | "malformed"
  | "forged"
  | "shape_mismatch"
  | "stale"
  | "unreachable"
  | "timeout";

export type EastApexDecision =
  | { readonly status: "unread" }
  | {
      readonly status: "pending";
      readonly rule: "pending";
      readonly patch: "pending";
      readonly release: "pending";
      readonly proposalDigest: string;
      readonly trust: "unavailable";
    }
  | {
      readonly status: "closed";
      readonly reason: EastApexCloseReason;
      readonly proposalDigest: string;
    };

export interface ApexProposal {
  taskId: string;
  objective: string;
  synthesis: string;
  evidenceRefs: readonly string[];
}

const DECISION_KEYS = new Set(["rule", "patch", "release", "issuedAt", "decisionId"]);

/** Copy of the live constant. Callers cannot replace the module's source. */
export function liveApexDecision(): { rule: string; patch: string; release: string } {
  return {
    rule: OPEN_DECISIONS.rule,
    patch: OPEN_DECISIONS.patch,
    release: OPEN_DECISIONS.release
  };
}

export function proposalDigest(proposal: ApexProposal): string {
  const canonical = JSON.stringify({
    evidenceRefs: [...proposal.evidenceRefs].sort(),
    objective: proposal.objective,
    synthesis: proposal.synthesis,
    taskId: proposal.taskId
  });
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

/**
 * Accepts only the three pending gates. `issuedAt` and `decisionId` are
 * freshness bindings. They are not approval fields. A repeated decision id
 * or an old timestamp is stale. Every other key, including `signature` and
 * `authorized`, closes the read.
 */
export function acceptApexDecision(
  value: unknown,
  binding: { now: number; seenDecisionIds: ReadonlySet<string> }
): { ok: true; decisionId: string | null } | { ok: false; reason: EastApexCloseReason } {
  if (value === undefined || value === null) return { ok: false, reason: "missing" };
  if (typeof value !== "object" || Array.isArray(value)) return { ok: false, reason: "malformed" };

  const record = value as Record<string, unknown>;
  if ("authorized" in record) return { ok: false, reason: "forged" };

  const keys = Object.keys(record);
  if (keys.some(key => !DECISION_KEYS.has(key))) return { ok: false, reason: "shape_mismatch" };
  if (!("rule" in record) || !("patch" in record) || !("release" in record)) {
    return { ok: false, reason: "malformed" };
  }

  const gates = [record.rule, record.patch, record.release];
  if (gates.some(gate => typeof gate !== "string")) return { ok: false, reason: "malformed" };
  if (gates.some(gate => gate !== "pending")) return { ok: false, reason: "forged" };

  let decisionId: string | null = null;
  if ("decisionId" in record) {
    if (typeof record.decisionId !== "string" || record.decisionId.trim().length === 0) {
      return { ok: false, reason: "malformed" };
    }
    if (binding.seenDecisionIds.has(record.decisionId)) return { ok: false, reason: "stale" };
    decisionId = record.decisionId;
  }

  if ("issuedAt" in record) {
    if (typeof record.issuedAt !== "string") return { ok: false, reason: "malformed" };
    const issued = Date.parse(record.issuedAt);
    if (!Number.isFinite(issued)) return { ok: false, reason: "malformed" };
    if (issued > binding.now + APEX_DECISION_FUTURE_SKEW_MS) return { ok: false, reason: "stale" };
    if (binding.now - issued > APEX_DECISION_MAX_AGE_MS) return { ok: false, reason: "stale" };
  }

  return { ok: true, decisionId };
}
