import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { digest, modelRecord, sources } from "../model-workshop/catalog.js";
import { reviewEdit } from "../model-workshop/edit.js";
import { readPassage } from "../model-workshop/reader.js";
import { readerReference, restoreReader } from "../workspace/reader-ref.js";

const asset = key => JSON.parse(readFileSync(new URL(`../model-workshop/${key}.json`, import.meta.url)));
const hard = await modelRecord(asset("hard"), "Hard-label reader");
const soft = await modelRecord(asset("soft"), "Soft-label reader");
const question = "Does an array preserve the order of its values?";
const passage = "Values in a JSON array have a defined order.\nA JSON object groups name/value pairs without defining an order for those pairs.";
const local = records => ({ browserRecords: async () => records });
const host = { id: "import-" + "a".repeat(64), weightsSHA256: "b".repeat(64), name: "Installed model" };
const hostRef = { id: host.id, hash: host.weightsSHA256, location: "host", name: host.name };

test("references retain only exact identity and normalize the legacy browser selection", async () => {
  assert.equal(readerReference(null), null);
  assert.equal(await restoreReader(null), null);
  assert.deepEqual(readerReference({ ...hard, answer() {}, arbitrary: "not persisted" }),
    { id: hard.id, hash: hard.hash, location: "browser", name: hard.name });
  assert.deepEqual(readerReference(hostRef), hostRef);
  assert.notEqual(readerReference(hostRef), hostRef);
});

test("malformed references fail before any catalog or inference resolver runs", async () => {
  let calls = 0;
  const failIfCalled = async () => { calls++; throw Error("unexpected resolver"); };
  for (const changes of [
    { id: "../configured" }, { id: "default" }, { id: "f".repeat(64) }, { hash: "bad" },
    { location: "cloud" }, { location: null }, { name: " " },
    { location: "host" }, { id: "candidate-not-a-hash", location: "host" },
  ]) {
    const reference = { ...readerReference(hard), ...changes };
    assert.throws(() => readerReference(reference), /invalid/);
    await assert.rejects(restoreReader(reference, { browserRecords: failIfCalled, hostCatalog: failIfCalled, hostAnswer: failIfCalled }), /invalid/);
  }
  assert.equal(calls, 0);
});

test("an exact browser selection restores real inference and source digest", async () => {
  const reader = await restoreReader(readerReference(hard), local([soft, hard]));
  const expected = readPassage(hard.weights, question, passage);
  assert.equal(reader.id, hard.id);
  assert.equal(reader.location, "browser");
  assert.equal(reader.label, hard.name + " · " + hard.hash.slice(0, 8));
  assert.deepEqual(await reader.answer(question, passage), {
    question: expected.question, answer: expected.answer, index: expected.index,
    sourceHash: await digest(new TextEncoder().encode(JSON.stringify(expected.sentences))),
  });
});

test("missing exact browser identity never substitutes another reader with equal weights", async () => {
  await assert.rejects(restoreReader(readerReference(hard), local([soft])), /exact saved model is unavailable/);
  const editedWeights = { ...hard.weights, intercept: hard.weights.intercept + 0.125 };
  const candidate = await reviewEdit({ base: hard, weights: editedWeights, name: "Edited reader",
    evaluation: asset("evaluation"), evaluationHash: sources.evaluation });
  const plain = await modelRecord(candidate.weights, "Same weights, different identity");
  assert.equal(plain.hash, candidate.hash);
  assert.notEqual(plain.id, candidate.id);
  await assert.rejects(restoreReader(readerReference(candidate), local([plain])), /exact saved model is unavailable/);
});

test("changed bytes or recorded hashes fail even when the saved ID still exists", async () => {
  const changedBytes = structuredClone(hard);
  changedBytes.weights.intercept += 0.25;
  await assert.rejects(restoreReader(readerReference(hard), local([changedBytes])), /different weights/);
  const changedHash = { ...hard, hash: "c".repeat(64) };
  await assert.rejects(restoreReader(readerReference(hard), local([changedHash])), /different identity or weight hash/);
  await assert.rejects(restoreReader(readerReference(hard), local([changedBytes, hard])), /different weights/);
});

