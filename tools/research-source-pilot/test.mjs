import assert from "node:assert/strict";
import test from "node:test";
import { readFile, mkdtemp, rm, cp, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { modelRecord } from "../../apps/web/model-workshop/catalog.js";
import { compareReaders } from "../../apps/web/model-workshop/compare.js";
import { readPassage } from "../../apps/web/model-workshop/reader.js";
import { HERE, ROOT, loadFrozen, evaluateFrozen } from "./evaluate.mjs";
import { canonical, sha256, validateCorpus, toWorkshop, citationFor } from "./validate.mjs";

const TRUSTED_FREEZE = "1ce55de2ac1227914b99335f124fa874afe7ef6591b71a917f51f137a6ff9d06";
const { corpus, suite, baseline } = await loadFrozen(TRUSTED_FREEZE);
const clone = x => structuredClone(x);

test("frozen labels resolve to exactly 24 cases, 14 supported and 10 abstentions", () => {
  assert.equal(suite.cases.length, 24);
  assert.equal(suite.cases.filter(c => c.kind === "supported").length, 14);
  assert.equal(corpus.sources.length, 4);
  assert.equal(corpus.training_sources.length, 0);
  assert.equal(validateCorpus(corpus, suite).families.size, 4);
  assert.equal(toWorkshop(corpus, suite).reduce((n, d) => n + d.questions.length, 0), 24);
});

test("gold labels never change actual workshop predictions", async () => {
  const model = await modelRecord(JSON.parse(await readFile(path.join(ROOT, "apps/web/model-workshop/hard.json"))), "Pinned hard");
  const docs = toWorkshop(corpus, suite), hidden = clone(docs), changed = clone(docs);
  for (const doc of hidden) for (const q of doc.questions) q[1] = null;
  for (const doc of changed) for (const q of doc.questions) q[1] = q[1] === -1 ? 0 : -1;
  const catalog = new Map([[model.id, model]]);
  const run = async d => (await compareReaders(model.id, catalog, d)).cases.map(c => c.results);
  assert.deepEqual(await run(docs), await run(hidden));
  assert.deepEqual(await run(docs), await run(changed));
});

test("source families cannot cross training and evaluation under different source IDs", () => {
  const value = clone(corpus);
  value.training_sources.push({ id: "alien-summary-v1", family: "alien-space-of-science", split: "training" });
  assert.throws(() => validateCorpus(value, suite), /split leakage/);
});

test("source identity cannot cross splits under an aliased family or duplicate training record", () => {
  const value = clone(corpus);
  value.training_sources.push({ id: "alien-v3", family: "aliased-training-family", split: "training" });
  assert.throws(() => validateCorpus(value, suite), /Source ID appears in training/);
  value.training_sources[0].id = "new-training-id";
  value.training_sources.push(clone(value.training_sources[0]));
  assert.throws(() => validateCorpus(value, suite), /Duplicate training/);
});

test("case and note identities cannot be duplicated or rebound to another source", () => {
  let value = clone(suite); value.cases.push(clone(value.cases[0]));
  assert.throws(() => validateCorpus(corpus, value), /Duplicate case/);
  value = clone(suite); value.cases[0].source_id = "phantom-b-v1";
  assert.throws(() => validateCorpus(corpus, value), /own source/);
  const sources = clone(corpus); sources.sources[1].notes[0].id = sources.sources[0].notes[0].id;
  assert.throws(() => validateCorpus(sources, suite), /Duplicate note/);
});

test("ambiguous lines, excessive input and false provenance are rejected", () => {
  for (const update of [
    n => { n.text += "\nSecond line"; }, n => { n.text = "x".repeat(6001); },
    n => { n.text += "\ud800"; }, n => { n.provenance = "pocket_verified"; },
  ]) {
    const value = clone(corpus); update(value.sources[0].notes[0]);
    assert.throws(() => validateCorpus(value, suite));
  }
  const value = clone(suite); value.cases[0].expected_note_id = true;
  assert.throws(() => validateCorpus(corpus, value), /own source/);
});

test("source version, author, locator and note bytes each affect citation identity", () => {
  const source = corpus.sources[0], note = source.notes[0], original = citationFor(source, note);
  for (const update of [
    s => { s.version += " altered"; }, s => { s.authors[0] = "Wrong author"; },
    s => { s.notes[0].locator = "Wrong page"; }, s => { s.notes[0].text += " altered"; },
  ]) {
    const changed = clone(source); update(changed);
    assert.notEqual(citationFor(changed, changed.notes[0]).source_record_sha256, original.source_record_sha256);
  }
  assert.equal(original.note_sha256, sha256(note.text));
  assert.equal(original.source_record_sha256, sha256(canonical(source)));
});

test("a changed file cannot be accepted under the independently retained freeze", async t => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "pocket-source-freeze-"));
  t.after(() => rm(tmp, { recursive: true, force: true }));
  await cp(HERE, tmp, { recursive: true });
  const value = clone(corpus); value.sources[0].version += " changed";
  await writeFile(path.join(tmp, "sources.json"), JSON.stringify(value));
  await assert.rejects(loadFrozen(TRUSTED_FREEZE, tmp), /Frozen file digest mismatch/);
  const manifest = JSON.parse(await readFile(path.join(tmp, "freeze.json")));
  manifest.files["sources.json"] = sha256(await readFile(path.join(tmp, "sources.json")));
  await writeFile(path.join(tmp, "freeze.json"), JSON.stringify(manifest));
  await assert.rejects(loadFrozen(TRUSTED_FREEZE, tmp), /Freeze digest mismatch/);
});

