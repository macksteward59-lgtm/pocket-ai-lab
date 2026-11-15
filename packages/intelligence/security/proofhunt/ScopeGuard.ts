/**
 * ProofHunt 1.1 operational scope gate.
 * Both program and operational authorization must be independently verified.
 * This module emits plans only; it never contacts targets or executes tools.
 */
import { isIP } from "node:net";
import { createHash } from "node:crypto";
import { evaluateTargetScope } from "../../bug-bounty/ScopeEvaluator";
import type { NormalizedProgramPolicy } from "../../bug-bounty/types";

export const PROOFHUNT_SAFE_CHECKS = Object.freeze([
  "static_analysis",
  "api_spec_review",
  "configuration_review",
  "dependency_review",
  "security_metadata_review"
] as const);

export type ProofHuntSafeCheck = typeof PROOFHUNT_SAFE_CHECKS[number];
export type ProofHuntEnvironment = "bounty" | "owned";
export type AuthorizationRecordKind = "bug_bounty_program" | "asset_ownership";

export interface ProgramAuthorizationRecord {
  readonly recordId: string;
  readonly kind: AuthorizationRecordKind;
  readonly subjectId: string;
  readonly evidenceReference: string;
  readonly sourceRevision: string;
  /** Human-reviewed intersection of methods the source/owner permits. */
  readonly permittedChecks: readonly string[];
  readonly permittedChecksReviewedBy: string;
  readonly permittedChecksReviewReference: string;
  /** Immutable normalized bounty scope snapshot; required for bounty assessments. */
  readonly scopePolicy?: NormalizedProgramPolicy;
  readonly scopePolicyHash?: string;
  readonly status: "verified" | "pending" | "revoked";
  readonly verifiedAt: string;
  readonly expiresAt: string;
}

export interface OperationalAuthorizationRecord {
  readonly recordId: string;
  readonly projectId: string;
  readonly environment: ProofHuntEnvironment;
  readonly programAuthorizationId: string;
  readonly policyVersion: string;
  /** SHA-256 of the exact immutable operational policy snapshot. */
  readonly policyHash: string;
  readonly status: "approved" | "pending" | "revoked";
  readonly approvedBy: string;
  readonly approvalReference: string;
  readonly signatureReference: string;
  readonly approvedAt: string;
  readonly expiresAt: string;
}

export interface ExplicitTarget {
  readonly hostname: string;
  readonly includeSubdomains?: boolean;
}

export interface ProofHuntAssessmentPolicy {
  readonly version: string;
  readonly preapproved: boolean;
  readonly allowedChecks: readonly string[];
  readonly maxRequestsPerSecond: number;
  readonly maxConcurrentJobs: number;
  readonly stopOnScopeViolation: true;
}

export interface ProofHuntAssessmentConfig {
  readonly projectId: string;
  readonly environment: ProofHuntEnvironment;
  readonly programAuthorization: ProgramAuthorizationRecord;
  readonly operationalAuthorization: OperationalAuthorizationRecord;
  readonly targets: readonly ExplicitTarget[];
  readonly excludedTargets: readonly ExplicitTarget[];
  readonly policy: ProofHuntAssessmentPolicy;
}

export interface ProgramEvidenceVerifier {
  verify(record: ProgramAuthorizationRecord): boolean | Promise<boolean>;
}

export interface OperationalApprovalVerifier {
  verify(record: OperationalAuthorizationRecord): boolean | Promise<boolean>;
}

export interface ScopeGuardAuditWriter {
  append(payload: Record<string, unknown>): Promise<unknown>;
}

export interface EmergencyStopProvider {
  isGlobalStopActive(): boolean | Promise<boolean>;
  isProjectStopActive(projectId: string): boolean | Promise<boolean>;
}

export interface ScopeGuardDecision {
  readonly decision: "approved_plan" | "denied";
  readonly permitted: boolean;
  readonly target: string;
  readonly hostname?: string;
  readonly check: string;
  readonly reason: string;
  readonly projectId: string;
  readonly programAuthorizationId?: string;
  readonly operationalAuthorizationId?: string;
  readonly policyVersion?: string;
  /** Digest of the full approved operational policy + target allowlist/exclusions. */
  readonly operationalPolicyHash?: string;
  /** Digest of the normalized published bounty scope snapshot, when applicable. */
  readonly programScopeHash?: string;
  readonly executionPerformed: false;
}

