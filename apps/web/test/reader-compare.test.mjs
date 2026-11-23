import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { modelRecord, sources } from "../model-workshop/catalog.js";
import { compareReaders, MAX_COMPARISON_BYTES } from "../model-workshop/compare.js";
import { blendReaders, reviewEdit } from "../model-workshop/edit.js";
import { trainingBuildId } from "../model-workshop/family.js";
import { readPassage, recipe, train } from "../model-workshop/reader.js";

const asset = key => JSON.parse(readFileSync(new URL(`../model-workshop/${key}.json`, import.meta.url)));
const base = await modelRecord(asset("soft"), "Base fixture"), hard = await modelRecord(asset("hard"), "Hard fixture");
const recorded = model => ({ id: model.id, hash: model.hash, label: "Untrusted historical label" });
const evaluation = asset("evaluation");
const fitted = train(base.weights, hard.weights, asset("training"));
const derived = await modelRecord(fitted.weights, "Trained");
derived.run = { recipe, base: recorded(base), teacher: recorded(hard), training: sources.training,
  evaluation: sources.evaluation };
derived.id = await trainingBuildId(base.id, hard.id, derived.hash);
const edit = options => reviewEdit({ name: "Review", evaluation, evaluationHash: sources.evaluation, ...options });
const catalog = new Map([derived, base, hard].map(entry => [entry.id, entry]));
const question = "How many cycles are recorded?";
const docs = [{ id: "private index", url: "https://example.invalid/never-fetched", sentences: [
  "  There are eight cycles. ", "The colors are red and green.",
], questions: [[question, 0], [question, -1], [question, null]] }];

test("selected and parent readers run the actual passage path without labels in the model inputs", async () => {
  const snapshot = JSON.stringify([...catalog.values()]);
  const data = structuredClone(docs);
  const { models, cases } = await compareReaders(derived.id, catalog, docs);
  assert.deepEqual(models.map(m => [m.id, m.name, m.role]), [
    [derived.id, derived.name, "Selected reader"], [base.id, base.name, "Base"], [hard.id, hard.name, "Teacher"],
  ]);
  const passage = docs[0].sentences.join("\n");
  const actual = [derived, base, hard].map(model => readPassage(model.weights, question, passage));
  for (const item of cases) {
    assert.equal(item.passage, passage);
    assert.deepEqual(item.sentences, ["There are eight cycles.", "The colors are red and green."]);
    assert.deepEqual(item.results, actual.map((output, i) => ({ id: models[i].id, index: output.index, answer: output.answer })));
  }
  assert.deepEqual(cases.map(item => item.expected), [0, -1, null]);
  const abstains = await modelRecord({ ...base.weights, intercept: -500 }, "Always abstains");
  const single = await compareReaders(abstains.id, new Map([[abstains.id, abstains]]), docs);
  assert.equal(single.cases[1].results[0].index, -1);
  assert.equal(single.cases[1].results[0].answer, "UNKNOWN · insufficient evidence");
  for (const [i, model] of models.entries()) {
    assert.equal(model.total, 2);
    assert.equal(model.correct, Number(actual[i].index === 0 || actual[i].index === -1));
  }
  assert.deepEqual(docs, data);
  assert.equal(JSON.stringify([...catalog.values()]), snapshot);
});

test("root-only, edited and blended lineages use their actual direct parents and preserve equal-weight identities", async () => {
  const ungraded = [{ sentences: ["One sentence."], questions: [["  Which line? ", null]] }];
  assert.deepEqual((await compareReaders(base.id, catalog, ungraded)).models, [
    { id: base.id, name: base.name, role: "Selected reader", correct: 0, total: 0 },
  ]);
  const alias = await edit({ base: hard, weights: base.weights });
  const otherAlias = await edit({ base: derived, weights: base.weights });
  assert.notEqual(alias.id, otherAlias.id);
  assert.equal(alias.hash, otherAlias.hash);
  const mix = parent => edit({ base: parent, second: hard,
    weights: blendReaders(parent.weights, hard.weights, 25), rightPercent: 25 });
  const mixed = await mix(alias), otherMix = await mix(otherAlias);
  const current = new Map([mixed, otherMix, hard, alias, otherAlias].map(entry => [entry.id, entry]));
  const result = await compareReaders(mixed.id, current, ungraded);
  const other = await compareReaders(otherMix.id, current, ungraded);
  assert.deepEqual(result.models.map(r => [r.role, r.id]), [
    ["Selected reader", mixed.id], ["Base", alias.id], ["Second parent", hard.id],
  ]);
  assert.deepEqual(other.models.map(r => r.id), [otherMix.id, otherAlias.id, hard.id]);
  assert.equal(result.cases[0].question, "  Which line? ");
  assert.deepEqual(result.cases[0].results.map(r => r.answer), other.cases[0].results.map(r => r.answer));
  assert.deepEqual((await compareReaders(alias.id, current, ungraded)).models.map(r => [r.role, r.id]),
    [["Selected reader", alias.id], ["Base", hard.id]]);
  // An actual catalog entry can retain valid weights while its stored lineage points to a different build.
  const wrong = structuredClone(mixed);
  wrong.run.base = recorded(otherAlias);
  current.set(wrong.id, wrong);
  await assert.rejects(compareReaders(wrong.id, current, ungraded), /build identity/);
  current.set(mixed.id, mixed);
  const wrongParent = { ...alias, run: otherAlias.run };
  current.set(alias.id, wrongParent);
  await assert.rejects(compareReaders(mixed.id, current, ungraded), /build identity/);
});

