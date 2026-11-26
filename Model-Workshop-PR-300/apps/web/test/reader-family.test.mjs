import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { modelRecord, sources } from "../model-workshop/catalog.js";
import { blendReaders, reviewEdit } from "../model-workshop/edit.js";
import { exportFamily, FAMILY_MAX_BYTES, FAMILY_MAX_READERS, inspectFamily, trainingBuildId } from "../model-workshop/family.js";
import { evaluate, recipe, train } from "../model-workshop/reader.js";

const asset = name => JSON.parse(readFileSync(new URL(`../model-workshop/${name}.json`, import.meta.url)));
const corpora = { training: asset("training"), evaluation: asset("evaluation") };
const hard = await modelRecord(asset("hard"), "Hard");
const soft = await modelRecord(asset("soft"), "Soft");
const ref = r => ({ id: r.id, hash: r.hash, label: r.name + " · " + r.hash.slice(0, 8) });

async function trainingFixture(base, teacher) {
  const trained = train(base.weights, teacher.weights, corpora.training);
  const candidate = await modelRecord(trained.weights, "Trained");
  const scores = { base: evaluate(base.weights, corpora.evaluation), teacher: evaluate(teacher.weights, corpora.evaluation),
    candidate: evaluate(candidate.weights, corpora.evaluation) };
  // Match historical IDs as they existed before portable ancestry was implemented.
  const key = [recipe, base.id, teacher.id, sources.training, sources.evaluation, candidate.hash];
  const id = "build-" + createHash("sha256").update(JSON.stringify(key)).digest("hex");
  assert.equal(await trainingBuildId(base.id, teacher.id, candidate.hash), id);
  return { ...candidate, id, run: { recipe, base: ref(base), teacher: ref(teacher), training: sources.training,
    evaluation: sources.evaluation, verifiedPairs: trained.verifiedPairs, scores } };
}

const trained = await trainingFixture(soft, hard);
const editedWeights = structuredClone(trained.weights);
editedWeights.output[0] += 0.1;
const edited = await reviewEdit({ base: trained, weights: editedWeights, name: "After training",
  evaluation: corpora.evaluation, evaluationHash: sources.evaluation });
const blended = await reviewEdit({ base: edited, second: hard, weights: blendReaders(edited.weights, hard.weights, 39),
  rightPercent: 39, name: "Mixed family", evaluation: corpora.evaluation, evaluationHash: sources.evaluation });
const unrelated = await modelRecord({ ...hard.weights, intercept: 9 }, "Unrelated");
const all = new Map([hard, soft, trained, edited, blended, unrelated].map(r => [r.id, r]));
const bundle = exportFamily(blended.id, all);

test("family round trip contains only reachable ancestors, deduplicates shared parents and ignores array order", async () => {
  assert.equal(bundle.format, "pocket-reader-family-v1");
  assert.deepEqual(bundle.readers.map(x => x.id), [soft.id, hard.id, trained.id, edited.id, blended.id]);
  const shuffled = structuredClone(bundle);
  shuffled.readers.reverse();
  const parsed = await inspectFamily(shuffled, corpora);
  assert.equal(parsed.root, blended.id);
  assert.deepEqual(parsed.differences, []);
  assert.deepEqual(parsed.records, [soft, hard, trained, edited, blended]);
  assert.deepEqual(exportFamily(parsed.root, new Map(parsed.records.map(x => [x.id, x]))), bundle);
  for (const r of parsed.records) assert.notEqual(r.weights, all.get(r.id).weights);
  parsed.records[0].weights.intercept++;
  assert.equal(all.get(soft.id).weights.intercept, soft.weights.intercept);
  assert.notEqual(parsed.records[0].weights.intercept, soft.weights.intercept);
});

test("an imported plain reader can be the root without making a history claim or loading corpora", async () => {
  const renamed = { ...unrelated, name: "  My imported reader  ", origin: "private UI metadata" };
  const plain = exportFamily(renamed.id, new Map([[renamed.id, renamed]]));
  assert.deepEqual(Object.keys(plain.readers[0]).sort(), ["hash", "id", "name", "weights"]);
  const result = await inspectFamily(plain);
  assert.equal(result.records[0].name, "My imported reader");
  assert.equal(result.records[0].run, undefined);
  assert.equal(result.root, unrelated.hash);
});

