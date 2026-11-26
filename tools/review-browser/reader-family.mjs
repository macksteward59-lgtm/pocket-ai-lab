import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { chromium, webkit } from "playwright";
import { createServer } from "../../apps/web/server.mjs";

const mobile = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const corpus = name => readFile(new URL("../../apps/web/model-workshop/" + name + ".json", import.meta.url), "utf8");

async function workshop(page, url) {
  await page.goto(url);
  await page.locator("#mobile-menu").click();
  await page.locator('[data-view="models"]').click();
  await page.locator("#reader-base:enabled").waitFor();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
}

async function chooseFile(page, selector, name, bytes) {
  await page.locator(selector).setInputFiles({ name, mimeType: "application/json", buffer: bytes });
}

async function importWeights(page, name, offset) {
  const weights = JSON.parse(await corpus("soft"));
  weights.intercept += offset;
  const bytes = Buffer.from(JSON.stringify(weights));
  await chooseFile(page, "#reader-import", name + ".json", bytes);
  await page.locator("#reader-status").filter({ hasText: "Imported: " + name }).waitFor();
  const id = await page.locator("#reader-use").inputValue();
  assert.equal(id, sha256(bytes));
  return id;
}

async function saveBuild(page, name) {
  await page.locator("#reader-name").fill(name);
  await page.locator("#reader-train").click();
  await page.locator("#reader-scores li").filter({ hasText: "candidate · " + name }).waitFor();
  await page.locator("#reader-save").click();
  await page.locator("#reader-status").filter({ hasText: "is saved" }).waitFor();
  return page.locator("#reader-use").inputValue();
}

async function downloadFamily(page, root) {
  await page.locator("#reader-use").selectOption(root);
  const result = page.waitForEvent("download");
  await page.locator("#reader-family-export").click();
  return readFile(await (await result).path());
}

// All observations and the deliberate late conflict use the real, per-profile IndexedDB.
async function database(page, operation = "read", value = null) {
  return page.evaluate(({ operation, value }) => new Promise((resolve, reject) => {
    const open = indexedDB.open("pocket-ai-lab-document-readers", 1);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const db = open.result;
      const tx = db.transaction("readers", operation === "read" ? "readonly" : "readwrite");
      const store = tx.objectStore("readers");
      if (operation === "add") store.add(value);
      if (operation === "delete") store.delete(value);
      const all = store.getAll();
      tx.oncomplete = () => { db.close(); resolve(all.result); };
      tx.onabort = () => { db.close(); reject(tx.error); };
    };
  }), { operation, value });
}

async function preview(page, bytes, rootName, members) {
  await chooseFile(page, "#reader-family-file", "family.json", bytes);
  await page.locator("#reader-family-confirm:enabled").waitFor();
  await page.locator("#reader-family-summary").filter({ hasText: rootName }).waitFor();
  assert.equal(await page.locator("#reader-family-members li").count(), members.length);
  const text = await page.locator("#reader-family-members").innerText();
  for (const member of members) assert.ok(text.includes(member.name), member.name);
}

async function confirm(page, rootName) {
  await page.locator("#reader-family-confirm").click();
  const status = page.locator("#reader-status").filter({ hasText: "Imported family " + rootName + "." });
  await status.waitFor();
  const counts = /(\d+) added, (\d+) already available/.exec(await status.innerText());
  assert.ok(counts, "expected an import receipt with persisted and already available counts");
  return { added: Number(counts[1]), existing: Number(counts[2]) };
}

