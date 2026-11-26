import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { chromium, webkit } from "playwright";
import { createServer } from "../../apps/web/server.mjs";
import { evaluate } from "../../apps/web/model-workshop/reader.js";

const mobile = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };
const draftName = "Shared synthetic draft";
const rawText = '  {\n  "version": 1,\n  "weights": [  ';
const privateChat = "Synthetic chat marker 3b81";
const privatePassage = "Synthetic passage marker 8f24";
const privateQuestion = "Synthetic question marker 937c";
const draftId = /^draft-[0-9a-f]{64}$/;
const hash = model => createHash("sha256").update(JSON.stringify(model)).digest("hex");
const reader = (page, name) => page.locator("#reader-" + name);

async function workshop(page, url) {
  await page.goto(url);
  await page.locator("#prompt").fill(privateChat);
  await page.locator("#mobile-menu").click();
  await page.locator('[data-view="models"]').click();
  await reader(page, "method:enabled").waitFor();
  await reader(page, "question").fill(privateQuestion);
  await reader(page, "sentences").fill(privatePassage);
}

async function rows(page, database, store) {
  return page.evaluate(([database, store]) => new Promise((resolve, reject) => {
    const open = indexedDB.open(database);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const get = db.transaction(store).objectStore(store).getAll();
      get.onsuccess = () => { db.close(); resolve(get.result); };
      get.onerror = () => { db.close(); reject(get.error); };
    };
  }), [database, store]);
}
const draftRows = page => rows(page, "pocket-ai-lab-reader-drafts", "drafts");
const savedReaders = page => rows(page, "pocket-ai-lab-document-readers", "readers");

async function damageSyntheticDraft(page, id) {
  await page.evaluate(id => new Promise((resolve, reject) => {
    const open = indexedDB.open("pocket-ai-lab-reader-drafts");
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result, tx = db.transaction("drafts", "readwrite");
      const store = tx.objectStore("drafts"), get = store.get(id);
      get.onsuccess = () => {
        const row = get.result;
        row.snapshot.editorText += "synthetic damaged row";
        store.put(row);
      };
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onabort = () => { db.close(); reject(tx.error); };
    };
  }), id);
}

async function exportFile(page, control) {
  const downloading = page.waitForEvent("download");
  await reader(page, control).click();
  const file = await downloading;
  return JSON.parse(await readFile(await file.path(), "utf8"));
}

async function exportReader(page, id) {
  await reader(page, "use").selectOption(id);
  const { workshop, ...weights } = await exportFile(page, "export");
  assert.equal(workshop.id, id);
  assert.equal(workshop.weightsSHA256, hash(weights));
  return { workshop, weights };
}

async function checkMenus(page, expected) {
  for (const menu of ["use", "base", "teacher"]) {
    const options = await reader(page, menu).locator("option").evaluateAll(items => items.map(item => item.value).sort());
    assert.deepEqual(options, [...expected].sort(), menu + " should list only runnable models");
  }
}

async function saveDraft(page) {
  await reader(page, "draft-save").click();
  await reader(page, "draft-status").filter({ hasText: /Draft saved/i }).waitFor();
  const id = await reader(page, "drafts").inputValue();
  assert.match(id, draftId);
  return id;
}

async function decide(page, button, accept) {
  const dialog = page.waitForEvent("dialog", { timeout: 10000 });
  const click = reader(page, button).click();
  const confirmation = await dialog;
  assert.equal(confirmation.type(), "confirm");
  if (accept) await confirmation.accept();
  else await confirmation.dismiss();
  await click;
}