test("export sanitizes older local names and prevents nested unsupported metadata from leaving the catalog", () => {
  const catalog = new Map(all);
  catalog.set(hard.id, { ...hard, name: "\t\n " });
  const result = exportFamily(blended.id, catalog);
  assert.equal(result.readers.find(r => r.id === hard.id).name, "Unnamed reader");
  assert.equal(result.readers.at(-1).run.second.label, "Unnamed reader · " + hard.hash.slice(0, 8));
  const extra = structuredClone(blended);
  extra.run.scores.candidate.unrelatedText = "extra content outside the recipe";
  catalog.set(extra.id, extra);
  assert.throws(() => exportFamily(extra.id, catalog), /fields/);
  delete extra.run.scores.candidate.unrelatedText;
  extra.run.scores.candidate.correct = "bad score";
  assert.throws(() => exportFamily(extra.id, catalog), /score/);
  extra.run.scores = blended.run.scores;
  extra.run.rightPercent = { unrelatedText: "extra content outside the recipe" };
  assert.throws(() => exportFamily(extra.id, catalog), /percentage/);
});

test("validation rederives parent labels and never mutates the package or its local source catalog", async () => {
  const input = structuredClone(bundle);
  const item = input.readers.find(x => x.id === blended.id);
  item.run.second.label = "Someone else’s reader";
  input.readers.find(x => x.id === hard.id).name = " Local hard alias ";
  const before = JSON.stringify(input);
  const result = await inspectFamily(input, corpora);
  const alias = "Local hard alias · " + hard.hash.slice(0, 8);
  assert.equal(result.records.find(x => x.id === trained.id).run.teacher.label, alias);
  assert.equal(result.records.at(-1).run.second.label, alias);
  assert.equal(JSON.stringify(input), before);
  assert.equal(hard.name, "Hard");
});

test("incomplete, disconnected, duplicate, cyclic or oversized families fail import and incomplete exports fail", async () => {
  const cases = [
    [input => { input.root = unrelated.id; }, /missing/],
    [input => { input.readers = input.readers.filter(r => r.id !== hard.id); }, /missing/],
    [input => { input.readers.push(unrelated); }, /unrelated/],
    [input => { input.readers.push(input.readers[0]); }, /Duplicate/],
    [input => { input.readers.at(-1).run.base = ref(blended); }, /cycle/],
    [input => { input.readers = Array(FAMILY_MAX_READERS + 1).fill(hard); }, /1–64/],
    [input => { input.readers[0].name = "é".repeat(FAMILY_MAX_BYTES / 2); }, /512 KiB/],
    [input => { input.readers[0].name = "bad\nname"; }, /name/],
    [input => { input.readers[0].weights.unexpected = "unsupported"; }, /fields/],
    [input => { input.readers.at(-1).run.extra = 0; }, /fields/],
    [input => { input.readers.at(-1).run.recipe = "unknown"; }, /recipe/],
  ];
  for (const [change, reason] of cases) {
    const input = structuredClone(bundle);
    change(input);
    await assert.rejects(inspectFamily(input, corpora), reason);
  }
  assert.throws(() => exportFamily(edited.id, new Map([[edited.id, edited]])), /missing/);
});

test("pinned input hashes, actual parent hashes, score totals, ID, edit counts and verified teacher examples are checked", async () => {
  const edit = input => input.readers.find(x => x.id === edited.id);
  const training = input => input.readers.find(x => x.id === trained.id);
  const invalid = [
    [input => { edit(input).run.base.hash = unrelated.hash; }, /parent weight hash/],
    [input => { edit(input).weights.intercept += 0.01; }, /recorded hash/],
    [input => { input.readers[0].weights.output[2] = null; }, /compatible/],
    [input => { edit(input).run.scores.base.correct = 17; }, /held-out score/],
    [input => { edit(input).run.scores.base.correct = 0.5; }, /held-out score/],
    [input => { edit(input).run.editedParameters++; }, /edited-parameter/],
    [input => { training(input).run.training = sources.soft; }, /pinned workshop/],
    [input => { training(input).run.verifiedPairs = 1e6; }, /teacher example count/],
    [input => { training(input).run.verifiedPairs = -1; }, /teacher example count/],
    [input => { training(input).run.scores.candidate.total--; }, /held-out score/],
    [input => { training(input).run.teacher = training(input).run.base; }, /distinct parents/],
    [input => {
      const root = input.readers.at(-1);
      root.run.rightPercent = 42;
      root.run.editedParameters = 97;
    }, /identity|edited-parameter/],
    [input => { input.readers.at(-1).id = input.root = "build-" + "b".repeat(64); }, /identity/],
  ];
  for (const [change, reason] of invalid) {
    const input = structuredClone(bundle);
    change(input);
    await assert.rejects(inspectFamily(input, corpora), reason);
  }
  await assert.rejects(inspectFamily(bundle, { ...corpora, evaluation: [] }), /local verification corpus/);
  await assert.rejects(inspectFamily(bundle, { ...corpora, training: [] }), /local verification corpus/);
});