async function checkReportedMeasurements(engine, profile, url, ancestor, family) {
  const browser = await engine.launchPersistentContext(profile, mobile);
  try {
    const page = browser.pages()[0] ?? await browser.newPage();
    await workshop(page, url);
    const declared = structuredClone(ancestor);
    const trained = declared.readers.find(record => record.id === declared.root);
    const local = await page.evaluate(async ({ weights, documents }) => {
      const { readPassage } = await import("/model-workshop/reader.js");
      let correct = 0, total = 0;
      for (const doc of documents) {
        for (const [question, expected] of doc.questions) {
          const answer = readPassage(weights, question, doc.sentences.join("\n"));
          correct += Number(answer.index === expected);
          total++;
        }
      }
      return { correct, total };
    }, { weights: trained.weights, documents: JSON.parse(await corpus("evaluation")) });
    const reported = local.correct === 0 ? 1 : local.correct - 1;
    trained.run.scores.candidate.correct = reported;
    await preview(page, Buffer.from(JSON.stringify(declared)), trained.name, declared.readers);
    const difference = page.locator('#reader-family-difference-list li[data-field="scores.candidate.correct"]')
      .filter({ hasText: trained.name });
    await difference.waitFor();
    assert.equal(await difference.getAttribute("data-model-id"), trained.id);
    const text = await difference.innerText();
    assert.ok(text.includes("file reported " + reported) && text.includes("locally measured " + local.correct));
    assert.deepEqual(await database(page), []);
    assert.deepEqual(await confirm(page, trained.name), { added: 2, existing: 1 });
    const storedParent = (await database(page)).find(record => record.id === trained.id);
    assert.deepEqual(storedParent.run.scores.candidate, local);
    assert.equal(storedParent.importedFamily, true);

    const editedReport = structuredClone(family);
    const root = editedReport.readers.find(record => record.id === family.root);
    const alias = root.name + " local copy";
    await page.locator("#reader-method").selectOption("blend");
    await page.locator("#reader-base").selectOption(root.run.base.id);
    await page.locator("#reader-teacher").selectOption(root.run.second.id);
    await page.locator("#reader-percent").fill(String(root.run.rightPercent));
    assert.equal(await saveBuild(page, alias), root.id);
    const localRows = await database(page);
    const locallyBuilt = localRows.find(record => record.id === root.id);
    assert.equal(locallyBuilt.name, alias);
    assert.ok(!locallyBuilt.importedFamily);
    const parentReport = editedReport.readers.find(record => record.id === trained.id);
    parentReport.run.verifiedPairs = storedParent.run.verifiedPairs - 1;
    await preview(page, Buffer.from(JSON.stringify(editedReport)), alias, editedReport.readers);
    const pairDifference = page.locator('#reader-family-difference-list li[data-field="verifiedPairs"]');
    await pairDifference.waitFor();
    assert.equal(await pairDifference.getAttribute("data-model-id"), trained.id);
    assert.deepEqual(await confirm(page, alias), { added: 0, existing: 4 });
    assert.deepEqual(await database(page), localRows);
    assert.equal(await page.locator("#reader-use").inputValue(), root.id);
    return { reader: trained.id, field: "scores.candidate.correct", reported, local: local.correct, total: local.total };
  } finally {
    await browser.close();
  }
}