async function checkReplacementGuards(context, peer, url, targetId, baseId, secondId) {
  const page = await context.newPage();
  await workshop(page, url);
  await reader(page, "method").selectOption("blend");
  await reader(page, "percent").fill("42");
  const seed = await reader(page, "editor").inputValue();
  const initialName = await reader(page, "name").inputValue();
  assert.equal(initialName, "");
  async function cancelAndCheck() {
    await reader(page, "drafts").selectOption(targetId);
    await decide(page, "draft-resume", false);
    assert.equal(await reader(page, "method").inputValue(), "blend");
    assert.equal(await reader(page, "percent").inputValue(), "42");
    assert.equal(await reader(page, "base").inputValue(), baseId);
    assert.equal(await reader(page, "teacher").inputValue(), secondId);
    assert.equal(await reader(page, "name").inputValue(), initialName);
    assert.equal(await reader(page, "editor").inputValue(), seed);
  }
  // The percentage is a user's edit even though they have never touched the weights textarea.
  await cancelAndCheck();
  const temporary = await saveDraft(page);
  assert.notEqual(temporary, targetId);
  const snapshot = (await draftRows(page)).find(row => row.id === temporary).snapshot;
  assert.equal(snapshot.editorText, seed);
  assert.equal(snapshot.parameterPending, false);
  await reader(page, "name").fill("Transient change");
  await reader(page, "name").fill(initialName);
  await peer.bringToFront();
  await reader(peer, "draft-refresh").click();
  const peerPicker = reader(peer, "drafts");
  await peerPicker.selectOption(temporary);
  await decide(peer, "draft-delete", true);
  await peerPicker.locator('option[value="' + temporary + '"]').waitFor({ state: "detached" });
  assert.ok(!(await draftRows(page)).some(row => row.id === temporary));
  await page.bringToFront();
  // The editor still exactly matches its last explicit save, but another tab removed that snapshot.
  await cancelAndCheck();
  await page.close();
}

async function closeServer(server) {
  if (!server.listening) return;
  const closed = once(server, "close");
  server.close();
  server.closeAllConnections();
  await closed;
}

