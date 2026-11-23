import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { exportReader, importReader, modelRecord, sources } from "../model-workshop/catalog.js";
import { blendReaders, reviewEdit } from "../model-workshop/edit.js";
import { evaluate } from "../model-workshop/reader.js";

const load = name => JSON.parse(readFileSync(new URL(`../model-workshop/${name}.json`, import.meta.url)));
const base = await modelRecord(load("soft"), "Soft");
const second = await modelRecord(load("hard"), "Hard");
const evaluation = load("evaluation");
const review = options => reviewEdit({ base, name: "Edited", evaluation, evaluationHash: sources.evaluation, ...options });
const scalars = reader => [...reader.weights.flat(), ...reader.biases, ...reader.output, reader.intercept];

test("linear blending interpolates every numeric term, preserves parents and evaluates all three using the held-out corpus", async () => {
  const before = JSON.stringify([base, second]);
  for (const rightPercent of [1, 37, 50, 99]) {
    const weights = blendReaders(base.weights, second.weights, rightPercent);
    const actual = scalars(weights);
    const left = scalars(base.weights), right = scalars(second.weights);
    assert.equal(actual.length, 97);
    const share = rightPercent / 100;
    for (let i = 0; i < actual.length; i++) {
      const expected = left[i] + share * (right[i] - left[i]);
      assert.ok(Math.abs(actual[i] - expected) <= 4 * Number.EPSILON * Math.max(1, Math.abs(left[i]), Math.abs(right[i])));
    }
    const child = await review({ second, rightPercent, weights });
    assert.equal(child.run.recipe, "reader-linear-blend-v1");
    assert.equal(child.run.editedParameters, 0);
    assert.equal(child.run.rightPercent, rightPercent);
    assert.deepEqual(child.run.scores, {
      base: evaluate(base.weights, evaluation), second: evaluate(second.weights, evaluation),
      candidate: evaluate(weights, evaluation),
    });
    assert.equal(child.hash, (await modelRecord(weights, "Control")).hash);
    assert.notEqual(child.id, child.hash);
    weights.output[0] += 2;
    assert.notEqual(child.weights.output[0], weights.output[0]);
  }
  assert.equal(JSON.stringify([base, second]), before);
});

test("manual revisions count all scalar families relative to the starting draft and can parent a new build", async () => {
  const weights = structuredClone(base.weights);
  weights.weights[0][0] += 0.1;
  weights.biases[5] -= 0.5;
  weights.output[3] += 2;
  weights.intercept -= 0.25;
  const single = await review({ weights });
  assert.equal(single.run.editedParameters, 4);
  assert.equal(single.run.recipe, "reader-parameter-edit-v1");
  assert.ok(!("second" in single.run) && !("rightPercent" in single.run));
  assert.deepEqual(Object.keys(single.run.scores), ["base", "candidate"]);
  assert.deepEqual(single.run.base, { id: base.id, hash: base.hash, label: "Soft · " + base.hash.slice(0, 8) });
  const options = { base: single, second, rightPercent: 25 };
  const merged = blendReaders(single.weights, second.weights, 25);
  const unchanged = await review({ ...options, weights: merged });
  merged.intercept += 0.5;
  const manual = await review({ ...options, weights: merged });
  assert.equal(manual.run.editedParameters, 1);
  assert.notEqual(manual.id, unchanged.id);
  assert.equal(manual.run.base.id, single.id);
  assert.equal(manual.run.second.id, second.id);
  assert.equal(manual.run.evaluation, sources.evaluation);
  assert.equal(manual.run.scores.candidate.total, 16);
});

test("lineage binds ordered parent identities, recipe, mix, evaluation and final weights independent of labels", async () => {
  const weights = blendReaders(base.weights, second.weights, 50);
  const config = { second, weights, rightPercent: 50 };
  const child = await review(config);
  assert.deepEqual(await review(config), child);
  const renamed = await review({ ...config, name: "Elsewhere", base: { ...base, name: "Renamed parent" } });
  assert.equal(renamed.id, child.id);
  const variants = [
    await review({ ...config, base: { ...base, id: "older-generation" } }),
    await review({ ...config, second: { ...second, id: "other-lineage" } }),
    await review({ ...config, base: second, second: base }),
    await review({ ...config, rightPercent: 35 }),
    await review({ weights }),
  ];
  const differentCorpus = structuredClone(evaluation);
  differentCorpus[0].questions[0][0] += " Verify against the passage.";
  const evaluationHash = createHash("sha256").update(JSON.stringify(differentCorpus, null, 2) + "\n").digest("hex");
  variants.push(await review({ ...config, evaluation: differentCorpus, evaluationHash }));
  for (const record of variants) assert.equal(record.hash, child.hash);
  assert.equal(new Set([child, ...variants].map(r => r.id)).size, variants.length + 1);
  await assert.rejects(review({ ...config, evaluation: differentCorpus }), /evaluation differs/);
  await assert.rejects(review({ ...config, base: { ...base, weights: second.weights } }), /recorded hash differs/);
});

