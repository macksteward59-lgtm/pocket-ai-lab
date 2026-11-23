import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { chromium, webkit } from "playwright";
import { createServer } from "../../apps/web/server.mjs";
import { readPassage } from "../../apps/web/model-workshop/reader.js";

const mobile = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };
const assetText = name => readFile(new URL("../../apps/web/model-workshop/" + name + ".json", import.meta.url), "utf8");
const publicSet = await assetText("comparison-example");
const privateDoc = {
  id: "private-larkspur", url: "https://private-larkspur.invalid/source",
  sentences: ["The Larkspur kit has a green cover.", "An amber box contains the spare stylus."],
  questions: [["Which color is the Larkspur kit cover?", 0], ["What is the archive window count?", -1]]
};
const roles = ["Selected reader", "Base", "Second parent"];

async function openWorkshop(browser, url) {
  const page = browser.pages()[0] ?? await browser.newPage();
  await page.goto(url);
  await page.locator("#mobile-menu").click();
  await page.locator('[data-view="models"]').click();
  await page.locator("#reader-base:enabled").waitFor();
  return page;
}

function loadFile(page, selector, name, text) {
  return page.locator(selector).setInputFiles({ name, mimeType: "application/json", buffer: Buffer.from(text) });
}

// Rebuild the same publicly reviewed four-member family as reader-family.mjs, using this engine's arithmetic.
async function buildFamily(page) {
  const base = JSON.parse(await assetText("soft"));
  base.intercept += 0.001;
  await loadFile(page, "#reader-import", "Imported family base.json", JSON.stringify(base));
  await page.locator("#reader-status").filter({ hasText: "Imported: Imported family base" }).waitFor();
  await page.locator("#reader-base").selectOption(await page.locator("#reader-use").inputValue());
  async function save(name) {
    await page.locator("#reader-name").fill(name);
    await page.locator("#reader-train").click();
    await page.locator("#reader-scores li").filter({ hasText: "candidate · " + name }).waitFor();
    await page.locator("#reader-save").click();
    await page.locator("#reader-status").filter({ hasText: "is saved" }).waitFor();
    return page.locator("#reader-use").inputValue();
  }
  const trained = await save("Family trained parent");
  await page.locator("#reader-method").selectOption("blend");
  await page.locator("#reader-base").selectOption(trained);
  await page.locator("#reader-percent").fill("35");
  const child = await save("Family blend");
  const download = page.waitForEvent("download");
  await page.locator("#reader-family-export").click();
  const family = JSON.parse(await readFile(await (await download).path(), "utf8"));
  assert.equal(family.root, child);
  const byId = new Map(family.readers.map(row => [row.id, row]));
  assert.equal(byId.size, 4);
  const root = byId.get(child);
  assert.equal(root.run.base.id, trained);
  assert.equal(root.run.rightPercent, 35);
  return [root, byId.get(trained), byId.get(root.run.second.id)];
}

function catalogSnapshot(page) {
  return page.evaluate(() => new Promise((resolve, reject) => {
    const request = indexedDB.open("pocket-ai-lab-document-readers", 1);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const rows = db.transaction("readers").objectStore("readers").getAll();
      rows.onsuccess = () => { db.close(); resolve(rows.result); };
      rows.onerror = () => { db.close(); reject(rows.error); };
    };
  }));
}

function casesOf(documents) {
  return documents.flatMap(({ sentences, questions }) =>
    questions.map(([question, expected]) => ({ question, expected, sentences, passage: sentences.join("\n") })));
}

// Replay each exported model directly, independently of the comparison module and its score report.
async function checkScores(page, models, cases) {
  const rows = page.locator("#reader-compare-scores li");
  await rows.first().waitFor();
  assert.equal(await rows.count(), models.length);
  const scores = [];
  for (const [i, model] of models.entries()) {
    const correct = cases.filter(c => readPassage(model.weights, c.question, c.passage).index === c.expected).length;
    const row = rows.nth(i);
    assert.equal(await row.getAttribute("data-model-id"), model.id);
    const visible = await row.innerText();
    assert.ok(visible.includes(roles[i]) && visible.includes(model.name), visible);
    const count = visible.match(/(\d+)\s*(?:\/|of)\s*(\d+)/);
    assert.ok(count, visible);
    assert.deepEqual([Number(count[1]), Number(count[2])], [correct, cases.length]);
    scores.push({ id: model.id, role: roles[i], correct: Number(count[1]), total: Number(count[2]) });
  }
  return scores;
}

