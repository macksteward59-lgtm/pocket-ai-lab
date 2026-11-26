import { runResearchPoc } from "./ResearchPoc";
import type { ResearchPocReport, SecurityWorldModelInput, ModelCheckResult } from "./types";

export interface ResearchBenchmarkCase {
  id: string;
  fixture: SecurityWorldModelInput;
  expectedStatus: ModelCheckResult["status"];
}

export interface ResearchBenchmarkCaseResult {
  id: string;
  expectedStatus: ModelCheckResult["status"];
  actualStatus: ModelCheckResult["status"];
  passed: boolean;
  checkedPairs: number;
  hypothesisCount: number;
}

export interface ResearchBenchmarkReport {
  benchmarkId: "pal-synthetic-security-world-v1";
  totalCases: number;
  passedCases: number;
  failedCases: number;
  exactMatchRate: number;
  inconclusiveCases: number;
  results: readonly ResearchBenchmarkCaseResult[];
  executionPerformed: false;
  authorized: false;
  limitations: readonly string[];
}

/**
 * Evaluates model-checker behavior against explicit synthetic expected outcomes.
 * The benchmark does not execute experiments or interact with applications.
 */
export function runResearchBenchmark(cases: readonly ResearchBenchmarkCase[]): ResearchBenchmarkReport {
  if (!Array.isArray(cases) || cases.length < 1 || cases.length > 100) {
    throw new Error("Benchmark requires between 1 and 100 cases");
  }
  const ids = new Set<string>();
  const results: ResearchBenchmarkCaseResult[] = [];

  for (const testCase of cases) {
    if (!testCase || typeof testCase.id !== "string" || testCase.id.length < 1 || testCase.id.length > 128) {
      throw new Error("Benchmark case identifiers must be bounded non-empty strings");
    }
    if (ids.has(testCase.id)) throw new Error("Duplicate benchmark case identifier: " + testCase.id);
    ids.add(testCase.id);
    if (!["counterexample", "no-counterexample", "inconclusive"].includes(testCase.expectedStatus)) {
      throw new Error("Unsupported expected benchmark status");
    }
    const report: ResearchPocReport = runResearchPoc(testCase.fixture);
    results.push(Object.freeze({
      id: testCase.id,
      expectedStatus: testCase.expectedStatus,
      actualStatus: report.modelCheck.status,
      passed: report.modelCheck.status === testCase.expectedStatus,
      checkedPairs: report.modelCheck.checkedPairs,
      hypothesisCount: report.hypotheses.length
    }));
  }

  const passedCases = results.filter(result => result.passed).length;
  const inconclusiveCases = results.filter(result => result.actualStatus === "inconclusive").length;
  return Object.freeze({
    benchmarkId: "pal-synthetic-security-world-v1",
    totalCases: results.length,
    passedCases,
    failedCases: results.length - passedCases,
    exactMatchRate: passedCases / results.length,
    inconclusiveCases,
    results: Object.freeze(results),
    executionPerformed: false,
    authorized: false,
    limitations: Object.freeze([
      "This benchmark measures agreement with hand-authored synthetic model outcomes only.",
      "It is not a measure of real-world vulnerability discovery, exploitability, or bug bounty performance.",
      "The benchmark is deterministic and does not execute experiments or contact targets.",
      "A passing result validates implementation behavior against these fixtures, not the truth of a live application's model."
    ])
  });
}
