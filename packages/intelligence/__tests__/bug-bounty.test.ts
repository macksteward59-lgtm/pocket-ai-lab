import { describe, expect, it } from "vitest";
import {
  evaluateProgramAction,
  evaluateTargetScope,
  normalizeProgramPolicy,
  ProgramPolicyCandidate,
  ProgramPolicyError
} from "../bug-bounty";

const now = new Date("2026-11-12T12:00:00.000Z");

function candidate(overrides: Partial<ProgramPolicyCandidate> = {}): ProgramPolicyCandidate {
  return {
    programId: "sample-program",
    programName: "Sample Program",
    platform: "hackerone",
    sourceUrl: "https://hackerone.com/sample",
    retrievedAt: "2026-11-12T11:00:00Z",
    effectiveAt: "2026-11-01T00:00:00Z",
    expiresAt: "2026-12-01T00:00:00Z",
    scope: {
      inScope: [{ kind: "domain", value: "*.example.com" }],
      outOfScope: [{ kind: "url", value: "https://admin.example.com/private" }]
    },
    allowedActivities: ["Manual testing with test accounts"],
    prohibitedActivities: ["Denial of service", "Social engineering"],
    vulnerabilityExclusions: ["Self-XSS without impact"],
    rateLimit: { requestsPerSecond: 2 },
    testingWindow: {
      startsAt: "2026-11-01T00:00:00Z",
      endsAt: "2026-12-01T00:00:00Z",
      timezone: "UTC"
    },
    disclosureRules: ["Do not publicly disclose before coordinated release"],
    ...overrides
  };
}

describe("bug bounty Program Intelligence", () => {
  it("normalizes an explicit policy for human review without granting authority", () => {
    const policy = normalizeProgramPolicy(candidate(), now);
    expect(policy.reviewState).toBe("ready-for-human-review");
    expect(policy.authorized).toBe(false);
    expect(policy.inScope[0].value).toBe("example.com");
    expect(policy.inScope[0].includeSubdomains).toBe(true);
  });

  it("marks incomplete policy data as needing review", () => {
    const input = candidate();
    input.allowedActivities = [];
    input.rateLimit = undefined;
    const policy = normalizeProgramPolicy(input, now);
    expect(policy.reviewState).toBe("needs-review");
    expect(policy.reviewReasons).toContain("Allowed testing activities are not explicit");
    expect(policy.reviewReasons).toContain("A request-rate limit is not explicit");
    expect(policy.authorized).toBe(false);
  });

  it("blocks expired and not-yet-effective policies", () => {
    const expired = normalizeProgramPolicy(candidate({ expiresAt: "2026-11-11T00:00:00Z" }), now);
    const future = normalizeProgramPolicy(candidate({ effectiveAt: "2026-11-13T00:00:00Z" }), now);
    expect(expired.reviewState).toBe("blocked");
    expect(future.reviewState).toBe("blocked");
  });

  it("rejects a non-HTTPS program source and malformed dates", () => {
    expect(() => normalizeProgramPolicy(candidate({ sourceUrl: "http://hackerone.com/sample" }), now))
      .toThrow(ProgramPolicyError);
    expect(() => normalizeProgramPolicy(candidate({ retrievedAt: "yesterday" }), now))
      .toThrow(ProgramPolicyError);
  });

  it("lets explicit exclusions override a broader wildcard inclusion", () => {
    const policy = normalizeProgramPolicy(candidate(), now);
    const scope = evaluateTargetScope(policy, "https://admin.example.com/private/settings");
    expect(scope.disposition).toBe("out-of-scope");
    expect(scope.authorized).toBe(false);
  });

  it("matches subdomains but does not confuse suffix lookalikes", () => {
    const policy = normalizeProgramPolicy(candidate(), now);
    expect(evaluateTargetScope(policy, "https://api.example.com/v1").disposition).toBe("in-scope");
    expect(evaluateTargetScope(policy, "https://notexample.com/").disposition).toBe("out-of-scope");
  });

  it("matches URL paths on segment boundaries", () => {
    const policy = normalizeProgramPolicy(candidate({
      scope: {
        inScope: [{ kind: "url", value: "https://example.com/api" }],
        outOfScope: []
      }
    }), now);
    expect(evaluateTargetScope(policy, "https://example.com/api/v1").disposition).toBe("in-scope");
    expect(evaluateTargetScope(policy, "https://example.com/apix").disposition).toBe("out-of-scope");
  });

  it("returns indeterminate when unsupported asset types appear", () => {
    const policy = normalizeProgramPolicy(candidate({
      scope: {
        inScope: [{ kind: "cidr", value: "192.0.2.0/24" }],
        outOfScope: []
      }
    }), now);
    expect(policy.reviewState).toBe("needs-review");
    expect(evaluateTargetScope(policy, "https://192.0.2.10/").disposition).toBe("indeterminate");
  });

  it("never permits an action, even for an in-scope target", () => {
    for (const action of ["read_program_policy", "analyze_supplied_source", "passive_recon", "active_test", "exploit_validation", "access_sensitive_data", "submit_report"] as const) {
      const decision = evaluateProgramAction(action);
      expect(decision.allowed).toBe(false);
      expect(decision.authorized).toBe(false);
    }
  });
});