test("changed reader code is rejected before evaluation", async t => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "pocket-source-baseline-"));
  t.after(() => rm(tmp, { recursive: true, force: true }));
  for (const entry of baseline.files) {
    const output = path.join(tmp, entry.path);
    await cp(path.join(ROOT, entry.path), output, { recursive: true });
  }
  await writeFile(path.join(tmp, "apps/web/model-workshop/reader.js"), "throw Error('changed');\n");
  await assert.rejects(loadFrozen(TRUSTED_FREEZE, HERE, tmp), /Pinned baseline changed/);
});

test("CLI preflight rejects changed baseline code before its top-level module can execute", async t => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "pocket-source-preflight-"));
  t.after(() => rm(tmp, { recursive: true, force: true }));
  for (const entry of baseline.files) await cp(path.join(ROOT, entry.path), path.join(tmp, entry.path), { recursive: true });
  await cp(HERE, path.join(tmp, "tools/research-source-pilot"), { recursive: true });
  await writeFile(path.join(tmp, "apps/web/model-workshop/reader.js"), "throw Error('BASELINE_EXECUTED_BEFORE_VERIFICATION');\n");
  assert.throws(() => execFileSync(process.execPath,
    [path.join(tmp, "tools/research-source-pilot/evaluate.mjs"), TRUSTED_FREEZE, path.join(tmp, "output")],
    { encoding: "utf8", stdio: "pipe" }), error => {
      assert.equal(error.status, 1);
      assert.match(error.stderr, /Pinned baseline changed/);
      assert.doesNotMatch(error.stderr, /BASELINE_EXECUTED_BEFORE_VERIFICATION/);
      return true;
    });
});

test("workshop-compatible export and repeated reports preserve exact inputs and decisions", async t => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "pocket-source-replay-"));
  t.after(() => rm(tmp, { recursive: true, force: true }));
  const first = await evaluateFrozen(TRUSTED_FREEZE, path.join(tmp, "first"));
  const second = await evaluateFrozen(TRUSTED_FREEZE, path.join(tmp, "second"));
  assert.equal(first.report_sha256, second.report_sha256);
  const exported = JSON.parse(await readFile(path.join(tmp, "first/workshop-comparison.json")));
  assert.deepEqual(exported, toWorkshop(corpus, suite));
  const model = await modelRecord(JSON.parse(await readFile(path.join(ROOT, "apps/web/model-workshop/soft.json"))), "Pinned soft");
  const result = await compareReaders(model.id, new Map([[model.id, model]]), exported);
  assert.equal(result.cases.length, 24);
  for (const item of result.cases) {
    const actual = readPassage(model.weights, item.question, item.passage);
    assert.equal(actual.index, item.results[0].index);
    assert.equal(actual.answer, item.results[0].answer);
  }
});

test("citation binding is separate from supported selection and abstention", async t => {
  const tmp = await mkdtemp(path.join(os.tmpdir(), "pocket-source-metrics-"));
  t.after(() => rm(tmp, { recursive: true, force: true }));
  const { report } = await evaluateFrozen(TRUSTED_FREEZE, tmp);
  for (const model of report.models) {
    const metric = report.metrics[model.key];
    assert.equal(metric.supported.total, 14); assert.equal(metric.abstention.total, 10);
    const answered = report.cases.filter(c => c.outputs.find(o => o.model_key === model.key).decision === "answer");
    assert.equal(metric.citation_integrity.total, answered.length);
    for (const item of answered) {
      const output = item.outputs.find(o => o.model_key === model.key);
      const source = corpus.sources.find(s => s.id === item.source_id);
      const note = source.notes.find(n => n.id === output.selected_note_id);
      assert.deepEqual(output.citation, citationFor(source, note));
    }
  }
});
