import { describe, expect, it } from "vitest";
import {
  capturePolicySnapshot,
  PolicyIntakeInput
} from "../bug-bounty/intake";
import {
  createPolicyReviewAssignments,
  interpretPolicySnapshot,
  PolicyInterpretation,
  validateInterpretationEvidence
} from "../bug-bounty/interpretation";

function snapshot(policyText: string) {
  const input: PolicyIntakeInput = {
    programId: "program-interpretation-test",
    platform: "hackerone",
    sourceUrl: "https://hackerone.com/example",
    retrievedAt: "2026-11-12T12:00:00Z",
    contentFormat: "text/markdown",
    policyText
  };
  return capturePolicySnapshot(input);
}

describe("bug bounty policy interpretation", () => {
  it("extracts only explicit sections and preserves exact source evidence", () => {
    const text = [
      "# In Scope",
      "- *.example.com",
      "# Out of Scope",
      "- https://admin.example.com/private",
      "# Allowed Testing Activities",
      "- Manual testing with test accounts",
      "# Prohibited Methods",
      "- Denial of service and social engineering",
      "# Rate Limits",
      "- 5 requests per second",
      "# Testing Window",
      "- 2026-11-12T00:00:00Z to 2026-11-13T00:00:00Z",
      "# Disclosure",
      "- Do not publicly disclose before coordinated release"
    ].join("\r\n");
    const source = snapshot(text);
    const interpretation = interpretPolicySnapshot(source, new Date("2026-11-12T13:00:00Z"));

    expect(interpretation.reviewState).toBe("needs-human-review");
    expect(interpretation.authorized).toBe(false);
    expect(interpretation.snapshotId).toBe(source.snapshotId);
    expect(interpretation.contentSha256).toBe(source.contentSha256);
    expect(interpretation.clauses.map(clause => clause.kind)).toEqual([
      "scope-inclusion",
      "scope-exclusion",
      "allowed-activity",
      "prohibited-method",
      "rate-limit",
      "testing-window",
      "disclosure"
    ]);
    expect(interpretation.clauses[0].candidateValue).toEqual({
      kind: "asset", assetKind: "domain", value: "*.example.com"
    });
    expect(interpretation.clauses[1].candidateValue).toEqual({
      kind: "asset", assetKind: "url", value: "https://admin.example.com/private"
    });
    expect(interpretation.clauses[4].candidateValue).toEqual({
      kind: "rate-limit", limit: 5, unit: "requests-per-second"
    });
    expect(interpretation.clauses[5].candidateValue).toEqual({
      kind: "testing-window",
      startsAt: "2026-11-12T00:00:00Z",
      endsAt: "2026-11-13T00:00:00Z"
    });
    for (const clause of interpretation.clauses) {
      expect(text.slice(clause.startOffset, clause.endOffset)).toBe(clause.text);
      expect(clause.snapshotId).toBe(source.snapshotId);
      expect(clause.contentSha256).toBe(source.contentSha256);
      expect(clause.requiresHumanReview).toBe(true);
    }
    expect(validateInterpretationEvidence(source, interpretation).valid).toBe(true);
  });

  it("recognizes explicit inline labels without inventing extracted values", () => {
    const source = snapshot([
      "In Scope: *.example.com",
      "Out of Scope: https://admin.example.com/private",
      "Rate Limit: 10 requests per minute"
    ].join("\n"));
    const interpretation = interpretPolicySnapshot(source);
    expect(interpretation.clauses.map(clause => clause.kind)).toEqual([
      "scope-inclusion",
      "scope-exclusion",
      "rate-limit"
    ]);
    expect(interpretation.clauses[0].text).toBe("In Scope: *.example.com");
  });

  it("does not carry a recognized section label across an unknown heading", () => {
    const source = snapshot([
      "# In Scope",
      "- app.example.com",
      "# General Information",
      "- This service supports customer account management."
    ].join("\n"));
    const interpretation = interpretPolicySnapshot(source);
    expect(interpretation.clauses[0].kind).toBe("scope-inclusion");
    expect(interpretation.clauses[1].kind).toBe("unclassified");
  });

  it("marks qualified or unknown clauses for human review", () => {
    const source = snapshot([
      "Testing may be permitted case-by-case; contact the program first.",
      "Additional details may be discussed later."
    ].join("\n"));
    const interpretation = interpretPolicySnapshot(source);
    expect(interpretation.clauses.map(clause => clause.kind)).toEqual([
      "ambiguous",
      "unclassified"
    ]);
    expect(interpretation.issues.map(issue => issue.code)).toContain("ambiguous-language");
    expect(interpretation.issues.map(issue => issue.code)).toContain("unclassified-clause");
    expect(interpretation.reviewState).toBe("needs-human-review");
  });

  it("preserves explicit IP and CIDR assets as candidates without authorizing them", () => {
    const source = snapshot("# In Scope\n- 192.0.2.0/24\n- 2001:db8::1");
    const interpretation = interpretPolicySnapshot(source);
    expect(interpretation.clauses[0].candidateValue).toEqual({
      kind: "asset", assetKind: "cidr", value: "192.0.2.0/24"
    });
    expect(interpretation.clauses[1].candidateValue).toEqual({
      kind: "asset", assetKind: "ip", value: "2001:db8::1"
    });
    expect(interpretation.authorized).toBe(false);
  });

  it("does not misparse fractional or comma-grouped request limits", () => {
    const source = snapshot([
      "# Rate Limits",
      "- .5 requests per second",
      "- 1,500 requests per minute"
    ].join("\n"));
    const interpretation = interpretPolicySnapshot(source);
    expect(interpretation.clauses.map(clause => clause.candidateValue)).toEqual([undefined, undefined]);
    expect(interpretation.issues.filter(issue => issue.code === "unparsed-candidate")).toHaveLength(2);
  });

  it("marks inline approval qualifiers as ambiguous", () => {
    const source = snapshot("Allowed Testing Activities: manual testing subject to approval");
    const interpretation = interpretPolicySnapshot(source);
    expect(interpretation.clauses[0].kind).toBe("ambiguous");
    expect(interpretation.issues.some(issue => issue.code === "ambiguous-language")).toBe(true);
    expect(interpretation.authorized).toBe(false);
  });

  it("does not treat malformed dotted numeric IPs as domains", () => {
    const source = snapshot("In Scope: 999.999.999.999");
    const interpretation = interpretPolicySnapshot(source);
    expect(interpretation.clauses[0].kind).toBe("scope-inclusion");
    expect(interpretation.clauses[0].candidateValue).toBeUndefined();
    expect(interpretation.issues.some(issue => issue.code === "unparsed-candidate")).toBe(true);
  });

  it("keeps recognized but unsupported scope values as unparsed review items", () => {
    const source = snapshot("# In Scope\n- the production application");
    const interpretation = interpretPolicySnapshot(source);
    expect(interpretation.clauses[0].kind).toBe("scope-inclusion");
    expect(interpretation.clauses[0].candidateValue).toBeUndefined();
    expect(interpretation.issues.some(issue => issue.code === "unparsed-candidate")).toBe(true);
  });

  it("flags multiple distinct rate limits and testing windows instead of resolving them", () => {
    const source = snapshot([
      "# Rate Limits",
      "- 5 requests per second",
      "- 20 requests per minute",
      "# Testing Window",
      "- Monday 09:00-17:00 UTC",
      "- Saturday 10:00-12:00 UTC"
    ].join("\n"));
    const interpretation = interpretPolicySnapshot(source);
    expect(interpretation.issues.filter(issue => issue.code === "potential-conflict")).toHaveLength(2);
    expect(interpretation.authorized).toBe(false);
  });

  it("rejects impossible dates and reversed testing windows as parsed candidates", () => {
    const source = snapshot([
      "# Testing Window",
      "- 2026-02-30T00:00:00Z to 2026-03-01T00:00:00Z",
      "- 2026-11-13T00:00:00Z to 2026-11-12T00:00:00Z"
    ].join("\n"));
    const interpretation = interpretPolicySnapshot(source);
    expect(interpretation.clauses.every(clause => clause.candidateValue === undefined)).toBe(true);
    expect(interpretation.issues.filter(issue => issue.code === "unparsed-candidate")).toHaveLength(2);
  });

  it("creates separate pending Critic and Validator assignments without claiming execution", () => {
    const source = snapshot("# In Scope\n- app.example.com");
    const interpretation = interpretPolicySnapshot(source);
    const assignments = createPolicyReviewAssignments(interpretation);
    expect(assignments.map(item => item.reviewer)).toEqual(["critic", "validator"]);
    expect(assignments.every(item => item.status === "pending" && item.completed === false)).toBe(true);
    expect(assignments.every(item => item.snapshotId === source.snapshotId && item.authorized === false)).toBe(true);
  });

  it("detects altered evidence offsets and snapshot content", () => {
    const source = snapshot("# In Scope\n- app.example.com");
    const interpretation = interpretPolicySnapshot(source);
    const altered = {
      ...interpretation,
      clauses: interpretation.clauses.map((clause, index) =>
        index === 0 ? { ...clause, text: "different source text" } : clause
      )
    } as PolicyInterpretation;
    const result = validateInterpretationEvidence(source, altered);
    expect(result.valid).toBe(false);
    expect(result.reasons.some(reason => reason.includes("source offsets"))).toBe(true);

    const alteredCandidate = {
      ...interpretation,
      clauses: interpretation.clauses.map((clause, index) =>
        index === 0
          ? { ...clause, candidateValue: { kind: "asset", assetKind: "domain", value: "attacker.example" } }
          : clause
      )
    } as PolicyInterpretation;
    expect(validateInterpretationEvidence(source, alteredCandidate).valid).toBe(false);

    const tamperedSnapshot = { ...source, policyText: source.policyText + " changed" };
    expect(() => interpretPolicySnapshot(tamperedSnapshot)).toThrow();
  });

  it("rejects shortened evidence that drops a source-line approval condition", () => {
    const source = snapshot("# In Scope\n- app.example.com subject to approval");
    const interpretation = interpretPolicySnapshot(source);
    const original = interpretation.clauses[0];
    const shortenedText = "- app.example.com";
    const startOffset = source.policyText.indexOf("- app.example.com");
    const altered = {
      ...interpretation,
      clauses: [{
        ...original,
        kind: "scope-inclusion",
        text: shortenedText,
        startOffset,
        endOffset: startOffset + shortenedText.length,
        candidateValue: { kind: "asset", assetKind: "domain", value: "app.example.com" }
      }]
    } as unknown as PolicyInterpretation;
    const result = validateInterpretationEvidence(source, altered);
    expect(result.valid).toBe(false);
    expect(result.reasons.some(reason => reason.includes("complete, exact source line"))).toBe(true);
  });

  it("fails closed for malformed evidence-validator inputs", () => {
    const source = snapshot("# In Scope\n- app.example.com");
    const interpretation = interpretPolicySnapshot(source);
    expect(validateInterpretationEvidence(source, null as unknown as PolicyInterpretation).valid).toBe(false);
    expect(validateInterpretationEvidence(source, {
      ...interpretation,
      clauses: null
    } as unknown as PolicyInterpretation).valid).toBe(false);
  });

  it("does not treat interpretation as an authorization decision", () => {
    const source = snapshot("# Allowed Testing Activities\n- Manual testing");
    const interpretation = interpretPolicySnapshot(source);
    expect(interpretation.authorized).toBe(false);
    expect(interpretation.reviewState).toBe("needs-human-review");
    expect(interpretation.clauses.every(clause => clause.requiresHumanReview)).toBe(true);
  });
});
