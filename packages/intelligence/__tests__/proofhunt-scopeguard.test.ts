import { describe, expect, it, vi } from "vitest";
import {
  ScopeGuard,
  normalizeTargetHostname,
  type ProofHuntAssessmentConfig,
  type ScopeGuardAuditWriter
} from "../security/proofhunt";

function makeConfig(overrides: Partial<ProofHuntAssessmentConfig> = {}): ProofHuntAssessmentConfig {
  return {
    projectId: "proofhunt-demo",
    environment: "bounty",
    programAuthorization: {
      recordId: "PROGRAM-1",
      kind: "bug_bounty_program",
      subjectId: "program-demo",
      evidenceReference: "https://bounty.example/program/rules",
      sourceRevision: "sha256:program-rules-revision-1",
      status: "verified",
      verifiedAt: "2026-11-15T12:00:00Z",
      expiresAt: "2027-01-01T00:00:00Z"
    },
    operationalAuthorization: {
      recordId: "OPS-1",
      programAuthorizationId: "PROGRAM-1",
      policyVersion: "policy-1",
      status: "approved",
      approvedBy: "human-reviewer",
      approvalReference: "approval://proofhunt-demo/1",
      signatureReference: "signature://proofhunt-demo/1",
      approvedAt: "2026-11-15T12:01:00Z",
      expiresAt: "2026-12-01T00:00:00Z"
    },
    targets: [{ hostname: "app.example.com" }, { hostname: "api.example.com" }],
    excludedTargets: [{ hostname: "admin.example.com" }],
    policy: {
      version: "policy-1",
      preapproved: true,
      allowedChecks: ["static_analysis", "api_spec_review", "configuration_review", "dependency_review", "security_metadata_review"],
      maxRequestsPerSecond: 1,
      maxConcurrentJobs: 1,
      stopOnScopeViolation: true
    },
    ...overrides
  };
}

function makeGuard(options: {
  program?: () => boolean;
  operational?: () => boolean;
  audit?: ScopeGuardAuditWriter;
  now?: number;
} = {}) {
  const audit = options.audit ?? { append: vi.fn(async () => undefined) };
  const guard = new ScopeGuard({
    programVerifier: { verify: options.program ?? (() => true) },
    operationalVerifier: { verify: options.operational ?? (() => true) },
    audit,
    now: () => options.now ?? Date.parse("2026-11-15T12:02:00Z")
  });
  return { guard, audit };
}

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

  it("gives exclusions precedence over matching inclusions", async () => {
    const { guard } = makeGuard();
    const config = makeConfig({
      targets: [{ hostname: "example.com", includeSubdomains: true }],
      excludedTargets: [{ hostname: "admin.example.com", includeSubdomains: true }]
    });
    const result = await guard.authorizeAssessment(config, "admin.example.com", "static_analysis");
    expect(result.permitted).toBe(false);
    expect(result.reason).toContain("excluded");
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
    const config = makeConfig({ policy: { ...base.policy, stopOnScopeViolation: false as true } });
    const { guard } = makeGuard();
    expect((await guard.authorizeAssessment(config, "app.example.com", "static_analysis")).permitted).toBe(false);
  });
});
