import {
  BountyPlatform,
  NormalizedProgramPolicy,
  NormalizedScopeRule,
  ProgramPolicyCandidate,
  ScopeRuleInput
} from "./types";

const PLATFORMS: readonly BountyPlatform[] = ["hackerone", "bugcrowd", "intigriti", "manual"];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/;

export class ProgramPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProgramPolicyError";
  }
}

/**
 * Deterministically validates already-extracted policy fields.
 * It deliberately does not claim to understand arbitrary policy prose.
 * Missing, ambiguous, or unsupported fields remain non-executable.
 */
export function normalizeProgramPolicy(
  candidate: ProgramPolicyCandidate,
  now: Date = new Date()
): NormalizedProgramPolicy {
  if (!candidate || typeof candidate !== "object") {
    throw new ProgramPolicyError("Program policy candidate is required");
  }

  const programId = requiredText(candidate.programId, "programId");
  const programName = requiredText(candidate.programName, "programName");
  if (!PLATFORMS.includes(candidate.platform)) {
    throw new ProgramPolicyError("Unsupported bounty platform");
  }

  const sourceUrl = normalizeSourceUrl(candidate.sourceUrl);
  const retrievedAt = validDate(candidate.retrievedAt, "retrievedAt");
  const effectiveAt = candidate.effectiveAt
    ? validDate(candidate.effectiveAt, "effectiveAt")
    : undefined;
  const expiresAt = candidate.expiresAt
    ? validDate(candidate.expiresAt, "expiresAt")
    : undefined;

  const inScopeInput = candidate.scope?.inScope;
  const outOfScopeInput = candidate.scope?.outOfScope;
  if (!Array.isArray(inScopeInput) || !Array.isArray(outOfScopeInput)) {
    throw new ProgramPolicyError("Both inScope and outOfScope must be explicit arrays");
  }

  const inScope = inScopeInput.map(normalizeScopeRule);
  const outOfScope = outOfScopeInput.map(normalizeScopeRule);
  const allowedActivities = normalizeTextList(candidate.allowedActivities, "allowedActivities");
  const prohibitedActivities = normalizeTextList(candidate.prohibitedActivities, "prohibitedActivities");
  const vulnerabilityExclusions = normalizeTextList(candidate.vulnerabilityExclusions, "vulnerabilityExclusions");
  const disclosureRules = normalizeTextList(candidate.disclosureRules ?? [], "disclosureRules");

  const reviewReasons: string[] = [];
  if (inScope.length === 0) reviewReasons.push("No in-scope assets were explicitly identified");
  if (allowedActivities.length === 0) reviewReasons.push("Allowed testing activities are not explicit");
  if (prohibitedActivities.length === 0) reviewReasons.push("Prohibited activities are not explicit");
  if (vulnerabilityExclusions.length === 0) reviewReasons.push("Vulnerability exclusions are not explicit");
  if (!candidate.rateLimit ||
      (!isPositiveFinite(candidate.rateLimit.requestsPerSecond) &&
       !isPositiveFinite(candidate.rateLimit.requestsPerMinute))) {
    reviewReasons.push("A request-rate limit is not explicit");
  }
  if (!candidate.testingWindow?.startsAt || !candidate.testingWindow?.endsAt) {
    reviewReasons.push("Testing window is not explicit");
  } else {
    validDate(candidate.testingWindow.startsAt, "testingWindow.startsAt");
    validDate(candidate.testingWindow.endsAt, "testingWindow.endsAt");
    if (Date.parse(candidate.testingWindow.endsAt) <= Date.parse(candidate.testingWindow.startsAt)) {
      reviewReasons.push("Testing window is contradictory");
    }
  }

  const nowMs = now.getTime();
  if (!Number.isFinite(nowMs)) throw new ProgramPolicyError("Current time is invalid");
  if (expiresAt && Date.parse(expiresAt) <= nowMs) {
    reviewReasons.push("Program policy has expired");
  }
  if (effectiveAt && Date.parse(effectiveAt) > nowMs) {
    reviewReasons.push("Program policy is not yet effective");
  }

  const unsupportedScope = [...inScope, ...outOfScope]
    .some(rule => rule.kind === "ip" || rule.kind === "cidr" ||
      rule.kind === "mobile_app" || rule.kind === "source_code");
  if (unsupportedScope) {
    reviewReasons.push("One or more asset types require a dedicated scope evaluator");
  }

  const expired = Boolean(expiresAt && Date.parse(expiresAt) <= nowMs);
  const notYetEffective = Boolean(effectiveAt && Date.parse(effectiveAt) > nowMs);
  const contradictoryWindow = reviewReasons.includes("Testing window is contradictory");
  const reviewState = expired || notYetEffective || contradictoryWindow
    ? "blocked"
    : reviewReasons.length === 0
      ? "ready-for-human-review"
      : "needs-review";

  return Object.freeze({
    programId,
    programName,
    platform: candidate.platform,
    sourceUrl,
    retrievedAt,
    ...(effectiveAt ? { effectiveAt } : {}),
    ...(expiresAt ? { expiresAt } : {}),
    inScope: Object.freeze(inScope),
    outOfScope: Object.freeze(outOfScope),
    allowedActivities: Object.freeze(allowedActivities),
    prohibitedActivities: Object.freeze(prohibitedActivities),
    vulnerabilityExclusions: Object.freeze(vulnerabilityExclusions),
    ...(candidate.rateLimit ? { rateLimit: Object.freeze({ ...candidate.rateLimit }) } : {}),
    ...(candidate.testingWindow ? { testingWindow: Object.freeze({ ...candidate.testingWindow }) } : {}),
    disclosureRules: Object.freeze(disclosureRules),
    reviewState,
    reviewReasons: Object.freeze(reviewReasons),
    authorized: false as const
  });
}

