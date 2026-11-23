import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { chromium, webkit } from "playwright";
import { createServer } from "../../apps/web/server.mjs";
import { evaluate } from "../../apps/web/model-workshop/reader.js";

const mobile = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };
const fixture = name => readFile(new URL("../../apps/web/model-workshop/" + name + ".json", import.meta.url), "utf8");
const sha256 = text => createHash("sha256").update(text).digest("hex");
const parameterValues = model => [...model.weights.flat(), ...model.biases, ...model.output, model.intercept];

async function openWorkshop(page, url) {
  await page.goto(url);
  await page.locator("#mobile-menu").click();
  await page.locator('[data-view="models"]').click();
  await page.locator("#reader-method:enabled").waitFor();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
}

async function exportReader(page, id) {
  await page.locator("#reader-use").selectOption(id);
  const download = page.waitForEvent("download");
  await page.locator("#reader-export").click();
  const { workshop, ...weights } = JSON.parse(await readFile(await (await download).path(), "utf8"));
  assert.equal(workshop.id, id);
  assert.equal(sha256(JSON.stringify(weights)), workshop.weightsSHA256);
  return { id, weights, workshop };
}

async function uploadReader(page, name, payload) {
  await page.locator("#reader-import").setInputFiles({
    name: name + ".json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(payload))
  });
}

async function importParent(page, file, name, offset) {
  const weights = JSON.parse(await fixture(file));
  // Distinct, valid import files keep the bundled copies in the catalog for comparison.
  weights.intercept += offset;
  await uploadReader(page, name, weights);
  await page.locator("#reader-status").filter({ hasText: "Imported: " + name }).waitFor();
  const id = await page.locator("#reader-use").inputValue();
  const result = await exportReader(page, id);
  assert.deepEqual(result.weights, weights);
  assert.equal(result.workshop.name, name);
  assert.equal(id, result.workshop.weightsSHA256);
  return result;
}

async function storedIds(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const open = indexedDB.open("pocket-ai-lab-document-readers", 1);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const keys = db.transaction("readers").objectStore("readers").getAllKeys();
      keys.onerror = () => { db.close(); reject(keys.error); };
      keys.onsuccess = () => { db.close(); resolve(keys.result.sort()); };
    };
  }));
}

function assertBlendWeights(actual, left, right) {
  assert.equal(actual.version, left.version);
  assert.deepEqual(actual.features, left.features);
  assert.deepEqual(actual.weights.map(row => row.length), left.weights.map(row => row.length));
  assert.equal(actual.biases.length, left.biases.length);
  assert.equal(actual.output.length, left.output.length);
  const values = parameterValues(actual), a = parameterValues(left), b = parameterValues(right);
  assert.equal(values.length, 97);
  for (const [i, value] of values.entries()) {
    const expected = 0.65 * a[i] + 0.35 * b[i];
    assert.ok(Math.abs(value - expected) <= 1e-12 * Math.max(1, Math.abs(expected)), "blend parameter " + i);
  }
}

function ref(parent) {
  const { name, weightsSHA256: hash } = parent.workshop;
  return { id: parent.id, hash, label: name + " · " + hash.slice(0, 8) };
}

async function compare(page, models, corpus) {
  await page.locator("#reader-train").click();
  await page.locator("#reader-comparison").waitFor();
  const scores = {};
  for (const [role, { name, weights }] of Object.entries(models)) {
    const score = evaluate(weights, corpus);
    scores[role] = score;
    await page.locator("#reader-scores").getByText(
      role + " · " + name + " · " + score.correct + "/" + score.total, { exact: true }
    ).waitFor();
  }
  assert.equal(await page.locator("#reader-scores li").count(), Object.keys(scores).length);
  return scores;
}

async function save(page) {
  await page.locator("#reader-save").click();
  await page.locator("#reader-status").filter({ hasText: "is saved" }).waitFor();
  return exportReader(page, await page.locator("#reader-use").inputValue());
}

