import { describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { AuditLedger } from "../security/AuditLedger";
import { normalizeProgramPolicy } from "../bug-bounty";
import { hashAssessmentPolicy, hashAssessmentScope, hashNormalizedProgramPolicy } from "../security/proofhunt";
import {
  ScopeGuard,
  normalizeTargetHostname,
  type ProofHuntAssessmentConfig,
  type ScopeGuardAuditWriter
} from "../security/proofhunt";

function makeConfig(overrides: Partial<ProofHuntAssessmentConfig> = {}): ProofHuntAssessmentConfig {
  const scopePolicy = normalizeProgramPolicy({
    programId: "program-demo",
    programName: "ProofHunt demo program",
    platform: "manual",
    sourceUrl: "https://bounty.example/program/rules",
    retrievedAt: "2026-11-15T12:00:00Z",
    effectiveAt: "2026-11-01T00:00:00Z",
    expiresAt: "2027-01-01T00:00:00Z",
    scope: {
      inScope: [{ kind: "domain", value: "*.example.com" }],
      outOfScope: [{ kind: "domain", value: "admin.example.com" }]
    },
    allowedActivities: ["static analysis", "API specification review"],
    prohibitedActivities: ["intrusive testing", "denial of service"],
    vulnerabilityExclusions: ["self-XSS without impact"],
    rateLimit: { requestsPerSecond: 1 },
    testingWindow: { startsAt: "2026-11-01T00:00:00Z", endsAt: "2027-01-01T00:00:00Z", timezone: "UTC" }
  }, new Date("2026-11-15T12:00:00Z"));
  const assessmentPolicy = {
    version: "policy-1",
    preapproved: true,
    allowedChecks: ["static_analysis", "api_spec_review", "configuration_review", "dependency_review", "security_metadata_review"],
    maxRequestsPerSecond: 1,
    maxConcurrentJobs: 1,
    stopOnScopeViolation: true as const
  };
  const targets = overrides.targets ?? [{ hostname: "app.example.com" }, { hostname: "api.example.com" }];
  const excludedTargets = overrides.excludedTargets ?? [{ hostname: "admin.example.com" }];
  return {
    projectId: "proofhunt-demo",
    environment: "bounty",
    programAuthorization: {
      recordId: "PROGRAM-1",
      kind: "bug_bounty_program",
      subjectId: "program-demo",
      evidenceReference: "https://bounty.example/program/rules",
      sourceRevision: "sha256:program-rules-revision-1",
      permittedChecks: ["static_analysis", "api_spec_review", "configuration_review", "dependency_review", "security_metadata_review"],
      permittedChecksReviewedBy: "human-reviewer",
      permittedChecksReviewReference: "review://proofhunt-demo/checks/1",
      scopePolicy,
      scopePolicyHash: hashNormalizedProgramPolicy(scopePolicy),
      status: "verified",
      verifiedAt: "2026-11-15T12:00:00Z",
      expiresAt: "2027-01-01T00:00:00Z"
    },
    operationalAuthorization: {
      recordId: "OPS-1",
      programAuthorizationId: "PROGRAM-1",
      policyVersion: "policy-1",
      policyHash: hashAssessmentPolicy(assessmentPolicy),
      targetScopeHash: hashAssessmentScope(targets, excludedTargets),
      status: "approved",
      approvedBy: "human-reviewer",
      approvalReference: "approval://proofhunt-demo/1",
      signatureReference: "signature://proofhunt-demo/1",
      approvedAt: "2026-11-15T12:01:00Z",
      expiresAt: "2026-12-01T00:00:00Z"
    },
    targets,
    excludedTargets,
    policy: assessmentPolicy,
    ...overrides
  };
}

function makeGuard(options: {
  program?: () => boolean | Promise<boolean>;
  operational?: () => boolean | Promise<boolean>;
  audit?: ScopeGuardAuditWriter;
  globalStop?: boolean;
  projectStop?: boolean;
  now?: number;
} = {}) {
  const audit = options.audit ?? { append: vi.fn(async () => undefined) };
  const guard = new ScopeGuard({
    programVerifier: { verify: options.program ?? (() => true) },
    operationalVerifier: { verify: options.operational ?? (() => true) },
    audit,
    emergencyStop: {
      isGlobalStopActive: () => options.globalStop ?? false,
      isProjectStopActive: () => options.projectStop ?? false
    },
    now: () => options.now ?? Date.parse("2026-11-15T12:02:00Z")
  });
  return { guard, audit };
}

describe("ProofHunt PostgreSQL migration contract", () => {
  it("binds policy rows to the exact operational approval and its parent program", async () => {
    const sql = await readFile(resolve(process.cwd(), "packages/intelligence/security/proofhunt/migrations/001_proofhunt_scopeguard.sql"), "utf8");
    expect(sql).toContain("UNIQUE (project_id, record_id, parent_program_authorization_id)");
    expect(sql).toContain("FOREIGN KEY (project_id, operational_authorization_id, program_authorization_id)");
    expect(sql).toContain("REFERENCES proofhunt.authorization_records(project_id, record_id, parent_program_authorization_id)");
    expect(sql).toContain("AND target_scope_hash IS NOT NULL");
  });

  it("keeps project RLS forced and historical tables append-only", async () => {
    const sql = await readFile(resolve(process.cwd(), "packages/intelligence/security/proofhunt/migrations/001_proofhunt_scopeguard.sql"), "utf8");
    expect(sql).toContain("ENABLE ROW LEVEL SECURITY");
    expect(sql).toContain("FORCE ROW LEVEL SECURITY");
    expect(sql).toContain("BEFORE UPDATE OR DELETE");
    expect(sql).toContain("proofhunt.audit_events");
  });
});

describe("ProofHunt ScopeGuard", () => {
  it("produces a plan for an exact target and preapproved non-destructive check", async () => {
    const { guard, audit } = makeGuard();
    const result = await guard.authorizeAssessment(makeConfig(), "https://app.example.com", "static_analysis");
    expect(result).toMatchObject({
      decision: "approved_plan",
      permitted: true,
      hostname: "app.example.com",
      executionPerformed: false,
      programAuthorizationId: "PROGRAM-1",
      operationalAuthorizationId: "OPS-1",
      policyVersion: "policy-1"
    });
    expect(audit.append).toHaveBeenCalledOnce();
  });

  it("denies an unknown hostname and a subdomain not explicitly included", async () => {
    const { guard } = makeGuard();
    expect((await guard.authorizeAssessment(makeConfig(), "other.example.com", "static_analysis")).permitted).toBe(false);
    expect((await guard.authorizeAssessment(makeConfig(), "v2.app.example.com", "static_analysis")).permitted).toBe(false);
  });

  it("allows subdomains only when the exact base target opts in", async () => {
    const { guard } = makeGuard();
    const config = makeConfig({ targets: [{ hostname: "example.com", includeSubdomains: true }] });
    expect((await guard.authorizeAssessment(config, "api.example.com", "static_analysis")).permitted).toBe(true);
  });

  it("gives operational exclusions precedence over matching inclusions", async () => {
    const base = makeConfig();
    const scopePolicy = { ...base.programAuthorization.scopePolicy!, outOfScope: [] };
    const config = makeConfig({
      targets: [{ hostname: "example.com", includeSubdomains: true }],
      excludedTargets: [{ hostname: "admin.example.com", includeSubdomains: true }],
      programAuthorization: {
        ...base.programAuthorization,
        scopePolicy,
        scopePolicyHash: hashNormalizedProgramPolicy(scopePolicy)
      }
    });
    const { guard } = makeGuard();
    const result = await guard.authorizeAssessment(config, "admin.example.com", "static_analysis");
    expect(result.permitted).toBe(false);
    expect(result.reason).toContain("Target is explicitly excluded");
  });

  it("requires both independent authorization verifiers", async () => {
    const program = makeGuard({ program: () => false });
    const operational = makeGuard({ operational: () => false });
    expect((await program.guard.authorizeAssessment(makeConfig(), "app.example.com", "static_analysis")).permitted).toBe(false);
    expect((await operational.guard.authorizeAssessment(makeConfig(), "app.example.com", "static_analysis")).permitted).toBe(false);
  });

  it("denies an operational record bound to a different program authorization", async () => {
    const base = makeConfig();
    const config = makeConfig({
      operationalAuthorization: { ...base.operationalAuthorization, programAuthorizationId: "OTHER-PROGRAM" }
    });
    const { guard } = makeGuard();
    expect((await guard.authorizeAssessment(config, "app.example.com", "static_analysis")).permitted).toBe(false);
  });

  it("denies policy version drift and checks outside the approved allowlist", async () => {
    const base = makeConfig();
    const drift = makeConfig({ policy: { ...base.policy, version: "policy-2" } });
    const { guard } = makeGuard();
    expect((await guard.authorizeAssessment(makeConfig(), "app.example.com", "active_test")).permitted).toBe(false);
    expect((await guard.authorizeAssessment(drift, "app.example.com", "static_analysis")).permitted).toBe(false);
  });

  it("denies expired program and operational authorizations", async () => {
    const base = makeConfig();
    const expiredProgram = makeConfig({
      programAuthorization: { ...base.programAuthorization, expiresAt: "2026-11-15T12:01:00Z" }
    });
    const expiredOperational = makeConfig({
      operationalAuthorization: { ...base.operationalAuthorization, expiresAt: "2026-11-15T12:01:00Z" }
    });
    const { guard } = makeGuard();
    expect((await guard.authorizeAssessment(expiredProgram, "app.example.com", "static_analysis")).permitted).toBe(false);
    expect((await guard.authorizeAssessment(expiredOperational, "app.example.com", "static_analysis")).permitted).toBe(false);
  });

  it("fails closed when audit persistence fails", async () => {
    const { guard } = makeGuard({ audit: { append: async () => { throw new Error("disk full"); } } });
    const result = await guard.authorizeAssessment(makeConfig(), "app.example.com", "static_analysis");
    expect(result.permitted).toBe(false);
    expect(result.reason).toContain("Audit persistence failed");
  });

  it("rejects malformed target identifiers and never matches suffix lookalikes", async () => {
    expect(() => normalizeTargetHostname("*.example.com")).toThrow();
    expect(() => normalizeTargetHostname("https://app.example.com:8443")).toThrow();
    expect(() => normalizeTargetHostname("https://app.example.com/private")).toThrow();
    const { guard } = makeGuard();
    expect((await guard.authorizeAssessment(makeConfig(), "notexample.com", "static_analysis")).permitted).toBe(false);
  });

  it("requires ownership evidence for owned infrastructure", async () => {
    const base = makeConfig();
    const owned = makeConfig({
      environment: "owned",
      programAuthorization: { ...base.programAuthorization, kind: "asset_ownership" }
    });
    const wrongKind = makeConfig({ environment: "owned" });
    const { guard } = makeGuard();
    expect((await guard.authorizeAssessment(owned, "app.example.com", "static_analysis")).permitted).toBe(true);
    expect((await guard.authorizeAssessment(wrongKind, "app.example.com", "static_analysis")).permitted).toBe(false);
  });

  it("requires stop-on-scope-violation to remain enabled", async () => {
    const base = makeConfig();
    const config = makeConfig({ policy: { ...base.policy, stopOnScopeViolation: false as unknown as true } });
    const { guard } = makeGuard();
    expect((await guard.authorizeAssessment(config, "app.example.com", "static_analysis")).permitted).toBe(false);
  });
  it("rejects authorization records whose verification or approval time is in the future", async () => {
    const base = makeConfig();
    const futureProgram = makeConfig({
      programAuthorization: { ...base.programAuthorization, verifiedAt: "2026-11-15T12:03:00Z" }
    });
    const futureOperational = makeConfig({
      operationalAuthorization: { ...base.operationalAuthorization, approvedAt: "2026-11-15T12:03:00Z" }
    });
    const { guard } = makeGuard();
    expect((await guard.authorizeAssessment(futureProgram, "app.example.com", "static_analysis")).permitted).toBe(false);
    expect((await guard.authorizeAssessment(futureOperational, "app.example.com", "static_analysis")).permitted).toBe(false);
  });

  it("uses an immutable request snapshot while asynchronous verifiers are pending", async () => {
    let release!: (value: boolean) => void;
    const pending = new Promise<boolean>(resolve => { release = resolve; });
    const { guard } = makeGuard({ program: () => pending });
    const config = makeConfig();
    const request = guard.authorizeAssessment(config, "app.example.com", "static_analysis");
    (config.targets as unknown as { hostname: string }[])[0].hostname = "attacker.example.net";
    release(true);
    expect((await request).permitted).toBe(true);
  });

  it("writes ScopeGuard decisions to the existing hash-linked AuditLedger", async () => {
    const directory = await mkdtemp(join(tmpdir(), "proofhunt-scopeguard-"));
    try {
      const ledger = new AuditLedger(join(directory, "audit.jsonl"));
      const guard = new ScopeGuard({
        programVerifier: { verify: () => true },
        operationalVerifier: { verify: () => true },
        audit: ledger,
        emergencyStop: { isGlobalStopActive: () => false, isProjectStopActive: () => false },
        now: () => Date.parse("2026-11-15T12:02:00Z")
      });
      const [first, second] = await Promise.all([
        guard.authorizeAssessment(makeConfig(), "app.example.com", "static_analysis"),
        guard.authorizeAssessment(makeConfig(), "api.example.com", "dependency_review")
      ]);
      expect(first.permitted).toBe(true);
      expect(second.permitted).toBe(true);
      expect(await ledger.verify()).toBe(true);
      const records = await ledger.read();
      expect(records).toHaveLength(2);
      expect(records[0].payload).toMatchObject({
        event: "proofhunt.scope_decision",
        permitted: true,
        executionPerformed: false
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("denies a target that the published bounty policy excludes even if the operational allowlist is broader", async () => {
    const base = makeConfig();
    const config = makeConfig({
      targets: [{ hostname: "example.com", includeSubdomains: true }],
      excludedTargets: []
    });
    const { guard } = makeGuard();
    const result = await guard.authorizeAssessment(config, "admin.example.com", "static_analysis");
    expect(result.permitted).toBe(false);
    expect(result.reason).toContain("published program scope");
  });

  it("denies a bounty scope snapshot whose digest no longer matches its contents", async () => {
    const base = makeConfig();
    const config = makeConfig({
      programAuthorization: { ...base.programAuthorization, scopePolicyHash: "0".repeat(64) }
    });
    const { guard } = makeGuard();
    expect((await guard.authorizeAssessment(config, "app.example.com", "static_analysis")).permitted).toBe(false);
  });

  it("denies host-only assessment when a matching bounty rule is path-scoped", async () => {
    const base = makeConfig();
    const pathPolicy = normalizeProgramPolicy({
      programId: "program-demo",
      programName: "ProofHunt demo program",
      platform: "manual",
      sourceUrl: "https://bounty.example/program/rules",
      retrievedAt: "2026-11-15T12:00:00Z",
      effectiveAt: "2026-11-01T00:00:00Z",
      expiresAt: "2027-01-01T00:00:00Z",
      scope: {
        inScope: [{ kind: "domain", value: "*.example.com" }],
        outOfScope: [{ kind: "url", value: "https://app.example.com/admin" }]
      },
      allowedActivities: ["static analysis"],
      prohibitedActivities: ["intrusive testing"],
      vulnerabilityExclusions: ["self-XSS without impact"],
      rateLimit: { requestsPerSecond: 1 },
      testingWindow: { startsAt: "2026-11-01T00:00:00Z", endsAt: "2027-01-01T00:00:00Z", timezone: "UTC" }
    }, new Date("2026-11-15T12:00:00Z"));
    const config = makeConfig({
      targets: [{ hostname: "example.com", includeSubdomains: true }],
      excludedTargets: [],
      programAuthorization: {
        ...base.programAuthorization,
        scopePolicy: pathPolicy,
        scopePolicyHash: hashNormalizedProgramPolicy(pathPolicy)
      }
    });
    const { guard } = makeGuard();
    const result = await guard.authorizeAssessment(config, "app.example.com", "static_analysis");
    expect(result.permitted).toBe(false);
    expect(result.reason).toContain("path-scoped");
  });

  it("requires each check to be permitted by the independently reviewed program or ownership record", async () => {
    const base = makeConfig();
    const config = makeConfig({
      programAuthorization: {
        ...base.programAuthorization,
        permittedChecks: ["static_analysis"]
      }
    });
    const { guard } = makeGuard();
    const result = await guard.authorizeAssessment(config, "app.example.com", "dependency_review");
    expect(result.permitted).toBe(false);
    expect(result.reason).toContain("not permitted by the independently reviewed");
  });

  it("denies new assessment plans when the global or project emergency stop is active", async () => {
    const global = makeGuard({ globalStop: true });
    const project = makeGuard({ projectStop: true });
    const globalResult = await global.guard.authorizeAssessment(makeConfig(), "app.example.com", "static_analysis");
    const projectResult = await project.guard.authorizeAssessment(makeConfig(), "app.example.com", "static_analysis");
    expect(globalResult.permitted).toBe(false);
    expect(globalResult.reason).toContain("Emergency stop");
    expect(projectResult.permitted).toBe(false);
    expect(projectResult.reason).toContain("Emergency stop");
  });

  it("canonicalizes the signed target scope independent of list ordering", async () => {
    const base = makeConfig();
    const config = makeConfig({
      targets: [...base.targets].reverse(),
      excludedTargets: [...base.excludedTargets].reverse()
    });
    const { guard } = makeGuard();
    expect((await guard.authorizeAssessment(config, "app.example.com", "static_analysis")).permitted).toBe(true);
  });

  it("denies target-scope expansion without a new signed operational approval", async () => {
    const base = makeConfig();
    const config = makeConfig({
      environment: "owned",
      programAuthorization: { ...base.programAuthorization, kind: "asset_ownership" }
    });
    (config.targets as unknown as { hostname: string; includeSubdomains?: boolean }[]).push({ hostname: "attacker.example.net" });
    const { guard } = makeGuard();
    const result = await guard.authorizeAssessment(config, "attacker.example.net", "static_analysis");
    expect(result.permitted).toBe(false);
    expect(result.reason).toContain("target-scope digest");
  });

  it("denies policy mutation even when the policy version string is unchanged", async () => {
    const base = makeConfig();
    const config = makeConfig({
      policy: { ...base.policy, allowedChecks: ["static_analysis"] }
    });
    const { guard } = makeGuard();
    const result = await guard.authorizeAssessment(config, "app.example.com", "static_analysis");
    expect(result.permitted).toBe(false);
    expect(result.reason).toContain("policy digest");
  });

  it("never preapproves a request rate above the published bounty limit", async () => {
    const base = makeConfig();
    const scopePolicy = { ...base.programAuthorization.scopePolicy!, rateLimit: { requestsPerSecond: 0.5 } };
    const config = makeConfig({
      programAuthorization: {
        ...base.programAuthorization,
        scopePolicy,
        scopePolicyHash: hashNormalizedProgramPolicy(scopePolicy)
      }
    });
    const { guard } = makeGuard();
    const result = await guard.authorizeAssessment(config, "app.example.com", "static_analysis");
    expect(result.permitted).toBe(false);
    expect(result.reason).toContain("exceeds");
  });

});