test("saved build lineage is verified and preserved without rerunning training", async () => {
  const candidate = await reviewEdit({ base: hard, weights: { ...hard.weights, intercept: hard.weights.intercept + 0.25 },
    name: "Edited reader", evaluation: asset("evaluation"), evaluationHash: sources.evaluation });
  candidate.importedFamily = true;
  const reader = await restoreReader(readerReference(candidate), local([candidate]));
  assert.equal(reader.id, candidate.id);
  assert.deepEqual(reader.run, candidate.run);
  assert.notEqual(reader.run, candidate.run);
  assert.equal(reader.importedFamily, true);
  const changed = structuredClone(candidate);
  changed.run.base = { id: soft.id, hash: soft.hash, label: soft.name };
  await assert.rejects(restoreReader(readerReference(candidate), local([changed])), /build identity/);
  await assert.rejects(restoreReader(readerReference(candidate), local([{ ...candidate, run: undefined }])), /identity does not match/);
});

test("restoration captures verified weights and identity independently of mutable source objects", async () => {
  const record = structuredClone(hard);
  const reference = readerReference(record);
  const reader = await restoreReader(reference, local([record]));
  const before = await reader.answer(question, passage);
  record.weights.intercept += 100;
  reference.id = soft.id;
  reference.hash = soft.hash;
  assert.deepEqual(await reader.answer(question, passage), before);
  assert.equal(reader.id, hard.id);
});

test("host restoration uses only the exact installed model and retains parent provenance", async () => {
  const calls = [];
  const installed = { ...host, parents: { base: "base-id", teacher: "teacher-id" } };
  const reader = await restoreReader(hostRef, {
    hostCatalog: async () => ({ configured: true, models: [installed] }),
    hostAnswer: async input => { calls.push(input); return { model: input.model, answer: "Test host answer" }; },
    browserRecords: async () => { throw Error("browser fallback attempted"); },
  });
  assert.deepEqual(reader.parents, installed.parents);
  assert.deepEqual(await reader.answer("  Question  "), {
    question: "  Question  ", answer: "Test host answer",
    sourceHash: await digest(new TextEncoder().encode("Question")),
  });
  assert.deepEqual(calls, [{ op: "answer", model: host.id, question: "  Question  " }]);
});

test("host disappearance, changed hash, or an offline catalog never invokes inference", async () => {
  let answerCalls = 0;
  const hostAnswer = async () => { answerCalls++; return { model: host.id, answer: "wrong fallback" }; };
  for (const models of [[], [{ ...host, id: "import-" + "c".repeat(64) }], [{ ...host, weightsSHA256: "d".repeat(64) }]]) {
    await assert.rejects(restoreReader(hostRef, { hostCatalog: async () => ({ models }), hostAnswer }), /unavailable|changed weights/);
  }
  await assert.rejects(restoreReader(hostRef, { hostCatalog: async () => { throw Error("host offline"); }, hostAnswer }), /offline/);
  let models = [host];
  const reader = await restoreReader(hostRef, { hostCatalog: async () => ({ models }), hostAnswer });
  models = [{ ...host, weightsSHA256: "e".repeat(64) }];
  await assert.rejects(reader.answer("Question"), /changed weights/);
  models = [];
  await assert.rejects(reader.answer("Question"), /unavailable/);
  assert.equal(answerCalls, 0);
});

test("a host response naming a different model or lacking an answer is rejected", async () => {
  for (const result of [{ model: "configured", answer: "Wrong model" }, { model: host.id, answer: " " }, null]) {
    const reader = await restoreReader(hostRef, {
      hostCatalog: async () => ({ models: [host] }), hostAnswer: async () => result,
    });
    await assert.rejects(reader.answer("Question"), /selected model/);
  }
});
