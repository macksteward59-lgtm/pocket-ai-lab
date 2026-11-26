import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  DEFAULT_FIXTURE_PATH,
  FIXTURE_LIMITS,
  FROZEN_FIXTURE_SHA256,
  assertCandidateSelection,
  assertFixtureInput,
  assertHeldOutGate,
  loadFrozenFixture
} from "./fixture.mjs";

const SOURCE_DIGEST = createHash("sha256").update("candidate source").digest("hex");

test("loads a pinned, deeply immutable fixture with distinct development and held-out cases", async () => {
  const loaded = await loadFrozenFixture();
  assert.equal(loaded.digest, FROZEN_FIXTURE_SHA256);
  assert.equal(loaded.fixture.version, 1);
  assert.equal(loaded.fixture.maxRevisions, 2);
  assert.equal(loaded.fixture.development.length, 8);
  assert.equal(loaded.fixture.heldOut.length, 20);
  assert.match(loaded.fixture.taskSpec, /code points, not grapheme clusters/);
  assert.equal(Object.isFrozen(loaded), true);
  assert.equal(Object.isFrozen(loaded.fixture), true);
  assert.equal(Object.isFrozen(loaded.fixture.development), true);
  assert.equal(Object.isFrozen(loaded.fixture.heldOut[0]), true);
  assert.throws(() => { loaded.fixture.heldOut[0].expected = "changed"; }, TypeError);
  assert.throws(() => { loaded.fixture.development.push({}); }, TypeError);
  const all = [...loaded.fixture.development, ...loaded.fixture.heldOut];
  assert.equal(new Set(all.map(item => item.id)).size, all.length);
  const developmentInputs = new Set(loaded.fixture.development.map(item => JSON.stringify([item.text, item.byteLimit])));
  assert.equal(loaded.fixture.heldOut.some(item => developmentInputs.has(JSON.stringify([item.text, item.byteLimit]))), false);
});

test("the fixed cases distinguish character slicing and preserve non-grapheme code-point prefixes", async () => {
  const { fixture } = await loadFrozenFixture();
  assert.equal(fixture.baselineSource, "def truncate_utf8(text, byte_limit):\n    return text[:byte_limit]\n");
  const accented = fixture.development.find(item => item.id === "D02");
  // This fixture check is not claimed as a Python candidate execution.
  assert.notEqual(Array.from(accented.text).slice(0, accented.byteLimit).join(""), accented.expected);
  assert.equal(fixture.heldOut.find(item => item.id === "H09").expected, "e\u0301");
  assert.equal(fixture.heldOut.find(item => item.id === "H11").expected, "\u{1f469}\u200d");
  assert.equal(fixture.heldOut.find(item => item.id === "H14").expected, "A\u0000B\n");
  assert.equal(fixture.heldOut.find(item => item.id === "H17").expected, "");
});

test("refuses changed answer keys, metadata, whitespace, and oversized replacement fixtures", async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "pocket-frozen-fixture-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const original = await readFile(DEFAULT_FIXTURE_PATH);
  const copy = path.join(directory, "fixture.json");
  await writeFile(copy, original);
  assert.equal((await loadFrozenFixture(copy)).digest, FROZEN_FIXTURE_SHA256);

  const changed = JSON.parse(original.toString("utf8"));
  changed.heldOut[0].expected = "A\u00e9";
  await writeFile(copy, JSON.stringify(changed));
  await assert.rejects(loadFrozenFixture(copy), /digest mismatch/);
  await writeFile(copy, Buffer.concat([original, Buffer.from("\n")]));
  await assert.rejects(loadFrozenFixture(copy), /digest mismatch/);
  await writeFile(copy, "x".repeat(FIXTURE_LIMITS.maxManifestBytes + 1));
  await assert.rejects(loadFrozenFixture(copy), /manifest byte limit/);
});

test("host input validation admits bounded scalar strings without normalization", () => {
  const input = { text: "e\u0301\u0000\u{1f600}", byteLimit: 7 };
  const valid = assertFixtureInput(input);
  assert.deepEqual(valid, input);
  assert.equal(Object.isFrozen(valid), true);
  input.text = "changed";
  assert.equal(valid.text, "e\u0301\u0000\u{1f600}");
  assert.deepEqual(assertFixtureInput({ text: "", byteLimit: 0 }), { text: "", byteLimit: 0 });
  assert.equal(assertFixtureInput({ text: "\u{1f600}".repeat(1024), byteLimit: 4096 }).text.length, 2048);
});

test("invalid types, field shapes, budgets, surrogates, and oversized input are protocol errors", () => {
  for (const input of [
    null, [], {}, { text: "x" }, { text: "x", byteLimit: 1, expected: "x" },
    { text: 1, byteLimit: 1 }, { text: new String("x"), byteLimit: 1 },
    { text: "x", byteLimit: true }, { text: "x", byteLimit: "1" },
    { text: "x", byteLimit: 0.5 }, { text: "x", byteLimit: -1 },
    { text: "x", byteLimit: 4097 }, { text: "x", byteLimit: Infinity },
    { text: "x", byteLimit: NaN },
    { text: "\ud800", byteLimit: 1 }, { text: "\udc00", byteLimit: 1 },
    { text: "\ud800x", byteLimit: 1 }, { text: "\udc00\ud800", byteLimit: 1 },
    { text: "a".repeat(4097), byteLimit: 4096 },
    { text: "\u{1f600}".repeat(1025), byteLimit: 4096 }
  ]) {
    assert.throws(() => assertFixtureInput(input), Error);
  }
});

test("selection rejects a baseline-only run, extra revisions, and caller-expanded budgets", () => {
  for (const revisionCount of [1, 2]) {
    const selection = assertCandidateSelection({ revisionCount, maxRevisions: 2, sourceDigest: SOURCE_DIGEST });
    assert.equal(Object.isFrozen(selection), true);
    assert.equal(selection.sourceDigest, SOURCE_DIGEST);
  }
  for (const revisionCount of [0, -1, 3, 1.5, true, NaN]) {
    assert.throws(() => assertCandidateSelection({ revisionCount, maxRevisions: 2, sourceDigest: SOURCE_DIGEST }), /frozen budget/);
  }
  assert.throws(() => assertCandidateSelection({ revisionCount: 2, maxRevisions: 99, sourceDigest: SOURCE_DIGEST }), /frozen budget/);
  assert.throws(() => assertCandidateSelection({ revisionCount: 1, maxRevisions: 2, sourceDigest: "model says passed" }), /SHA-256/);
  assert.throws(() => assertCandidateSelection({ revisionCount: 1, maxRevisions: 2, sourceDigest: SOURCE_DIGEST, score: 1 }), /unexpected fields/);
});

test("held-out execution requires the actual candidate hash to match its frozen selection", () => {
  const gate = {
    frozenSourceDigest: SOURCE_DIGEST,
    candidateSourceDigest: SOURCE_DIGEST,
    revisionCount: 2,
    maxRevisions: 2
  };
  assert.equal(assertHeldOutGate(gate).sourceDigest, SOURCE_DIGEST);
  assert.throws(
    () => assertHeldOutGate({ ...gate, candidateSourceDigest: createHash("sha256").update("edited after freeze").digest("hex") }),
    /changed after the final-source freeze/
  );
  assert.throws(() => assertHeldOutGate({ ...gate, revisionCount: 0 }), /frozen budget/);
  assert.throws(() => assertHeldOutGate({ ...gate, candidateSourceDigest: undefined }), /SHA-256/);
  assert.throws(() => assertHeldOutGate({ ...gate, heldOutPassed: true }), /unexpected fields/);
});
