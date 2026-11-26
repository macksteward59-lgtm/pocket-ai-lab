/**
 * Host-only evidence checks for actual Docker workshop runs.
 *
 * These helpers do not execute candidates, generate answers, or grade text.
 * They validate records produced by DockerPythonToolSandbox before an ordinary
 * wrong answer may count toward a baseline. An execution/integrity failure
 * cannot be relabeled as a low-quality answer.
 */
const SHA256 = /^[a-f0-9]{64}$/;
const CASE_ID = /^[A-Za-z0-9_-]{1,80}$/;

/**
 * Require one completed, comparable run per distinct case.
 *
 * sourceSHA256 refers to the actual source bytes selected by the host; the
 * sandbox records that field as sourceSha256. A normal wrong answer remains
 * comparable. Missing output, process failure, uncertain cleanup, and mock
 * execution do not. No result here authorizes activation.
 */
export function assertComparableRuns(runs, { caseCount, sourceSHA256, version } = {}) {
  if (!Number.isSafeInteger(caseCount) || caseCount < 1 ||
      typeof sourceSHA256 !== "string" || !SHA256.test(sourceSHA256) ||
      !Number.isSafeInteger(version) || version < 1) {
    throw new Error("Comparison requires a positive case count, source SHA-256, and artifact version");
  }
  if (!Array.isArray(runs) || runs.length !== caseCount) {
    throw new Error("Comparison requires the exact expected number of case runs");
  }
  assertContainersSettled(runs);
  const ids = new Set();
  let testsPassed = 0;
  for (const run of runs) {
    if (typeof run.caseId !== "string" || !CASE_ID.test(run.caseId) || ids.has(run.caseId)) {
      throw new Error("Comparison case IDs must be valid and distinct");
    }
    ids.add(run.caseId);
    const label = "Comparison case " + run.caseId;
    if (run.sourceSha256 !== sourceSHA256 || run.version !== version) {
      throw new Error(label + " does not match the selected source/version");
    }
    if (typeof run.actual !== "string" || Buffer.byteLength(run.actual, "utf8") > 4096 ||
        Buffer.from(run.actual, "utf8").toString("utf8") !== run.actual) {
      throw new Error(label + " has no valid parsed string output");
    }
    if (run.exitCode !== 0 || run.signal !== null || run.timedOut !== false ||
        run.outputLimitExceeded !== false || run.oomKilled !== false) {
      throw new Error(label + " has an incomplete or failed execution; it cannot lower a baseline");
    }
    if (run.passed === true && run.error === null) {
      testsPassed++;
    } else if (!(run.passed === false && run.error === "host comparison failed")) {
      throw new Error(label + " is neither a successful comparison nor an ordinary wrong answer");
    }
  }
  return Object.freeze({ testsRun: runs.length, testsPassed });
}

/**
 * Require verified teardown before the next stage or the final acceptance gate.
 * Empty runs are allowed for a report whose preflight failed before creation;
 * this function alone does not establish execution or a passing experiment.
 * Execution failures are allowed here only when teardown is known to be settled.
 */
export function assertContainersSettled(runs) {
  if (!Array.isArray(runs)) throw new Error("Container evidence must be an array");
  for (const run of runs) {
    if (!run || typeof run !== "object" || Array.isArray(run) || run.executionMode !== "docker") {
      throw new Error("Container evidence must identify actual Docker execution");
    }
    if (!run.cleanup || run.cleanup.verifiedAbsent !== true || run.cleanup.error !== null) {
      throw new Error("Container cleanup is unverified; do not continue or accept the experiment");
    }
  }
}