function normalizeScopeRule(input: ScopeRuleInput): NormalizedScopeRule {
  if (!input || typeof input !== "object") throw new ProgramPolicyError("Scope rule is malformed");
  const value = requiredText(input.value, "scope rule value");
  const kind = input.kind;
  if (!["domain", "url", "ip", "cidr", "mobile_app", "source_code"].includes(kind)) {
    throw new ProgramPolicyError("Unsupported scope asset kind");
  }

  let normalized = value.trim();
  let includeSubdomains = input.includeSubdomains === true;
  if (kind === "domain") {
    if (normalized.includes("://") || normalized.includes("/") || normalized.includes(":")) {
      throw new ProgramPolicyError("Domain scope must contain a hostname only");
    }
    if (normalized.startsWith("*.")) {
      normalized = normalized.slice(2);
      includeSubdomains = true;
    }
    normalized = normalized.toLowerCase().replace(/\.$/, "");
    if (!/^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(normalized)) {
      throw new ProgramPolicyError("Domain scope hostname is invalid");
    }
  } else if (kind === "url") {
    let url: URL;
    try { url = new URL(normalized); } catch { throw new ProgramPolicyError("URL scope is invalid"); }
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      throw new ProgramPolicyError("URL scope must use HTTP or HTTPS");
    }
    if (url.username || url.password || url.search || url.hash) {
      throw new ProgramPolicyError("URL scope cannot contain credentials, query, or fragment");
    }
    normalized = url.origin + normalizePath(url.pathname);
  }

  return Object.freeze({
    kind,
    value: normalized,
    includeSubdomains,
    ...(typeof input.note === "string" && input.note.trim() ? { note: input.note.trim() } : {})
  });
}

function normalizeSourceUrl(value: string): string {
  let url: URL;
  try { url = new URL(requiredText(value, "sourceUrl")); }
  catch { throw new ProgramPolicyError("sourceUrl must be a valid HTTPS URL"); }
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new ProgramPolicyError("sourceUrl must be HTTPS and cannot contain credentials");
  }
  return url.toString();
}

function validDate(value: string, name: string): string {
  if (typeof value !== "string" || !ISO_DATE.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new ProgramPolicyError(name + " must be an explicit ISO-8601 timestamp with timezone");
  }
  return new Date(value).toISOString();
}

function requiredText(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim()) throw new ProgramPolicyError(name + " is required");
  return value.trim();
}

function normalizeTextList(value: unknown, name: string): string[] {
  if (!Array.isArray(value)) throw new ProgramPolicyError(name + " must be an array");
  return [...new Set(value.map((item: unknown) => requiredText(item, name)))];
}

function isPositiveFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function normalizePath(path: string): string {
  if (path === "/") return "/";
  return path.replace(/\/+$/, "") || "/";
}