for (const [from, to] of [[chromium, webkit], [webkit, chromium]]) {
  test(from.name() + " transfers a trained reader and its blend to a clean " + to.name() + " profile",
    { timeout: 120000 }, async t => {
      const dir = await mkdtemp(path.join(tmpdir(), "pocket-family-"));
      const destinationProfile = path.join(dir, "destination");
      const server = createServer();
      let source, destination;
      t.after(async () => {
        await source?.close();
        await destination?.close();
        if (server.listening) {
          const closed = once(server, "close");
          server.close();
          server.closeAllConnections();
          await closed;
        }
        await rm(dir, { recursive: true, force: true });
      });
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      const url = "http://127.0.0.1:" + server.address().port;
      source = await from.launchPersistentContext(path.join(dir, "source"), mobile);
      let page = source.pages()[0] ?? await source.newPage();
      const fromVersion = source.browser()?.version() ?? await page.evaluate(() => navigator.userAgent);
      await workshop(page, url);
      const teacher = await page.locator("#reader-teacher").inputValue();
      const base = await importWeights(page, "Imported family base", 0.001);
      const unrelated = await importWeights(page, "Unrelated reader", -0.125);
      await page.locator("#reader-base").selectOption(base);
      await page.locator("#reader-teacher").selectOption(teacher);
      const trainedName = "Family trained parent", rootName = "Family blend";
      const trained = await saveBuild(page, trainedName);
      const ancestorBytes = await downloadFamily(page, trained);
      await page.locator("#reader-method").selectOption("blend");
      await page.locator("#reader-base").selectOption(trained);
      await page.locator("#reader-percent").fill("35");
      const root = await saveBuild(page, rootName);
      const bytes = await downloadFamily(page, root);
      const family = JSON.parse(bytes), ancestor = JSON.parse(ancestorBytes);
      assert.equal(family.format, "pocket-reader-family-v1");
      assert.equal(family.root, root);
      assert.deepEqual(family.readers.map(record => record.id).sort(), [base, teacher, trained, root].sort());
      assert.ok(!family.readers.some(record => record.id === unrelated));
      const byId = new Map(family.readers.map(record => [record.id, record]));
      for (const record of family.readers) {
        assert.equal(sha256(JSON.stringify(record.weights)), record.hash);
        for (const ref of [record.run?.base, record.run?.teacher, record.run?.second].filter(Boolean)) {
          assert.equal(ref.hash, byId.get(ref.id).hash);
          assert.ok(family.readers.indexOf(byId.get(ref.id)) < family.readers.indexOf(record));
        }
      }
      const trainedRun = byId.get(trained).run, rootRun = byId.get(root).run;
      assert.deepEqual([trainedRun.base.id, trainedRun.teacher.id], [base, teacher]);
      assert.equal(trainedRun.training, sha256(await corpus("training")));
      assert.equal(trainedRun.evaluation, sha256(await corpus("evaluation")));
      assert.deepEqual([rootRun.base.id, rootRun.second.id, rootRun.rightPercent], [trained, teacher, 35]);
      assert.equal(rootRun.recipe, "reader-linear-blend-v1");
      assert.deepEqual(ancestor.readers, family.readers.filter(record => record.id !== root));
      const sourceRows = await database(page);
      assert.ok(sourceRows.some(record => record.id === unrelated));
      const expectedRows = sourceRows.filter(record => record.id !== unrelated);
      assert.deepEqual(expectedRows.map(record => record.id).sort(), [base, trained, root].sort());
      await source.close();
      source = undefined;
      const measurement = await checkReportedMeasurements(to, path.join(dir, "comparison"), url, ancestor, family);

      destination = await to.launchPersistentContext(destinationProfile, mobile);
      page = destination.pages()[0] ?? await destination.newPage();
      const toVersion = destination.browser()?.version() ?? await page.evaluate(() => navigator.userAgent);
      await workshop(page, url);
      assert.deepEqual(await database(page), []);
      const original = await page.locator("#reader-use").inputValue();
      await preview(page, bytes, rootName, family.readers);
      assert.equal(await page.locator("#reader-use").inputValue(), original);
      assert.deepEqual(await database(page), []);
      await page.locator("#reader-family-cancel").click();
      assert.ok(await page.locator("#reader-family-preview").isHidden());
      assert.deepEqual(await database(page), []);
      await preview(page, bytes, rootName, family.readers);
      const tampered = structuredClone(family);
      tampered.readers.find(record => record.id === root).weights.intercept += 0.5;
      await chooseFile(page, "#reader-family-file", "tampered.json", Buffer.from(JSON.stringify(tampered)));
      await page.locator("#reader-status").filter({ hasText: "Family import failed." }).waitFor();
      assert.ok(await page.locator("#reader-family-confirm").isHidden());
      assert.deepEqual(await database(page), []);
      const swapped = structuredClone(family);
      const roles = swapped.readers.find(record => record.id === root).run;
      [roles.base, roles.second] = [roles.second, roles.base];
      await chooseFile(page, "#reader-family-file", "swapped-roles.json", Buffer.from(JSON.stringify(swapped)));
      await page.locator("#reader-status").filter({ hasText: "Family import failed." }).waitFor();
      assert.ok(await page.locator("#reader-family-confirm").isHidden());
      assert.deepEqual(await database(page), []);

      await preview(page, bytes, rootName, family.readers);
      const conflict = structuredClone(byId.get(root));
      conflict.run.rightPercent = 80;
      await database(page, "add", conflict);
      await page.locator("#reader-family-confirm").click();
      await page.locator("#reader-status").filter({ hasText: /conflicts with an existing catalog entry/i }).waitFor();
      assert.deepEqual(await database(page), [conflict], "the late conflict must roll back earlier family members");
      assert.equal(await page.locator("#reader-use").inputValue(), original);
      await database(page, "delete", root);

      const peer = await destination.newPage();
      await workshop(peer, url);
      await Promise.all([preview(page, bytes, rootName, family.readers),
        preview(peer, ancestorBytes, trainedName, ancestor.readers)]);
      const [full, partial] = await Promise.all([confirm(page, rootName), confirm(peer, trainedName)]);
      assert.equal(full.added + partial.added, 3);
      assert.equal(full.existing + partial.existing, 4);
      assert.equal(await page.locator("#reader-use").inputValue(), root);
      assert.equal(await peer.locator("#reader-use").inputValue(), trained);
      const targetRows = await database(page);
      assert.deepEqual(targetRows.map(record => record.id).sort(), [base, trained, root].sort());
      for (const expected of expectedRows) {
        const actual = targetRows.find(record => record.id === expected.id);
        for (const key of ["name", "hash", "weights"]) assert.deepEqual(actual[key], expected[key]);
        assert.deepEqual(actual.run ?? null, expected.run ?? null);
        if (expected.run) assert.equal(actual.importedFamily, true);
      }
      assert.deepEqual(JSON.parse(await downloadFamily(page, root)), family);
      await preview(page, bytes, rootName, family.readers);
      const replay = await confirm(page, rootName);
      assert.deepEqual(replay, { added: 0, existing: 4 });
      assert.deepEqual(await database(page), targetRows);
      await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
      await page.waitForFunction(() => !!navigator.serviceWorker.controller);
      await destination.close();
      destination = undefined;
      const closed = once(server, "close");
      server.close();
      server.closeAllConnections();
      await closed;

      destination = await to.launchPersistentContext(destinationProfile, mobile);
      page = destination.pages()[0] ?? await destination.newPage();
      await workshop(page, url);
      assert.deepEqual(await database(page), targetRows);
      const restoredBytes = await downloadFamily(page, root);
      assert.deepEqual(JSON.parse(restoredBytes), family);
      for (const selector of ["#reader-base", "#reader-teacher", "#reader-use"]) {
        const options = await page.locator(selector + " option").evaluateAll(items => items.map(item => item.value));
        for (const id of byId.keys()) assert.ok(options.includes(id));
        assert.ok(!options.includes(unrelated));
      }
      const document = JSON.parse(await corpus("evaluation"))[0];
      await page.locator("#reader-question").fill(document.questions[0][0]);
      await page.locator("#reader-sentences").fill(document.sentences.join("\n"));
      await page.locator("#reader-chat").click();
      await page.locator("#send").click();
      const reply = page.locator("#messages .message.assistant");
      await reply.locator(".message-body").filter({ hasText: document.sentences[0] }).waitFor();
      assert.equal(await reply.locator(".message-body").innerText(), document.sentences[0]);
      assert.ok((await reply.locator(".message-label").innerText()).includes(rootName));
      await reply.locator(".reader-lineage summary").click();
      const lineage = await reply.locator(".reader-lineage p").innerText();
      assert.ok(lineage.includes("Base ID: " + trained) && lineage.includes("Second ID: " + teacher));
      assert.ok(lineage.includes("Imported model family.") && lineage.includes("Historical training and authorship are unverified."));
      await page.locator("#mobile-menu").click();
      await page.locator('[data-view="models"]').click();
      await page.locator("#reader-base").selectOption(root);
      await page.locator("#reader-method").selectOption("edit");
      const weights = JSON.parse(await page.locator("#reader-editor").inputValue());
      assert.deepEqual(weights, byId.get(root).weights);
      weights.intercept += 0.1;
      await page.locator("#reader-editor").fill(JSON.stringify(weights));
      const descendant = await saveBuild(page, "Offline family descendant");
      const finalRows = await database(page);
      assert.equal(finalRows.length, targetRows.length + 1);
      const final = finalRows.find(record => record.id === descendant);
      assert.equal(final.run.base.id, root);
      assert.equal(final.run.base.hash, byId.get(root).hash);
      assert.deepEqual(final.weights, weights);
      const receipt = {
        success: true,
        source: { engine: from.name(), version: fromVersion }, destination: { engine: to.name(), version: toVersion },
        familyRoot: root, fileSHA256: sha256(bytes), familyModels: family.readers.length,
        concurrentImports: { full, ancestor: partial }, replay, lateConflictRolledBack: true,
        reportedMeasurementComparison: measurement, importedHistoryDisclosedInChat: true,
        offlineReExportSHA256: sha256(restoredBytes), offlineChatAnswer: document.sentences[0],
        offlineDescendant: descendant, offlineDescendantBase: final.run.base.id,
      };
      if (process.env.READER_FAMILY_EVIDENCE_DIR) {
        const output = path.join(process.env.READER_FAMILY_EVIDENCE_DIR, from.name() + "-to-" + to.name());
        await mkdir(output, { recursive: true });
        await writeFile(path.join(output, "family.json"), bytes);
        await writeFile(path.join(output, "acceptance.json"), JSON.stringify(receipt, null, 2) + "\n");
      }
      t.diagnostic(JSON.stringify(receipt));
    });
}