for (const engine of [chromium, webkit]) {
  test(engine.name() + " edits an imported reader, blends two imports, and reuses the saved child offline",
    { timeout: 90000 }, async t => {
      const dir = await mkdtemp(path.join(tmpdir(), "pocket-reader-edit-"));
      const profile = path.join(dir, "profile");
      const previous = process.env.POCKET_MEMORY_DIR;
      process.env.POCKET_MEMORY_DIR = path.join(dir, "memory");
      const server = createServer();
      let browser;
      t.after(async () => {
        await browser?.close();
        if (server.listening) {
          const closed = once(server, "close");
          server.close();
          server.closeAllConnections();
          await closed;
        }
        if (previous === undefined) delete process.env.POCKET_MEMORY_DIR;
        else process.env.POCKET_MEMORY_DIR = previous;
        await rm(dir, { recursive: true, force: true });
      });
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      const url = "http://127.0.0.1:" + server.address().port;
      let chatRequests = 0;
      server.on("request", req => { if (req.url === "/api/chat") chatRequests++; });
      const memory = async () => (await (await fetch(url + "/api/memory")).json()).entries;
      const evaluationText = await fixture("evaluation"), corpus = JSON.parse(evaluationText);
      browser = await engine.launchPersistentContext(profile, mobile);
      let page = browser.pages()[0] ?? await browser.newPage();
      await openWorkshop(page, url);
      const left = await importParent(page, "soft", "Pocket left", 0.001);
      const right = await importParent(page, "hard", "Pocket right", -0.002);
      const imports = [left.id, right.id].sort();
      const editor = page.locator("#reader-editor"), name = page.locator("#reader-name");
      const method = page.locator("#reader-method"), base = page.locator("#reader-base");
      await base.selectOption(left.id);
      await method.selectOption("edit");
      assert.deepEqual(JSON.parse(await editor.inputValue()), left.weights);
      const editName = "Edited reader", edited = structuredClone(left.weights);
      edited.weights[0][0] += 0.125;
      await name.fill(editName);
      await editor.fill("{");
      await page.locator("#reader-train").click();
      await page.locator("#reader-status").filter({ hasText: "valid JSON" }).waitFor();
      assert.ok(await page.locator("#reader-save").isDisabled());
      assert.deepEqual(await storedIds(page), imports);
      await page.locator("#reader-editor-reset").click();
      const parameter = page.locator("#reader-parameter"), value = page.locator("#reader-value");
      assert.equal(await parameter.locator("option").count(), 97);
      await parameter.selectOption("weights.0.0");
      assert.equal(Number(await value.inputValue()), left.weights.weights[0][0]);
      await value.fill(String(edited.weights[0][0]));
      assert.ok(await page.locator("#reader-train").isDisabled());
      assert.deepEqual(JSON.parse(await editor.inputValue()), left.weights);
      await page.locator("#reader-apply").click();
      assert.deepEqual(JSON.parse(await editor.inputValue()), edited);
      const parent = { name: left.workshop.name, weights: left.weights };
      const editModels = { base: parent, candidate: { name: editName, weights: edited } };
      await compare(page, editModels, corpus);
      await base.selectOption(right.id);
      assert.ok(await page.locator("#reader-comparison").isHidden());
      assert.ok(await page.locator("#reader-save").isDisabled());
      assert.ok(await page.locator("#reader-train").isDisabled());
      assert.deepEqual(JSON.parse(await editor.inputValue()), edited);
      assert.deepEqual(await storedIds(page), imports);
      await base.selectOption(left.id);
      const editScores = await compare(page, editModels, corpus);
      await page.locator("#reader-edit-summary").filter({ hasText: "1 manually changed parameter" }).waitFor();
      assert.deepEqual(await storedIds(page), imports);
      const single = await save(page);
      assert.deepEqual(single.weights, edited);
      assert.deepEqual(single.workshop.run, {
        recipe: "reader-parameter-edit-v1", base: ref(left), editedParameters: 1,
        evaluation: sha256(evaluationText), scores: editScores
      });
      assert.equal(single.workshop.name, editName);
      assert.deepEqual(await storedIds(page), [...imports, single.id].sort());

      await method.selectOption("blend");
      // Reversing the parents and the percentage gives the same weights with a distinct build history.
      await base.selectOption(right.id);
      await page.locator("#reader-teacher").selectOption(left.id);
      await page.locator("#reader-percent").fill("65");
      const siblingName = "Pocket reversed parents";
      await name.fill(siblingName);
      await compare(page, { base: { name: right.workshop.name, weights: right.weights }, second: parent,
        candidate: { name: siblingName, weights: JSON.parse(await editor.inputValue()) } }, corpus);
      const sibling = await save(page);
      assert.deepEqual(sibling.workshop.run.base, ref(right));
      assert.deepEqual(sibling.workshop.run.second, ref(left));
      assert.equal(sibling.workshop.run.rightPercent, 65);
      await base.selectOption(left.id);
      await page.locator("#reader-teacher").selectOption(right.id);
      await page.locator("#reader-percent").fill("35");
      const blendName = "Pocket mixed reader", preview = JSON.parse(await editor.inputValue());
      assertBlendWeights(preview, left.weights, right.weights);
      await name.fill(blendName);
      const blendScores = await compare(page, {
        base: parent, second: { name: right.workshop.name, weights: right.weights },
        candidate: { name: blendName, weights: preview }
      }, corpus);
      await page.locator("#reader-edit-summary").filter({ hasText: "0 manually changed parameters" }).waitFor();
      assert.deepEqual(await storedIds(page), [...imports, single.id, sibling.id].sort());
      const blend = await save(page);
      assert.equal(blend.workshop.name, blendName);
      assertBlendWeights(blend.weights, left.weights, right.weights);
      assert.deepEqual(blend.weights, preview);
      assert.deepEqual(blend.workshop.run, {
        recipe: "reader-linear-blend-v1", base: ref(left), second: ref(right), rightPercent: 35,
        editedParameters: 0, evaluation: sha256(evaluationText), scores: blendScores
      });
      assert.deepEqual(blend.weights, sibling.weights);
      assert.equal(blend.workshop.weightsSHA256, sibling.workshop.weightsSHA256);
      assert.notEqual(blend.id, sibling.id);
      const builtIds = [...imports, single.id, sibling.id, blend.id].sort();
      assert.deepEqual(await storedIds(page), builtIds);
      await uploadReader(page, "Pocket weights only", blend.weights);
      await page.locator("#reader-status").filter({ hasText: "Imported: Pocket weights only" }).waitFor();
      const bareId = await page.locator("#reader-use").inputValue();
      assert.equal(bareId, blend.workshop.weightsSHA256);
      const bare = await exportReader(page, bareId);
      assert.equal(bare.workshop.run, null);
      assert.deepEqual(bare.weights, blend.weights);
      const savedIds = [...builtIds, bareId].sort();
      assert.equal(new Set(savedIds).size, 6);
      for (const source of [left, right, single, sibling]) assert.deepEqual(await exportReader(page, source.id), source);
      await uploadReader(page, "Round trip", { ...blend.weights, workshop: blend.workshop });
      await page.locator("#reader-status").filter({ hasText: "Already available: " + blendName }).waitFor();
      assert.equal(await page.locator("#reader-use").inputValue(), blend.id);
      const origin = await page.locator("#reader-origin").innerText();
      assert.ok(origin.includes(ref(left).label + " (65%)") && origin.includes(ref(right).label + " (35%)"));
      assert.deepEqual(await storedIds(page), savedIds);
      const question = corpus[0].questions[0][0], answer = corpus[0].sentences[0];
      const passage = corpus[0].sentences.join("\n");
      await page.locator("#reader-question").fill(question);
      await page.locator("#reader-sentences").fill(passage);
      await page.locator("#reader-chat").click();
      assert.equal(await page.locator("#prompt").inputValue(), question);
      assert.equal(await page.locator("#chat-reader-source").inputValue(), passage);
      await page.locator("#send").click();
      const reply = page.locator("#messages .message.assistant");
      await reply.locator(".message-body").filter({ hasText: answer }).waitFor();
      assert.equal(await reply.locator(".message-body").innerText(), answer);
      assert.match(await reply.locator(".message-label").innerText(), /Pocket mixed reader.*LOCAL DOCUMENT READER/);
      await reply.getByText("Parent models", { exact: true }).click();
      const lineage = await reply.locator(".reader-lineage p").innerText();
      for (const [role, source] of [["Base", left], ["Second", right]]) {
        assert.ok(lineage.includes(role + ": " + ref(source).label));
        assert.ok(lineage.includes(role + " ID: " + source.id));
        assert.ok(lineage.includes(role + " weights: " + source.workshop.weightsSHA256));
      }
      assert.ok(lineage.includes("Second model share: 35%"));
      await reply.getByRole("button", { name: "Review in Memory", exact: true }).click();
      const note = await page.locator("#memory-content").inputValue();
      assert.ok(note.includes("Model ID: " + blend.id) && note.includes(lineage) && note.includes(answer));
      const sourceRef = await page.locator("#memory-source").inputValue();
      assert.ok(sourceRef.includes(sha256(JSON.stringify(corpus[0].sentences))));
      assert.ok(sourceRef.includes(blend.workshop.weightsSHA256));
      assert.deepEqual(await memory(), []);
      await page.locator("#memory-save").click();
      await page.locator("#memory-list .memory-source").filter({ hasText: blend.workshop.weightsSHA256 }).waitFor();
      const entries = await memory();
      assert.equal(entries.length, 1);
      assert.equal(entries[0].content, note);
      assert.ok(entries[0].provenance.sourceRefs.includes(sourceRef));
      assert.equal(entries[0].provenance.verified, false);
      assert.equal(chatRequests, 0);

      await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
      await page.waitForFunction(() => !!navigator.serviceWorker.controller);
      await browser.close();
      browser = undefined;
      const closed = once(server, "close");
      server.close();
      server.closeAllConnections();
      await closed;
      browser = await engine.launchPersistentContext(profile, mobile);
      page = browser.pages()[0] ?? await browser.newPage();
      await openWorkshop(page, url);
      assert.deepEqual(await storedIds(page), savedIds);
      assert.deepEqual(await exportReader(page, blend.id), blend);
      await page.locator("#reader-base").selectOption(blend.id);
      await page.locator("#reader-teacher").selectOption(single.id);
      await page.locator("#reader-method").selectOption("edit");
      const offlineEditor = page.locator("#reader-editor");
      assert.deepEqual(JSON.parse(await offlineEditor.inputValue()), blend.weights);
      const grandchild = structuredClone(blend.weights);
      grandchild.output[0] += 0.25;
      await offlineEditor.fill(JSON.stringify(grandchild));
      await page.locator("#reader-name").fill("Offline edit");
      await compare(page, { base: { name: blendName, weights: blend.weights },
        candidate: { name: "Offline edit", weights: grandchild } }, corpus);
      assert.deepEqual(await storedIds(page), savedIds);
      t.diagnostic("Verified both unchanged imports, one edited weight, all 97 blend weights, " +
        blendScores.candidate.correct + "/" + blendScores.candidate.total + " held-out, local Chat and Memory, and offline reuse.");
    });
}