for (const engine of [chromium, webkit]) {
  test(engine.name() + " restores unpublished editing drafts after a browser restart with the server stopped",
    { timeout: 90000 }, async t => {
      const directory = await mkdtemp(path.join(tmpdir(), "pocket-reader-draft-"));
      const profile = path.join(directory, "profile");
      const server = createServer();
      let context;
      t.after(async () => {
        await context?.close();
        await closeServer(server);
        await rm(directory, { recursive: true, force: true });
      });
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      const url = "http://127.0.0.1:" + server.address().port;
      context = await engine.launchPersistentContext(profile, mobile);
      let page = context.pages()[0] ?? await context.newPage();
      const peer = await context.newPage();
      await Promise.all([workshop(page, url), workshop(peer, url)]);
      const baseId = await reader(page, "base").inputValue(), secondId = await reader(page, "teacher").inputValue();
      const base = await exportReader(page, baseId), second = await exportReader(page, secondId);
      for (const tab of [page, peer]) {
        await reader(tab, "method").selectOption("edit");
        await reader(tab, "name").fill(draftName);
        await reader(tab, "editor").fill(rawText);
      }
      assert.deepEqual(await savedReaders(page), []);
      const [rawId, retryId] = await Promise.all([saveDraft(page), saveDraft(peer)]);
      assert.equal(rawId, retryId);
      assert.equal((await draftRows(page)).length, 1);
      await peer.close();

      // A new editor builds a second, different snapshot with exactly the same display name.
      const first = page;
      page = await context.newPage();
      await first.close();
      await workshop(page, url);
      await reader(page, "method").selectOption("blend");
      await reader(page, "percent").fill("35");
      await reader(page, "name").fill(draftName);
      const blendText = await reader(page, "editor").inputValue();
      const expected = JSON.parse(blendText);
      const scalar = (a, b) => 0.65 * a + 0.35 * b;
      assert.ok(Math.abs(expected.biases[2] - scalar(base.weights.biases[2], second.weights.biases[2])) < 1e-12);
      await reader(page, "parameter").selectOption("biases.2");
      await reader(page, "value").fill("1e");
      assert.ok(await reader(page, "train").isDisabled());
      const pendingId = await saveDraft(page);
      assert.notEqual(pendingId, rawId);
      const saved = await draftRows(page);
      assert.equal(saved.length, 2);
      await checkReplacementGuards(context, page, url, pendingId, baseId, secondId);
      assert.deepEqual(await draftRows(page), saved);
      const snapshots = new Map(saved.map(row => [row.id, row.snapshot]));
      const from = { id: baseId, hash: base.workshop.weightsSHA256 };
      const other = { id: secondId, hash: second.workshop.weightsSHA256 };
      for (const [id, snapshot] of snapshots) {
        assert.equal(snapshot.id, id);
        const { id: storedId, ...state } = snapshot;
        assert.equal(storedId, "draft-" + hash(state));
        assert.deepEqual(snapshot.base, from);
        assert.equal(snapshot.name, draftName);
        for (const secret of [privateChat, privateQuestion, privatePassage]) assert.ok(!JSON.stringify(snapshot).includes(secret));
      }
      const raw = snapshots.get(rawId), pending = snapshots.get(pendingId);
      assert.equal(raw.method, "edit");
      assert.equal(raw.editorText, rawText);
      assert.equal(raw.second, null);
      assert.equal(raw.rightPercent, null);
      assert.equal(pending.method, "blend");
      assert.deepEqual(pending.second, other);
      assert.equal(pending.rightPercent, 35);
      assert.equal(pending.editorText, blendText);
      assert.equal(pending.parameterKey, "biases.2");
      assert.equal(pending.parameterText, "1e");
      assert.equal(pending.parameterPending, true);
      await checkMenus(page, [baseId, secondId]);
      assert.deepEqual(await savedReaders(page), []);
      assert.deepEqual(await exportReader(page, secondId), second);
      const family = await exportFile(page, "family-export");
      for (const marker of [rawId, pendingId, draftName, privateChat, privatePassage, privateQuestion]) {
        assert.ok(!JSON.stringify(family).includes(marker));
      }

      await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
      await page.waitForFunction(() => !!navigator.serviceWorker.controller);
      await context.close();
      context = undefined;
      await closeServer(server);
      context = await engine.launchPersistentContext(profile, mobile);
      page = context.pages()[0] ?? await context.newPage();
      await workshop(page, url);
      assert.equal(await reader(page, "method").inputValue(), "train");
      const selectedModel = await reader(page, "use").inputValue();
      const picker = reader(page, "drafts");
      await picker.selectOption(rawId);
      await reader(page, "draft-resume").click();
      await page.waitForFunction(text => document.getElementById("reader-editor").value === text, rawText);
      assert.equal(await reader(page, "method").inputValue(), "edit");
      assert.equal(await reader(page, "base").inputValue(), baseId);
      assert.equal(await reader(page, "name").inputValue(), draftName);
      assert.equal(await reader(page, "use").inputValue(), selectedModel);
      const unsaved = rawText + "\n      ";
      await reader(page, "editor").fill(unsaved);
      await picker.selectOption(pendingId);
      await decide(page, "draft-resume", false);
      assert.equal(await reader(page, "editor").inputValue(), unsaved);
      assert.equal(await reader(page, "method").inputValue(), "edit");
      await decide(page, "draft-resume", true);
      await page.waitForFunction(() => document.getElementById("reader-value").value === "1e");
      assert.equal(await reader(page, "editor").inputValue(), blendText);
      assert.equal(await reader(page, "method").inputValue(), "blend");
      assert.equal(await reader(page, "base").inputValue(), baseId);
      assert.equal(await reader(page, "teacher").inputValue(), secondId);
      assert.equal(await reader(page, "percent").inputValue(), "35");
      assert.equal(await reader(page, "name").inputValue(), draftName);
      assert.equal(await reader(page, "parameter").inputValue(), "biases.2");
      assert.equal(await reader(page, "use").inputValue(), selectedModel);
      assert.ok(await reader(page, "train").isDisabled());
      if (await reader(page, "apply").isEnabled()) await reader(page, "apply").click();
      assert.equal(await reader(page, "value").inputValue(), "1e");
      assert.ok(await reader(page, "train").isDisabled());
      expected.biases[2] += 0.125;
      await reader(page, "value").fill(String(expected.biases[2]));
      await reader(page, "apply").click();
      assert.deepEqual(JSON.parse(await reader(page, "editor").inputValue()), expected);
      await reader(page, "train").click();
      await reader(page, "comparison").waitFor();
      assert.equal(await reader(page, "scores").locator("li").count(), 3);
      assert.deepEqual(await savedReaders(page), []);
      await reader(page, "save").click();
      await reader(page, "status").filter({ hasText: "is saved" }).waitFor();
      const childId = await reader(page, "use").inputValue();
      assert.ok(![baseId, secondId, rawId, pendingId].includes(childId));
      const child = await exportReader(page, childId);
      assert.deepEqual(child.weights, expected);
      const run = child.workshop.run;
      assert.equal(run.recipe, "reader-linear-blend-v1");
      assert.equal(run.base.id, baseId);
      assert.equal(run.base.hash, from.hash);
      assert.equal(run.second.id, secondId);
      assert.equal(run.second.hash, other.hash);
      assert.equal(run.rightPercent, 35);
      assert.equal(run.editedParameters, 1);
      const evaluation = JSON.parse(await readFile(new URL("../../apps/web/model-workshop/evaluation.json", import.meta.url), "utf8"));
      assert.deepEqual(run.scores, { base: evaluate(base.weights, evaluation), second: evaluate(second.weights, evaluation),
        candidate: evaluate(expected, evaluation) });
      assert.deepEqual(await draftRows(page), saved);

      await damageSyntheticDraft(page, rawId);
      const damaged = await draftRows(page);
      assert.notDeepEqual(damaged.find(row => row.id === rawId), saved.find(row => row.id === rawId));
      await picker.selectOption(rawId);
      await decide(page, "draft-delete", false);
      assert.deepEqual(await draftRows(page), damaged);
      await decide(page, "draft-delete", true);
      await picker.locator('option[value="' + rawId + '"]').waitFor({ state: "detached" });
      assert.deepEqual(await draftRows(page), saved.filter(row => row.id === pendingId));
      await checkMenus(page, [baseId, secondId, childId]);
      assert.deepEqual(await exportReader(page, baseId), base);
      assert.deepEqual(await exportReader(page, secondId), second);
      assert.deepEqual(await exportReader(page, childId), child);

      const evidence = {
        format: "pocket-reader-draft-evidence-v1", passed: true, engine: engine.name(), viewport: mobile.viewport,
        rawDraft: rawId, pendingDraft: pendingId, concurrentDraftSaves: 2, distinctDrafts: saved.length,
        parents: { base: from, second: other }, rightPercent: run.rightPercent, child: childId, recipe: run.recipe,
        childWeightsSHA256: child.workshop.weightsSHA256, editedParameters: run.editedParameters,
        reopenedWithoutServer: true, restoredUnfinishedJSON: true, restoredUnappliedNumber: true,
        identicalConcurrentSavesDeduplicated: true, sameNameSnapshotsStayedDistinct: true,
        cancelledDirtyReplacement: true, cancelledSetupOnlyReplacement: true, cancelledAfterPeerDeletedSnapshot: true,
        damagedDraftDeletionPreservedOtherDraft: true,
        unpublishedUntilExplicitSave: true, parentsUnchanged: true, parameter: pending.parameterKey,
        excludedConversation: true, excludedDraftsFromReadersAndExports: true, scores: run.scores
      };
      if (process.env.READER_DRAFT_EVIDENCE_DIR) {
        const target = path.join(process.env.READER_DRAFT_EVIDENCE_DIR, engine.name());
        await mkdir(target, { recursive: true });
        await writeFile(path.join(target, "draft.json"), JSON.stringify(evidence, null, 2) + "\n");
      }
      t.diagnostic(JSON.stringify(evidence));
    });
}
