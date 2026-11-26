import { describe, expect, it } from "vitest";
import { runResearchBenchmark } from "../research-science/ResearchBenchmark";
import { SYNTHETIC_TENANT_ISOLATION_FIXTURE } from "../research-science/fixtures/synthetic-tenant-isolation";
import {
  SYNTHETIC_TENANT_ISOLATION_SECURE_FIXTURE,
  SYNTHETIC_TENANT_ISOLATION_UNKNOWN_FIXTURE
} from "../research-science/fixtures/synthetic-tenant-isolation-edge-cases";

describe("ResearchBenchmark", () => {
  it("scores vulnerable, secure, and unknown synthetic models without overclaiming", () => {
    const report = runResearchBenchmark([
      { id: "vulnerable-tenant-boundary", fixture: SYNTHETIC_TENANT_ISOLATION_FIXTURE, expectedStatus: "counterexample" },
      { id: "enforced-tenant-boundary", fixture: SYNTHETIC_TENANT_ISOLATION_SECURE_FIXTURE, expectedStatus: "no-counterexample" },
      { id: "unknown-tenant-boundary", fixture: SYNTHETIC_TENANT_ISOLATION_UNKNOWN_FIXTURE, expectedStatus: "inconclusive" }
    ]);

    expect(report.totalCases).toBe(3);
    expect(report.passedCases).toBe(3);
    expect(report.failedCases).toBe(0);
    expect(report.exactMatchRate).toBe(1);
    expect(report.inconclusiveCases).toBe(1);
    expect(report.executionPerformed).toBe(false);
    expect(report.authorized).toBe(false);
    expect(report.results.map(result => result.actualStatus)).toEqual([
      "counterexample", "no-counterexample", "inconclusive"
    ]);
  });

  it("rejects duplicate case identifiers and oversized benchmark sets", () => {
    const cases = [
      { id: "same", fixture: SYNTHETIC_TENANT_ISOLATION_FIXTURE, expectedStatus: "counterexample" as const },
      { id: "same", fixture: SYNTHETIC_TENANT_ISOLATION_FIXTURE, expectedStatus: "counterexample" as const }
    ];
    expect(() => runResearchBenchmark(cases)).toThrow(/Duplicate/);
    expect(() => runResearchBenchmark(Array.from({ length: 101 }, (_, index) => ({
      id: "case-" + index,
      fixture: SYNTHETIC_TENANT_ISOLATION_FIXTURE,
      expectedStatus: "counterexample" as const
    })))).toThrow(/between 1 and 100/);
  });

  it("fails honestly when expected outcomes do not match", () => {
    const report = runResearchBenchmark([{
      id: "intentionally-wrong-expectation",
      fixture: SYNTHETIC_TENANT_ISOLATION_FIXTURE,
      expectedStatus: "no-counterexample"
    }]);
    expect(report.passedCases).toBe(0);
    expect(report.failedCases).toBe(1);
    expect(report.exactMatchRate).toBe(0);
  });
});