async function checkCase(page, models, c) {
  const select = page.locator("#reader-compare-case");
  assert.ok((await select.locator("option:checked").textContent()).includes(c.question));
  assert.equal(await page.locator("#reader-compare-question").innerText(), c.question);
  const source = page.locator("#reader-compare-passage");
  if (await source.getAttribute("open") === null) await source.locator("summary").click();
  assert.deepEqual(await page.locator("#reader-compare-source li").allInnerTexts(), c.sentences);
  const expected = page.locator("#reader-compare-expected");
  if (c.expected === null) assert.match(await expected.innerText(), /ungraded/i);
  else if (c.expected === -1) assert.match(await expected.innerText(), /expected abstention/i);
  else assert.ok((await expected.innerText()).includes(c.sentences[c.expected]));
  const rows = page.locator("#reader-compare-outputs li");
  assert.equal(await rows.count(), models.length);
  const choices = [];
  for (const [i, model] of models.entries()) {
    const row = rows.nth(i);
    assert.equal(await row.getAttribute("data-model-id"), model.id);
    const answer = await row.locator(".reader-compare-answer").innerText();
    const actual = readPassage(model.weights, c.question, c.passage);
    if (actual.index === -1) assert.match(answer, /Abstained.*UNKNOWN/i);
    else assert.equal(answer, "Sentence " + (actual.index + 1) + " · " + actual.answer);
    choices.push({ id: model.id, index: actual.index, displayed: answer });
  }
  return choices;
}

async function stop(server) {
  if (!server.listening) return;
  const closed = once(server, "close");
  server.close();
  server.closeAllConnections();
  await closed;
}