export interface ScopeGuardOptions {
  readonly programVerifier: ProgramEvidenceVerifier;
  readonly operationalVerifier: OperationalApprovalVerifier;
  readonly audit: ScopeGuardAuditWriter;
  readonly emergencyStop: EmergencyStopProvider;
  readonly now?: () => number;
}

export class ScopeGuardError extends Error {}

export class ScopeGuard {
  private readonly now: () => number;
  private auditTail: Promise<void> = Promise.resolve();

  constructor(private readonly options: ScopeGuardOptions) {
    if (!options.programVerifier || !options.operationalVerifier || !options.audit || !options.emergencyStop) {
      throw new ScopeGuardError("Independent verifiers and an audit writer are required");
    }
    this.now = options.now ?? (() => Date.now());
  }

  async authorizeAssessment(
    config: ProofHuntAssessmentConfig,
    target: string,
    check: string
  ): Promise<ScopeGuardDecision> {
    let hostname: string | undefined;
    let reason = "Assessment is not permitted";
    let permitted = false;
    let assessmentConfig: ProofHuntAssessmentConfig | undefined;

    try {
      // Snapshot before any asynchronous verification to prevent caller mutation
      // from changing the target list or policy while authorization is pending.
      assessmentConfig = structuredClone(config);
      validateConfig(assessmentConfig);
      if ((await this.options.emergencyStop.isGlobalStopActive()) ||
          (await this.options.emergencyStop.isProjectStopActive(assessmentConfig.projectId))) {
        throw new ScopeGuardError("Emergency stop is active; new assessment plans are disabled");
      }
      hostname = normalizeTargetHostname(target);

      const program = assessmentConfig.programAuthorization;
      const operational = assessmentConfig.operationalAuthorization;
      const policy = assessmentConfig.policy;

      if (program.kind !== (assessmentConfig.environment === "bounty" ? "bug_bounty_program" : "asset_ownership")) {
        throw new ScopeGuardError("Program authorization kind does not match the assessment environment");
      }
      if (program.status !== "verified" || !program.evidenceReference.trim() || !program.sourceRevision.trim()) {
        throw new ScopeGuardError("Program authorization evidence is not independently verified");
      }
      if (!isValidTimestamp(program.verifiedAt) || Date.parse(program.verifiedAt) > this.now() || isExpired(program.expiresAt, this.now())) {
        throw new ScopeGuardError("Program authorization is expired or has invalid timestamps");
      }
      if ((await this.options.programVerifier.verify(program)) !== true) {
        throw new ScopeGuardError("Program authorization evidence verification failed");
      }
      if (assessmentConfig.environment === "bounty") {
        const scopePolicy = program.scopePolicy;
        if (!scopePolicy || !program.scopePolicyHash ||
            scopePolicy.programId !== program.subjectId ||
            scopePolicy.sourceUrl !== program.evidenceReference ||
            scopePolicy.authorized !== false ||
            scopePolicy.reviewState !== "ready-for-human-review" ||
            hashNormalizedProgramPolicy(scopePolicy) !== program.scopePolicyHash) {
          throw new ScopeGuardError("Published bounty scope snapshot is missing, mismatched, incomplete, or has changed");
        }
        if (hasMatchingPathScopedRule(scopePolicy, hostname)) {
          throw new ScopeGuardError("Target has URL path-scoped program rules; this host-only ScopeGuard cannot safely resolve path scope");
        }
        // The normalized snapshot may have been reviewed before its effective
        // date or before its testing window. Re-check all temporal constraints
        // at decision time; reviewState is a historical parse result, not a clock.
        if (scopePolicy.effectiveAt !== undefined &&
            (!isValidTimestamp(scopePolicy.effectiveAt) || Date.parse(scopePolicy.effectiveAt) > this.now())) {
          throw new ScopeGuardError("Published program scope is not yet effective or has an invalid effective timestamp");
        }
        if (scopePolicy.expiresAt !== undefined && isExpired(scopePolicy.expiresAt, this.now())) {
          throw new ScopeGuardError("Published program scope snapshot has expired");
        }
        const testingWindow = scopePolicy.testingWindow;
        if (!testingWindow?.startsAt || !testingWindow.endsAt ||
            !isValidTimestamp(testingWindow.startsAt) || !isValidTimestamp(testingWindow.endsAt) ||
            Date.parse(testingWindow.endsAt) <= Date.parse(testingWindow.startsAt) ||
            this.now() < Date.parse(testingWindow.startsAt) ||
            this.now() >= Date.parse(testingWindow.endsAt)) {
          throw new ScopeGuardError("Published program testing window is not currently active or is invalid");
        }
        const programScope = evaluateTargetScope(scopePolicy, `https://${hostname}/`);
        if (programScope.disposition !== "in-scope") {
          throw new ScopeGuardError("Target is not explicitly in the verified published program scope: " + programScope.reason);
        }
        const publishedRateLimits = [
          scopePolicy.rateLimit?.requestsPerSecond,
          scopePolicy.rateLimit?.requestsPerMinute === undefined
            ? undefined
            : scopePolicy.rateLimit.requestsPerMinute / 60
        ].filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value > 0);
        if (publishedRateLimits.length === 0 ||
            policy.maxRequestsPerSecond > Math.min(...publishedRateLimits)) {
          throw new ScopeGuardError("Operational request rate exceeds or cannot be reconciled with the published program limit");
        }
      }

      if (operational.status !== "approved") {
        throw new ScopeGuardError("Operational authorization is not approved");
      }
      if (operational.projectId !== assessmentConfig.projectId ||
          operational.environment !== assessmentConfig.environment) {
        throw new ScopeGuardError("Operational authorization is bound to a different project or assessment environment");
      }
      if (operational.programAuthorizationId !== program.recordId) {
        throw new ScopeGuardError("Operational authorization references a different program authorization");
      }
      if (operational.policyVersion !== policy.version) {
        throw new ScopeGuardError("Operational authorization policy version does not match the active policy");
      }
      if (operational.policyHash !== hashOperationalAuthorizationSnapshot(
        assessmentConfig.projectId,
        assessmentConfig.environment,
        program.recordId,
        policy,
        assessmentConfig.targets,
        assessmentConfig.excludedTargets
      )) {
        throw new ScopeGuardError("Operational authorization digest does not match the complete policy and target-scope snapshot");
      }
      if (!operational.approvedBy.trim() || !operational.approvalReference.trim() || !operational.signatureReference.trim()) {
        throw new ScopeGuardError("Operational approval provenance is incomplete");
      }
      if (!isValidTimestamp(operational.approvedAt) || Date.parse(operational.approvedAt) > this.now() || isExpired(operational.expiresAt, this.now())) {
        throw new ScopeGuardError("Operational authorization is expired or has invalid timestamps");
      }
      if ((await this.options.operationalVerifier.verify(operational)) !== true) {
        throw new ScopeGuardError("Operational approval signature verification failed");
      }

      if (!policy.preapproved) throw new ScopeGuardError("Preapproved assessment policy is not enabled");
      if (!(PROOFHUNT_SAFE_CHECKS as readonly string[]).includes(check)) {
        throw new ScopeGuardError("Assessment type is not supported by the non-destructive implementation");
      }
      if (!program.permittedChecks.includes(check)) {
        throw new ScopeGuardError("Assessment type is not permitted by the independently reviewed program or ownership record");
      }
      if (!policy.allowedChecks.includes(check)) {
        throw new ScopeGuardError("Assessment type is not included in the approved policy");
      }
      if (matchesAny(hostname, assessmentConfig.excludedTargets)) {
        throw new ScopeGuardError("Target is explicitly excluded");
      }
      if (!matchesAny(hostname, assessmentConfig.targets)) {
        throw new ScopeGuardError("Target is not explicitly authorized");
      }

      permitted = true;
      reason = "Both authorization records, exact target scope, and preapproved check policy verified";
    } catch (error) {
      reason = error instanceof Error ? error.message : "Authorization could not be evaluated";
    }