test("in-range source measurements are compared and replaced with this engine’s own metrics", async () => {
  const packageCopy = structuredClone(bundle);
  const original = structuredClone(packageCopy);
  const teacherRun = packageCopy.readers.find(entry => entry.id === trained.id).run;
  const blendRun = packageCopy.readers.find(entry => entry.id === blended.id).run;
  teacherRun.verifiedPairs = 0;
  teacherRun.scores.teacher.correct = 0;
  blendRun.scores.candidate.correct = 0;
  const { records, differences } = await inspectFamily(packageCopy, corpora);
  assert.deepEqual(differences, [
    { id: trained.id, field: "verifiedPairs", reported: 0, local: trained.run.verifiedPairs },
    { id: trained.id, field: "scores.teacher.correct", reported: 0, local: trained.run.scores.teacher.correct },
    { id: blended.id, field: "scores.candidate.correct", reported: 0, local: blended.run.scores.candidate.correct },
  ]);
  assert.deepEqual(exportFamily(blended.id, new Map(records.map(r => [r.id, r]))), original);
  assert.equal(teacherRun.verifiedPairs, 0);
});

test("checking transferred weights does not require the local teacher to qualify for a new training run", async () => {
  const teacher = await modelRecord({ ...hard.weights, intercept: -1e6 }, "Always abstains here");
  assert.throws(() => train(soft.weights, teacher.weights, corpora.training), /both supported and missing/);
  const candidate = {
    ...trained, id: await trainingBuildId(soft.id, teacher.id, trained.hash),
    run: { ...trained.run, teacher: ref(teacher), verifiedPairs: 0 },
  };
  const family = exportFamily(candidate.id, new Map([soft, teacher, candidate].map(r => [r.id, r])));
  assert.equal(family.readers.at(-1).run.verifiedPairs, 0);
  const received = await inspectFamily(family, corpora);
  const local = received.records.at(-1);
  assert.equal(local.id, candidate.id);
  assert.deepEqual(local.weights, candidate.weights);
  assert.ok(local.run.verifiedPairs > 0);
  assert.ok(received.differences.some(d => d.field === "verifiedPairs" && d.local === local.run.verifiedPairs));
  const again = exportFamily(local.id, new Map(received.records.map(r => [r.id, r])));
  assert.deepEqual((await inspectFamily(again, corpora)).differences, []);
});

test("the reproduced V8/Qt threshold reader keeps its exact weights and the receiver’s observed score", async () => {
  const weights = structuredClone(hard.weights);
  weights.weights.forEach(row => row.fill(0));
  weights.biases.fill(0);
  weights.output.fill(0);
  weights.biases[0] = -0.155;
  weights.output[0] = 524288;
  weights.intercept = 80620.03957679663;
  const threshold = await reviewEdit({ base: hard, weights, name: "Threshold fixture",
    evaluation: corpora.evaluation, evaluationHash: sources.evaluation });
  const local = evaluate(weights, corpora.evaluation).correct;
  // The constant predictor either abstains (8/16 in V8) or selects sentence zero (4/16 in Qt 5.15).
  assert.ok(local === 8 || local === 4);
  const reported = local === 8 ? 4 : 8;
  const family = exportFamily(threshold.id, new Map([hard, threshold].map(r => [r.id, r])));
  family.readers.at(-1).run.scores.candidate.correct = reported;
  const received = await inspectFamily(family, corpora);
  assert.deepEqual(received.differences, [{ id: threshold.id, field: "scores.candidate.correct", reported, local }]);
  assert.deepEqual(received.records.at(-1), threshold);
});
