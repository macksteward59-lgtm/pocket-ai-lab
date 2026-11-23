import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { modelRecord, sources } from "../model-workshop/catalog.js";
import { createDraft, restoreDraft } from "../model-workshop/draft.js";
import { reviewEdit } from "../model-workshop/edit.js";

const asset = key => JSON.parse(readFileSync(new URL(`../model-workshop/${key}.json`, import.meta.url)));
const raw = await modelRecord(asset("soft"), "Soft"), other = await modelRecord(asset("hard"), "Hard");
const editedWeights = structuredClone(raw.weights);
editedWeights.intercept += 1;
const makeEdited = source => reviewEdit({ base: source, name: "Edited", weights: editedWeights,
  evaluation: asset("evaluation"), evaluationHash: sources.evaluation });
const child = await makeEdited(raw), alias = await makeEdited(other);
const catalog = new Map([raw, other, child, alias].map(record => [record.id, record]));
const ref = record => ({ id: record.id, hash: record.hash });
const form = {
  method: "blend", base: ref(child), second: ref(other), rightPercent: 33, name: "  Work in progress ",
  editorText: '{\n  "weights": [  ', parameterKey: "weights.7.9", parameterText: "1e-", parameterPending: true,
};
const edit = { ...form, method: "edit", base: ref(raw), second: null, rightPercent: null };

test("snapshots preserve incomplete JSON, pending numeric text, selected parents and exact whitespace", async () => {
  const before = JSON.stringify([...catalog.values()]);
  const data = structuredClone(form);
  const record = await createDraft(data, catalog);
  assert.deepEqual(record, { ...form, format: "pocket-reader-draft-v1", id: record.id });
  assert.match(record.id, /^draft-[a-f0-9]{64}$/);
  assert.ok(Object.isFrozen(record) && Object.isFrozen(record.base) && Object.isFrozen(record.second));
  const incoming = structuredClone(record);
  assert.deepEqual(await restoreDraft(incoming, catalog), record);
  data.base.id = alias.id;
  incoming.second.hash = raw.hash;
  assert.equal(record.base.id, child.id);
  assert.equal(record.second.hash, other.hash);
  assert.equal(JSON.stringify([...catalog.values()]), before);
});

test("equivalent snapshots deduplicate, while each meaningful change including pending state changes the ID", async () => {
  const snapshot = await createDraft(form, catalog);
  const reordered = Object.fromEntries(Object.entries(form).reverse());
  reordered.base = { hash: child.hash, id: child.id };
  assert.equal((await createDraft(reordered, catalog)).id, snapshot.id);
  const variants = [
    { name: "" }, { name: " " }, { rightPercent: 34 }, { editorText: form.editorText + " " },
    { parameterPending: false }, { parameterKey: "intercept" }, { parameterText: "-" }, { base: ref(alias) },
  ];
  const ids = await Promise.all(variants.map(change => createDraft({ ...form, ...change }, catalog).then(s => s.id)));
  assert.equal(new Set([snapshot.id, ...ids]).size, variants.length + 1);
  const empty = await createDraft({ ...edit, name: "", editorText: "", parameterKey: "",
    parameterText: "", parameterPending: false }, catalog);
  assert.equal((await restoreDraft(empty, catalog)).editorText, "");
});

test("changed fields, missing parents, same-weight aliases and altered build metadata are never substituted", async () => {
  const record = await createDraft(form, catalog);
  assert.equal(child.hash, alias.hash);
  assert.notEqual(child.id, alias.id);
  const absent = new Map(catalog);
  absent.delete(child.id);
  await assert.rejects(restoreDraft(record, absent), /missing|identity/);
  for (const change of [{ base: ref(alias) }, { parameterText: "2" }, { editorText: "{}" }, { name: "" },
    { parameterPending: false }, { rightPercent: 77 }]) {
    await assert.rejects(restoreDraft({ ...record, ...change }, catalog), /snapshot ID/);
  }
  const changedWeights = new Map(catalog).set(child.id, { ...child, weights: raw.weights });
  await assert.rejects(restoreDraft(record, changedWeights), /different weights/);
  const wrongBuild = new Map(catalog).set(child.id, { ...child, run: alias.run });
  await assert.rejects(restoreDraft(record, wrongBuild), /build identity/);
  const changedName = new Map(catalog).set(child.id, { ...child, name: "A local display alias" });
  assert.deepEqual(await restoreDraft(record, changedName), record);
});

test("invalid editor state and unrelated fields cannot become a draft", async () => {
  for (const change of [
    { method: "train" }, { second: ref(child) }, { second: null }, { second: ref(alias) },
    { base: { ...ref(child), weights: child.weights } }, { second: { ...ref(other), hash: raw.hash } },
    { rightPercent: 0 }, { rightPercent: 99.1 }, { name: "x".repeat(65) }, { name: "two\nlines" },
    { editorText: "x".repeat(65537) }, { parameterKey: "biases.8" }, { parameterKey: "weights.3.10" },
    { parameterKey: "" }, { parameterText: "x".repeat(129) }, { parameterText: "12\r34" },
    { parameterPending: "true" }, { passage: "unrelated" }, { scores: {} }, { question: "unrelated" },
    { ready: true }, { chat: [] },
  ]) {
    await assert.rejects(createDraft({ ...form, ...change }, catalog));
  }
  await assert.rejects(createDraft({ ...edit, second: ref(other) }, catalog), /single-parent/);
  await assert.rejects(createDraft({ ...edit, rightPercent: 40 }, catalog), /single-parent/);
  const record = await createDraft({ ...edit, editorText: " ".repeat(65536), parameterKey: "output.7" }, catalog);
  assert.equal((await restoreDraft(record, catalog)).editorText.length, 65536);
  await assert.rejects(restoreDraft({ ...record, format: "v2" }, catalog), /supported/);
  await assert.rejects(restoreDraft({ ...record, scores: [] }, catalog), /supported/);
});

test("saving and restoring capture state before WebCrypto yields", async () => {
  const input = structuredClone(form), local = new Map([...catalog].map(([id, record]) => [id, structuredClone(record)]));
  const original = await createDraft(form, catalog);
  const first = createDraft(input, local);
  input.editorText = "changed";
  input.base.hash = other.hash;
  local.get(child.id).weights.output[0]++;
  assert.deepEqual(await first, original);
  const toRestore = structuredClone(original);
  const second = restoreDraft(toRestore, catalog);
  toRestore.id = "draft-" + "a".repeat(64);
  toRestore.base.id = other.id;
  assert.deepEqual(await second, original);
});