    const decision: ScopeGuardDecision = Object.freeze({
      decision: permitted ? "approved_plan" : "denied",
      permitted,
      target,
      ...(hostname ? { hostname } : {}),
      check,
      reason,
      projectId: assessmentConfig?.projectId ?? "",
      ...(permitted ? {
        programAuthorizationId: assessmentConfig!.programAuthorization.recordId,
        operationalAuthorizationId: assessmentConfig!.operationalAuthorization.recordId,
        policyVersion: assessmentConfig!.policy.version,
        operationalPolicyHash: assessmentConfig!.operationalAuthorization.policyHash,
        ...(assessmentConfig!.programAuthorization.scopePolicyHash
          ? { programScopeHash: assessmentConfig!.programAuthorization.scopePolicyHash }
          : {})
      } : {}),
      executionPerformed: false
    });

    try {
      await this.appendAudit({
        event: "proofhunt.scope_decision",
        at: new Date(this.now()).toISOString(),
        projectId: decision.projectId,
        target: decision.target,
        hostname: decision.hostname ?? null,
        check: decision.check,
        decision: decision.decision,
        permitted: decision.permitted,
        reason: decision.reason,
        programAuthorizationId: assessmentConfig?.programAuthorization?.recordId ?? null,
        operationalAuthorizationId: assessmentConfig?.operationalAuthorization?.recordId ?? null,
        policyVersion: assessmentConfig?.policy?.version ?? null,
        operationalPolicyHash: assessmentConfig?.operationalAuthorization?.policyHash ?? null,
        programScopeHash: assessmentConfig?.programAuthorization?.scopePolicyHash ?? null,
        executionPerformed: false
      });
    } catch {
      return Object.freeze({
        decision: "denied",
        permitted: false,
        target,
        ...(hostname ? { hostname } : {}),
        check,
        reason: "Audit persistence failed; assessment plan denied",
        projectId: assessmentConfig?.projectId ?? "",
        executionPerformed: false
      });
    }
    return decision;
  }

  /** Serialize writes through this ScopeGuard instance; production multi-process
   * deployments must use a transactional database writer, not the JSONL ledger.
   */
  private async appendAudit(payload: Record<string, unknown>): Promise<void> {
    const previous = this.auditTail;
    let release!: () => void;
    this.auditTail = new Promise<void>(resolve => { release = resolve; });
    await previous;
    try {
      await this.options.audit.append(payload);
    } finally {
      release();
    }
  }
}

