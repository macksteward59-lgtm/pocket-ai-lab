import {
  ActionDecision,
  NormalizedProgramPolicy,
  ProgramAction,
  ScopeEvaluation,
  NormalizedScopeRule
} from "./types";

/**
 * Compares a proposed URL with explicitly normalized domain/URL rules.
 * Unsupported asset kinds return indeterminate rather than being guessed.
 * Exclusions always override inclusions.
 */
export function evaluateTargetScope(
  policy: NormalizedProgramPolicy,
  target: string
): ScopeEvaluation {
  if (policy.reviewState !== "ready-for-human-review") {
    return result(target, "indeterminate", "Program policy is incomplete, expired, or otherwise blocked from scope review");
  }
  let url: URL;
  try { url = new URL(target); }
  catch {
    return result(target, "indeterminate", "Target is not a valid absolute URL");
  }
  if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password) {
    return result(target, "indeterminate", "Only credential-free HTTP(S) targets can be evaluated");
  }

  const excluded = policy.outOfScope.find(rule => matches(rule, url));
  if (excluded) {
    return result(target, "out-of-scope", "An explicit out-of-scope rule takes precedence", excluded);
  }

  const included = policy.inScope.find(rule => matches(rule, url));
  if (included) {
    return result(target, "in-scope", "Target matches a published in-scope rule; this is not execution authorization", included);
  }

  const unsupported = [...policy.inScope, ...policy.outOfScope]
    .some(rule => rule.kind === "ip" || rule.kind === "cidr" ||
      rule.kind === "mobile_app" || rule.kind === "source_code");
  return result(
    target,
    unsupported ? "indeterminate" : "out-of-scope",
    unsupported
      ? "Policy contains asset types this evaluator cannot safely resolve"
      : "No explicit in-scope rule matches this target"
  );
}

function matches(rule: NormalizedScopeRule, target: URL): boolean {
  if (rule.kind === "domain") {
    const host = target.hostname.toLowerCase();
    const domain = rule.value.toLowerCase();
    return (rule.includeApex && host === domain) || (rule.includeSubdomains && host.endsWith("." + domain));
  }
  if (rule.kind === "url") {
    const scoped = new URL(rule.value);
    if (target.origin !== scoped.origin) return false;
    const basePath = scoped.pathname === "/" ? "/" : scoped.pathname.replace(/\/$/, "");
    return basePath === "/" || target.pathname === basePath || target.pathname.startsWith(basePath + "/");
  }
  return false;
}

function result(
  target: string,
  disposition: ScopeEvaluation["disposition"],
  reason: string,
  matchedRule?: NormalizedScopeRule
): ScopeEvaluation {
  return Object.freeze({
    target,
    disposition,
    reason,
    ...(matchedRule ? { matchedRule } : {}),
    authorized: false as const
  });
}

/**
 * This initial module has no execution adapter or approval verifier.
 * Therefore every action remains denied, including actions on in-scope assets.
 */
export function evaluateProgramAction(action: ProgramAction): ActionDecision {
  return Object.freeze({
    action,
    allowed: false as const,
    authorized: false as const,
    reason: "No independent authorization verifier and approved execution adapter are configured"
  });
}