for (const engine of [chromium, webkit]) {
  test(engine.name() + " compares readers on typed and private cases, then chooses a parent in offline Chat",
    { timeout: 120000 }, async t => {
      const dir = await mkdtemp(path.join(tmpdir(), "pocket-compare-")), profile = path.join(dir, "profile");
      const previous = process.env.POCKET_MEMORY_DIR;
      process.env.POCKET_MEMORY_DIR = path.join(dir, "memory");
      const server = createServer();
      let browser;
      t.after(async () => {
        await browser?.close();
        await stop(server);
        if (previous === undefined) delete process.env.POCKET_MEMORY_DIR;
        else process.env.POCKET_MEMORY_DIR = previous;
        await rm(dir, { recursive: true, force: true });
      });
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      const url = "http://127.0.0.1:" + server.address().port;
      browser = await engine.launchPersistentContext(profile, mobile);
      let page = await openWorkshop(browser, url);
      const version = browser.browser()?.version() ?? await page.evaluate(() => navigator.userAgent);
      const models = await buildFamily(page), before = await catalogSnapshot(page);
      await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
      await page.waitForFunction(() => !!navigator.serviceWorker.controller);
      const unexpected = [];
      function watch(method, target) {
        if (!/^https?:/i.test(target)) return;
        const request = new URL(target);
        if (request.origin !== url || !["GET", "HEAD"].includes(method) || request.search ||
            (request.pathname.startsWith("/api/") && !["/api/health", "/api/memory"].includes(request.pathname)) ||
            /larkspur|archive.?window|spare.?stylus/i.test(decodeURIComponent(target))) {
          unexpected.push(method + " " + target);
        }
      }
      server.on("request", req => watch(req.method, new URL(req.url, url).href));
      const watchBrowser = context => context.on("request", req => watch(req.method(), req.url()));
      watchBrowser(browser);
      const privateCases = casesOf([privateDoc]), publicCases = casesOf(JSON.parse(publicSet));
      const typed = { ...privateCases[0], expected: null };
      await page.locator("#reader-question").fill(typed.question);
      await page.locator("#reader-sentences").fill(typed.passage);
      await page.locator("#reader-compare-parents").click();
      await page.locator("#reader-compare-results").waitFor();
      await checkCase(page, models, typed);
      assert.equal(await page.locator("#messages .message").count(), 0);

      async function compareFile(name, text, cases) {
        await loadFile(page, "#reader-compare-file", name, text);
        await page.waitForFunction(({ question, length }) => {
          const choices = document.getElementById("reader-compare-case").options;
          return choices.length === length && choices[0].textContent.includes(question);
        }, { question: cases[0].question, length: cases.length });
        return checkScores(page, models, cases);
      }
      const privateSet = JSON.stringify([privateDoc]);
      await compareFile("private-larkspur.json", privateSet, privateCases);
      await page.locator("#reader-compare-case").selectOption("1");
      await checkCase(page, models, privateCases[1]);
      const scores = await compareFile("comparison-example.json", publicSet, publicCases);
      assert.deepEqual(scores.map(s => [s.correct, s.total]), [[12, 16], [12, 16], [14, 16]]);
      const nickel = publicCases.findIndex(c => c.question === "How many grams does a nickel weigh?");
      assert.ok(nickel >= 0);
      await page.locator("#reader-compare-case").selectOption(String(nickel));
      const disagreement = await checkCase(page, models, publicCases[nickel]);
      assert.deepEqual(disagreement.map(choice => choice.index), [-1, -1, 0]);
      assert.equal(await page.locator("#reader-use").inputValue(), models[0].id);
      assert.equal(await page.locator("#messages .message").count(), 0);
      assert.deepEqual(await catalogSnapshot(page), before);
      const memories = await fetch(url + "/api/memory");
      assert.equal(memories.status, 200);
      assert.deepEqual((await memories.json()).entries, []);
      assert.deepEqual(unexpected, []);

      await browser.close();
      browser = undefined;
      await stop(server);
      browser = await engine.launchPersistentContext(profile, mobile);
      watchBrowser(browser);
      page = await openWorkshop(browser, url);
      assert.ok(await page.locator("#reader-compare-results").isHidden());
      await page.locator("#reader-use").selectOption(models[0].id);
      const draftQuestion = "Draft question still in progress", draftPassage = "Private Larkspur draft in progress.";
      await page.locator("#reader-question").fill(draftQuestion);
      await page.locator("#reader-sentences").fill(draftPassage);
      await page.locator("#reader-chat").click();
      const priorLabel = await page.locator("#chat-reader-label").innerText();
      assert.ok(priorLabel.includes(models[0].name));
      await page.locator("#chat-choose-reader").click();
      await compareFile("private-larkspur.json", privateSet, privateCases);
      await checkCase(page, models, privateCases[0]);
      assert.deepEqual(await compareFile("comparison-example.json", publicSet, publicCases), scores);
      await page.locator("#reader-compare-case").selectOption(String(nickel));
      assert.deepEqual(await checkCase(page, models, publicCases[nickel]), disagreement);
      const parentId = models[2].id;
      const parent = page.locator('#reader-compare-outputs li[data-model-id="' + parentId + '"]');
      const useParent = parent.getByRole("button", { name: "Use in Chat" });
      async function confirmReplacement(accept) {
        const answerDialog = page.waitForEvent("dialog").then(async dialog => {
          const type = dialog.type(), message = dialog.message();
          if (accept) await dialog.accept(); else await dialog.dismiss();
          assert.equal(type, "confirm");
          assert.match(message, /replace.*Chat draft/i);
        });
        await Promise.all([answerDialog, useParent.click()]);
      }
      await confirmReplacement(false);
      assert.equal(await page.locator("#prompt").inputValue(), draftQuestion);
      assert.equal(await page.locator("#chat-reader-source").inputValue(), draftPassage);
      assert.equal(await page.locator("#chat-reader-label").textContent(), priorLabel);
      assert.ok(await page.locator("#reader-compare-results").isVisible());
      await confirmReplacement(true);
      const turn = publicCases[nickel];
      assert.equal(await page.locator("#prompt").inputValue(), turn.question);
      assert.equal(await page.locator("#chat-reader-source").inputValue(), turn.passage);
      assert.ok((await page.locator("#chat-reader-label").innerText()).includes(models[2].name));
      assert.equal(await page.locator("#reader-use").inputValue(), models[0].id);
      assert.equal(await page.locator("#messages .message").count(), 0);
      await page.locator("#send").click();
      const reply = page.locator("#messages .message.assistant");
      const answer = "The listed mass of a United States nickel is 5.000 grams.";
      await reply.locator(".message-body").filter({ hasText: answer }).waitFor();
      assert.equal(await reply.locator(".message-body").innerText(), answer);
      await reply.getByRole("button", { name: "Review in Memory", exact: true }).click();
      const draft = await page.locator("#memory-content").inputValue();
      const selectedChatId = draft.match(/^Model ID: (.+)$/m)?.[1];
      assert.equal(selectedChatId, parentId);
      assert.deepEqual(await catalogSnapshot(page), before);
      assert.deepEqual(unexpected, []);

      const evidence = process.env.READER_COMPARE_EVIDENCE_DIR;
      if (evidence) {
        const out = path.join(evidence, engine.name());
        await mkdir(out, { recursive: true });
        await writeFile(path.join(out, "comparison.json"), JSON.stringify({
          success: true, engine: engine.name(), version, viewport: mobile.viewport, scores,
          disagreement: { question: turn.question, expected: turn.expected, choices: disagreement },
          selectedChatId, chatAnswer: answer, privateFileCases: privateCases.length,
          typedUngradedChecked: true, offlinePrivateReloadChecked: true, chatDraftPreservedOnCancel: true,
          readerCatalogUnchanged: true, savedMemoriesBeforeOffline: 0,
          unexpectedHttpRequests: unexpected.length, automaticChatMessages: 0
        }, null, 2) + "\n");
      }
    });
}