export function hashNormalizedProgramPolicy(policy: NormalizedProgramPolicy): string {
  return createHash("sha256").update(canonicalize(policy)).digest("hex");
}

/**
 * Binds the approval to every operationally mutable scope control, not just
 * the check/rate policy. Otherwise a caller could broaden an owned-asset
 * allowlist or remove an exclusion without invalidating the signed approval.
 */
export function hashOperationalAuthorizationSnapshot(
  projectId: string,
  environment: ProofHuntEnvironment,
  programAuthorizationId: string,
  policy: ProofHuntAssessmentPolicy,
  targets: readonly ExplicitTarget[],
  excludedTargets: readonly ExplicitTarget[]
): string {
  const normalizeEntries = (entries: readonly ExplicitTarget[]) => entries
    .map(entry => ({
      hostname: normalizeTargetHostname(entry.hostname),
      includeSubdomains: entry.includeSubdomains === true
    }))
    .sort((a, b) => (a.hostname < b.hostname ? -1 : a.hostname > b.hostname ? 1 : 0) ||
      Number(a.includeSubdomains) - Number(b.includeSubdomains));
  return createHash("sha256").update(canonicalize({
    projectId,
    environment,
    programAuthorizationId,
    policy,
    targets: normalizeEntries(targets),
    excludedTargets: normalizeEntries(excludedTargets)
  })).digest("hex");
}

export function normalizeTargetHostname(value: string): string {
  if (typeof value !== "string" || !value.trim()) throw new ScopeGuardError("Target is required");
  const raw = value.trim();
  if (raw.includes("*") || (raw.includes("/") && !/^https?:\/\//i.test(raw))) {
    throw new ScopeGuardError("Wildcards, CIDRs, and path-like target values are not accepted");
  }
  const authority = raw.match(/^(?:https?:\/\/)?([^/?#]+)/i)?.[1];
  if (authority) {
    const hostPort = authority.split("@").pop() ?? authority;
    const hasExplicitPort = hostPort.startsWith("[")
      ? hostPort.slice(hostPort.indexOf("]") + 1).startsWith(":")
      : hostPort.includes(":");
    if (hasExplicitPort) {
      throw new ScopeGuardError("Scope authorization accepts host-only targets, not explicit ports");
    }
  }
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : "https://" + raw);
  } catch {
    throw new ScopeGuardError("Target format is invalid");
  }
  if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password) {
    throw new ScopeGuardError("Only credential-free HTTP(S) target identifiers are accepted");
  }
  if (url.port || (url.pathname !== "/" && url.pathname !== "") || url.search || url.hash) {
    throw new ScopeGuardError("Scope authorization accepts host-only targets, not ports, paths, queries, or fragments");
  }
  const hostname = url.hostname.replace(/^\[|\]$/g, "").replace(/\.$/, "").toLowerCase();
  if (!hostname || hostname.includes("*")) throw new ScopeGuardError("Target hostname is invalid");
  if (isIP(hostname) === 0 && (!hostname.includes(".") || hostname.split(".").some(label =>
    !label || label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)
  ))) {
    throw new ScopeGuardError("Target must be a valid fully-qualified hostname or exact IP address");
  }
  return hostname;
}