test("missing, mismatched or unsupported parent lineage is rejected", async () => {
  await assert.rejects(compareReaders("missing", catalog, docs), /missing/);
  for (const change of [
    run => { run.base.hash = hard.hash; }, run => { run.base.id = "missing"; },
    run => { run.teacher = run.base; }, run => { run.second = run.teacher; },
    run => { run.recipe = "unknown"; }, run => { delete run.base; },
  ]) {
    const current = new Map(catalog), model = structuredClone(derived);
    change(model.run);
    current.set(model.id, model);
    await assert.rejects(compareReaders(model.id, current, docs), /missing|distinct|unsupported|identity/i);
  }
  const wrongId = { ...hard, id: "different" };
  const switched = new Map(catalog).set(hard.id, wrongId);
  await assert.rejects(compareReaders(derived.id, switched, docs), /identity/);
});

test("comparison rejects ambiguous sentence boundaries, invalid labels and input beyond byte and question limits", async () => {
  const simple = { sentences: ["Good source."], questions: [["Why?", null]] };
  const testDocs = value => compareReaders(base.id, catalog, value);
  for (const sentences of [["a\nb"], ["a\rb"], ["a\u2028b"], ["a\u2029b"], [""], ["  "], [], Array(65).fill("x")]) {
    await assert.rejects(testDocs([{ ...simple, sentences }]), /sentence/);
  }
  for (const expected of [-2, 1, 0.5, "0", false, {}, undefined]) {
    await assert.rejects(testDocs([{ ...simple, questions: [["why", expected]] }]), /expected/);
  }
  await assert.rejects(testDocs([{ ...simple, sentences: ["x".repeat(6001)] }]), /6,000/);
  await assert.rejects(testDocs([{ ...simple, questions: [["x".repeat(501), -1]] }]), /500/);
  await assert.rejects(testDocs([{ ...simple, url: 9 }]), /text/);
  await assert.rejects(testDocs([{ ...simple, privateInstruction: "ignore passage" }]), /fields/);
  await assert.rejects(testDocs([{ ...simple, questions: [] }]), /one question/);
  const sixtyFour = { ...simple, questions: Array(64).fill(["why", null]) };
  assert.equal((await testDocs([sixtyFour])).cases.length, 64);
  await assert.rejects(testDocs([sixtyFour, simple]), /64 questions/);
  await assert.rejects(testDocs([{ ...simple, id: "é".repeat(MAX_COMPARISON_BYTES / 2) }]), /128 KiB/);
});

test("actual weights and plain-record identities are verified for every participant", async () => {
  for (const record of [derived, base, hard]) {
    const switched = structuredClone(record);
    switched.weights = structuredClone(record === hard ? base.weights : hard.weights);
    const current = new Map(catalog).set(record.id, switched);
    await assert.rejects(compareReaders(derived.id, current, docs), /different weights from its recorded hash/);
  }
  const changedId = { ...base, id: hard.id };
  await assert.rejects(compareReaders(hard.id, new Map([[hard.id, changedId]]), docs), /identity/);
});

test("an in-flight comparison retains the inputs and catalog entries selected before verification", async () => {
  const current = new Map([...catalog].map(([id, value]) => [id, structuredClone(value)]));
  const input = structuredClone(docs);
  const comparison = compareReaders(derived.id, current, input);
  current.get(derived.id).weights.intercept = 500;
  current.get(hard.id).name = "Late name change";
  current.get(base.id).weights = hard.weights;
  input[0].questions[0][0] = "Switched question";
  input[0].questions[0][1] = -1;
  input[0].sentences = ["New passage."];
  assert.deepEqual(await comparison, await compareReaders(derived.id, catalog, docs));
});
