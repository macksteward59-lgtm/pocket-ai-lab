import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { assertComparableRuns, assertContainersSettled } from "./evidence.mjs";

const SOURCE = createHash("sha256").update("baseline source").digest("hex");
const OTHER_SOURCE = createHash("sha256").update("different source").digest("hex");
const EXPECTED = Object.freeze({ caseCount: 2, sourceSHA256: SOURCE, version: 1 });

function completed(caseId, overrides = {}) {
  return {
    executionMode: "docker",
    caseId,
    sourceSha256: SOURCE,
    version: 1,
    actual: "caf",
    exitCode: 0,
    signal: null,
    timedOut: false,
    outputLimitExceeded: false,
    oomKilled: false,
    passed: true,
    error: null,
    cleanup: {
      killAttempted: true,
      removeAttempted: true,
      verifiedAbsent: true,
      error: null
    },
    ...overrides
  };
}

function ordinaryWrong(caseId, overrides = {}) {
  return completed(caseId, {
    actual: "caf\u00e9",
    passed: false,
    error: "host comparison failed",
    ...overrides
  });
}

test("counts real comparisons while preserving ordinary wrong answers and empty results", () => {
  const runs = [completed("D01", { actual: "" }), ordinaryWrong("D02")];
  const before = structuredClone(runs);
  const result = assertComparableRuns(runs, EXPECTED);
  assert.deepEqual(result, { testsRun: 2, testsPassed: 1 });
  assert.equal(Object.isFrozen(result), true);
  assert.deepEqual(runs, before, "validation must not rewrite the underlying evidence");
  assert.deepEqual(
    assertComparableRuns([ordinaryWrong("D01"), ordinaryWrong("D02")], EXPECTED),
    { testsRun: 2, testsPassed: 0 },
    "a genuinely wrong baseline remains measurable"
  );
});

test("infrastructure failures cannot be converted into a lower baseline score", () => {
  const failures = [
    { actual: null },
    { actual: undefined },
    { actual: 0 },
    { actual: "\ud800" },
    { actual: "a".repeat(4097) },
    { exitCode: 1 },
    { exitCode: null },
    { exitCode: "0" },
    { signal: "SIGKILL" },
    { signal: undefined },
    { timedOut: true },
    { timedOut: undefined },
    { outputLimitExceeded: true },
    { outputLimitExceeded: undefined },
    { oomKilled: true },
    { oomKilled: null },
    { error: "Candidate process failed: timeout" },
    { error: "Container completion identity/state mismatch" },
    { error: "Private workspace cleanup failed: filesystem unavailable" }
  ];
  for (const failure of failures) {
    const runs = [ordinaryWrong("D01"), ordinaryWrong("D02", failure)];
    assert.throws(() => assertComparableRuns(runs, EXPECTED), Error, JSON.stringify(failure));
  }
});

test("matching counts cannot conceal missing, duplicate, or different-source cases", () => {
  const runs = [completed("D01"), ordinaryWrong("D02")];
  assert.throws(() => assertComparableRuns(runs.slice(0, 1), EXPECTED), /exact expected number/);
  assert.throws(() => assertComparableRuns([...runs, completed("D03")], EXPECTED), /exact expected number/);
  assert.throws(() => assertComparableRuns([runs[0], ordinaryWrong("D01")], EXPECTED), /distinct/);
  assert.throws(() => assertComparableRuns([runs[0], ordinaryWrong("")], EXPECTED), /distinct/);
  assert.throws(() => assertComparableRuns([runs[0], ordinaryWrong("bad case")], EXPECTED), /distinct/);
  assert.throws(
    () => assertComparableRuns([runs[0], ordinaryWrong("D02", { sourceSha256: OTHER_SOURCE })], EXPECTED),
    /selected source\/version/
  );
  assert.throws(
    () => assertComparableRuns([runs[0], ordinaryWrong("D02", { version: 2 })], EXPECTED),
    /selected source\/version/
  );
});

test("a success claim cannot hide an error and a failed comparison must have the ordinary error", () => {
  for (const overrides of [
    { passed: true, error: "host comparison failed" },
    { passed: true, error: "" },
    { passed: false, error: null },
    { passed: false, error: undefined },
    { passed: false, error: "candidate says it passed" },
    { passed: "true", error: null },
    { passed: undefined, error: null }
  ]) {
    assert.throws(
      () => assertComparableRuns([completed("D01"), completed("D02", overrides)], EXPECTED),
      /neither a successful comparison nor an ordinary wrong answer/
    );
  }
});

test("uncertain creation or cleanup blocks continuation even with usable candidate output", () => {
  const uncertain = completed("D02", {
    cleanup: {
      killAttempted: true,
      removeAttempted: true,
      verifiedAbsent: false,
      error: "Creation acknowledgement was interrupted; later creation cannot be ruled out"
    }
  });
  let nextStageStarted = false;
  assert.throws(() => {
    assertContainersSettled([completed("D01"), uncertain]);
    nextStageStarted = true;
  }, /cleanup is unverified/);
  assert.equal(nextStageStarted, false);
  assert.throws(() => assertComparableRuns([completed("D01"), uncertain], EXPECTED), /cleanup is unverified/);
  for (const cleanup of [
    undefined, null, {},
    { verifiedAbsent: true, error: "daemon unreachable" },
    { verifiedAbsent: true, error: "" },
    { verifiedAbsent: true },
    { verifiedAbsent: "true", error: null }
  ]) {
    assert.throws(() => assertContainersSettled([completed("D01", { cleanup })]), /cleanup is unverified/);
  }
});

test("teardown validation allows an empty blocked preflight but never promotes test doubles", () => {
  assert.doesNotThrow(() => assertContainersSettled([]));
  assert.doesNotThrow(() => assertContainersSettled([
    completed("timeout", { exitCode: null, signal: "SIGKILL", timedOut: true,
      passed: false, error: "Candidate process failed: timeout" })
  ]), "settled teardown is independent from successful execution");
  for (const record of [
    null, [], {},
    completed("D01", { executionMode: "test-double" }),
    completed("D01", { executionMode: undefined })
  ]) {
    assert.throws(() => assertContainersSettled([record]), /actual Docker execution/);
  }
  assert.throws(() => assertContainersSettled(undefined), /must be an array/);
  assert.throws(
    () => assertComparableRuns([completed("D01"), completed("D02", { executionMode: "test-double" })], EXPECTED),
    /actual Docker execution/
  );
});

test("comparison metadata must explicitly bind source, version, and a nonempty case count", () => {
  for (const options of [
    {}, { ...EXPECTED, caseCount: 0 }, { ...EXPECTED, caseCount: -1 },
    { ...EXPECTED, caseCount: 1.5 }, { ...EXPECTED, sourceSHA256: "" },
    { ...EXPECTED, sourceSHA256: SOURCE.toUpperCase() },
    { ...EXPECTED, version: 0 }, { ...EXPECTED, version: "1" }
  ]) {
    assert.throws(() => assertComparableRuns([completed("D01"), completed("D02")], options), /Comparison requires/);
  }
  assert.throws(() => assertComparableRuns([], { ...EXPECTED, caseCount: 0 }), /Comparison requires/);
});