function validateConfig(config: ProofHuntAssessmentConfig): void {
  if (!config || !config.projectId?.trim()) throw new ScopeGuardError("Project id is required");
  if (config.environment !== "bounty" && config.environment !== "owned") throw new ScopeGuardError("Assessment environment is unsupported");
  const program = config.programAuthorization;
  const operational = config.operationalAuthorization;
  if (!program?.recordId?.trim() || !program.subjectId?.trim() || !program.evidenceReference?.trim() ||
      !program.sourceRevision?.trim() || !program.verifiedAt?.trim() || !program.expiresAt?.trim() ||
      !Array.isArray(program.permittedChecks) || !program.permittedChecksReviewedBy?.trim() ||
      !program.permittedChecksReviewReference?.trim()) {
    throw new ScopeGuardError("Program authorization record is incomplete");
  }
  if (!operational?.recordId?.trim() || !operational.policyVersion?.trim() || !operational.policyHash?.trim() ||
      !operational.approvedBy?.trim() || !operational.approvalReference?.trim() ||
      !operational.signatureReference?.trim() || !operational.approvedAt?.trim() || !operational.expiresAt?.trim()) {
    throw new ScopeGuardError("Operational authorization record is incomplete");
  }
  if (!config.targets?.length) throw new ScopeGuardError("At least one explicit target is required");
  if (!Array.isArray(config.excludedTargets)) throw new ScopeGuardError("Excluded targets must be an explicit list");
  if (!config.policy?.version?.trim() || !Array.isArray(config.policy.allowedChecks)) throw new ScopeGuardError("Assessment policy is incomplete");
  if (!Number.isInteger(config.policy.maxConcurrentJobs) || config.policy.maxConcurrentJobs < 1 ||
      !Number.isFinite(config.policy.maxRequestsPerSecond) || config.policy.maxRequestsPerSecond <= 0) {
    throw new ScopeGuardError("Assessment rate and concurrency limits must be positive");
  }
  if (config.policy.stopOnScopeViolation !== true) throw new ScopeGuardError("Stop-on-scope-violation must remain enabled");
  for (const item of [...config.targets, ...config.excludedTargets]) {
    normalizeTargetHostname(item.hostname);
    if (item.includeSubdomains !== undefined && typeof item.includeSubdomains !== "boolean") {
      throw new ScopeGuardError("Subdomain scope flag must be boolean");
    }
  }
}

function matchesAny(hostname: string, entries: readonly ExplicitTarget[]): boolean {
  return entries.some(entry => {
    const candidate = normalizeTargetHostname(entry.hostname);
    return hostname === candidate || (entry.includeSubdomains === true && hostname.endsWith("." + candidate));
  });
}

function hasMatchingPathScopedRule(policy: NormalizedProgramPolicy, hostname: string): boolean {
  return [...policy.inScope, ...policy.outOfScope].some(rule => {
    if (rule.kind !== "url") return false;
    const url = new URL(rule.value);
    if (url.pathname === "/") return false;
    const scopedHost = url.hostname.toLowerCase().replace(/\.$/, "");
    return hostname === scopedHost || (rule.includeSubdomains && hostname.endsWith("." + scopedHost));
  });
}

function canonicalize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).filter(key => record[key] !== undefined).sort()
      .map(key => `${JSON.stringify(key)}:${canonicalize(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function isValidTimestamp(value: string): boolean {
  return Number.isFinite(Date.parse(value)) && /(?:Z|[+-]\d{2}:?\d{2})$/i.test(value);
}

function isExpired(value: string, now: number): boolean {
  return !isValidTimestamp(value) || Date.parse(value) <= now;
}