test("import restores the selected local build when identical weights have different parents", async () => {
  const weights = blendReaders(base.weights, second.weights, 50);
  const first = await review({ base: second, second: base, rightPercent: 50, weights });
  const next = await review({ second, rightPercent: 50, weights });
  assert.equal(first.hash, next.hash);
  assert.notEqual(first.id, next.id);
  const catalog = new Map([first, next].map(record => [record.id, record]));
  const uploaded = structuredClone(exportReader(next));
  assert.equal(uploaded.workshop.id, next.id);
  uploaded.workshop.name = "Foreign display name";
  const restore = raw => importReader(raw, "Uploaded reader", catalog);
  for (const source of [uploaded, exportReader(first)]) {
    const selected = await restore(source);
    assert.equal(selected, catalog.get(source.workshop.id));
    assert.equal(selected.run.base.label, source.workshop.run.base.label);
    assert.equal(selected.run.second.label, source.workshop.run.second.label);
  }
  const legacy = structuredClone(uploaded);
  delete legacy.workshop.id;
  legacy.workshop.run = Object.fromEntries(Object.entries(legacy.workshop.run).reverse());
  assert.equal(await restore(legacy), next);

  const foreign = { ...uploaded.workshop, id: "unknown-local-build" };
  const wrongRun = { ...uploaded.workshop, id: first.id };
  const wrongScore = structuredClone(uploaded.workshop);
  wrongScore.run.scores.candidate.correct++;
  const wrongHash = { ...uploaded.workshop, weightsSHA256: base.hash };
  const missingRun = { ...uploaded.workshop, run: null };
  const partialLegacy = { weightsSHA256: next.hash, run: { base: next.run.base } };
  const canonical = await modelRecord(weights, "Uploaded reader");
  for (const workshop of [undefined, foreign, wrongRun, wrongScore, wrongHash, missingRun, partialLegacy]) {
    assert.deepEqual(await restore({ ...weights, workshop }), canonical);
  }
  const changed = { ...uploaded, intercept: uploaded.intercept + 1 };
  assert.deepEqual(await restore(changed), await modelRecord(changed, "Uploaded reader"));
  const reassigned = { ...next, id: "another-local-id-for-the-same-run" };
  catalog.set(reassigned.id, reassigned);
  assert.deepEqual(await restore(legacy), canonical);
  catalog.set(canonical.id, canonical);
  assert.equal(await restore({ ...weights, workshop: foreign }), canonical);
  assert.equal(await restore(exportReader(canonical)), canonical);
  assert.equal(await restore(uploaded), next);
});

test("invalid, sparse, ambiguous or unchanged builds cannot produce candidates", async () => {
  for (const percent of [0, 100, -1, 15.5, "50", NaN, Infinity]) {
    assert.throws(() => blendReaders(base.weights, second.weights, percent), /whole second-parent percentage/);
  }
  assert.throws(() => blendReaders(base.weights, structuredClone(base.weights), 50), /different weights/);
  const malformed = structuredClone(second.weights);
  malformed.weights = Array(8);
  assert.throws(() => blendReaders(base.weights, malformed, 51), /97 finite/);
  await assert.rejects(review({ weights: { ...base.weights, intercept: 1e6 + 1 } }), /compatible/);
  await assert.rejects(review({ weights: base.weights }), /matches its base/);
  await assert.rejects(review({ second, rightPercent: 65, weights: second.weights }), /matches a parent/);
  await assert.rejects(review({ second: { ...second, id: base.id }, rightPercent: 25, weights: second.weights }),
    /distinct parent identities/);
  await assert.rejects(review({ rightPercent: 15, weights: base.weights }), /Choose a second parent/);
  await assert.rejects(review({ name: " ", weights: base.weights }), /candidate a name/);
  await assert.rejects(review({ evaluation: [], weights: base.weights }), /nonempty/);
  await assert.rejects(review({ evaluation: [{ sentences: ["A"], questions: [["Where?", 1]] }], weights: base.weights }),
    /Invalid question/);
  // Both parents have legal weights; rounding a tiny difference at 1% can reproduce one parent exactly.
  const left = await modelRecord({ ...base.weights, intercept: 0 }, "Left");
  const right = await modelRecord({ ...base.weights, intercept: Number.MIN_VALUE }, "Right");
  const draft = blendReaders(left.weights, right.weights, 1);
  await assert.rejects(review({ base: left, second: right, rightPercent: 1, weights: draft }), /matches a parent/);
});
