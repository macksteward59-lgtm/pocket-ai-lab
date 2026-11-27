import assert from "node:assert/strict";
import { once } from "node:events";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { chromium, webkit } from "playwright";
import { createServer } from "../../apps/web/server.mjs";

const mobile = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };
async function open(page, url) {
  await page.goto(url);
  await page.locator("#mobile-menu").click();
  await page.locator('[data-view="models"]').click();
  await page.locator("#reader-base:enabled").waitFor();
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
}
async function upload(page, name, value) {
  await page.locator("#reader-import").setInputFiles({ name, mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(value)) });
}
for (const engine of [chromium, webkit]) {
  test(engine.name() + " builds, saves, uses and exports a reader, then trains its child offline after restart",
    { timeout: 90000 }, async t => {
      const dir = await mkdtemp(path.join(tmpdir(), "pocket-reader-"));
      const previousMemory = process.env.POCKET_MEMORY_DIR;
      process.env.POCKET_MEMORY_DIR = path.join(dir, "memory");
      const server = createServer();
      let browser;
      t.after(async () => {
        await browser?.close();
        server.close();
        server.closeAllConnections();
        if (previousMemory === undefined) delete process.env.POCKET_MEMORY_DIR;
        else process.env.POCKET_MEMORY_DIR = previousMemory;
        await rm(dir, { recursive: true, force: true });
      });
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      const port = server.address().port;
      const url = "http://127.0.0.1:" + port;
      browser = await engine.launchPersistentContext(dir, mobile);
      let page = browser.pages()[0] ?? await browser.newPage();
      await open(page, url);
      const base = await page.locator("#reader-base").inputValue();
      const teacher = await page.locator("#reader-teacher").inputValue();
      await page.locator("#reader-name").fill("Reader A");
      await page.locator("#reader-teacher").selectOption(base);
      await page.locator("#reader-train").click();
      await page.getByText("Choose two readers with different weights.").waitFor();
      await page.locator("#reader-teacher").selectOption(teacher);
      await page.locator("#reader-train").click();
      await page.locator("#reader-scores").getByText("candidate · Reader A · 15/16").waitFor();
      await page.locator("#reader-save").click();
      await page.locator("#reader-status").filter({ hasText: /is saved/ }).waitFor();
      const child = await page.locator("#reader-use").inputValue();
      await page.locator("#reader-question").fill("Does an array preserve the order of its values?");
      await page.locator("#reader-sentences").fill("Values in a JSON array have a defined order.\nA JSON object groups name/value pairs without defining an order for those pairs.");
      await page.locator("#reader-answer").click();
      await page.locator("#reader-output").filter({ hasText: "Values in a JSON array have a defined order." }).waitFor();
      const localAnswer = await page.locator("#reader-output").innerText();
      const download = page.waitForEvent("download");
      await page.locator("#reader-export").click();
      const exported = JSON.parse(await readFile(await (await download).path(), "utf8"));
      assert.equal(exported.workshop.run.base.id, base);
      assert.equal(exported.workshop.run.teacher.id, teacher);
      assert.equal(exported.workshop.run.verifiedPairs, 62);
      await upload(page, "duplicate.json", exported);
      await page.locator("#reader-status").filter({ hasText: /Already available/ }).waitFor();
      await upload(page, "wrong-format.json", {});
      await page.locator("#reader-status").filter({ hasText: /compatible/ }).waitFor();
      const originalQuestion = await page.locator("#reader-question").inputValue();
      const passage = await page.locator("#reader-sentences").inputValue();
      const sourceDigest = createHash("sha256").update(JSON.stringify(passage.split("\n"))).digest("hex");
      let chatRequests = 0;
      const memoryEntries = async () => (await (await fetch(url + "/api/memory")).json()).entries;
      // Count at the real HTTP server, including requests handled by a service worker.
      server.on("request", req => { if (req.url === "/api/chat") chatRequests++; });
      await page.locator("#reader-chat").click();
      assert.equal(await page.locator("#prompt").inputValue(), originalQuestion);
      assert.equal(await page.locator("#chat-reader-source").inputValue(), passage);
      await page.locator("#send").click();
      const reply = page.locator("#messages .message.assistant");
      await reply.locator(".message-body").filter({ hasText: localAnswer }).waitFor();
      assert.match(await reply.locator(".message-label").innerText(), /Reader A.*LOCAL DOCUMENT READER/);
      await reply.getByRole("button", { name: "Review in Memory" }).click();
      assert.match(await page.locator("#memory-content").inputValue(), new RegExp(exported.workshop.run.teacher.hash));
      assert.match(await page.locator("#memory-source").inputValue(), new RegExp(sourceDigest));
      assert.deepEqual(await memoryEntries(), []);
      await page.locator("#memory-content").fill("Reviewed by user. " + localAnswer);
      await page.locator("#memory-save").click();
      await page.locator("#memory-list").getByText("Reviewed by user. " + localAnswer, { exact: true }).waitFor();
      const [note] = await memoryEntries();
      assert.equal(note.provenance.verified, false);
      assert.ok(note.provenance.sourceRefs[0].includes(sourceDigest));
      assert.equal(chatRequests, 0);
      await page.locator("#mobile-menu").click();
      await page.locator('[data-view="chat"]').click();
      await page.locator("#chat-use-default").click();
      assert.equal(await page.locator("#messages .message").count(), 2);
      assert.ok(await page.locator("#chat-reader-context").isHidden());
      await page.locator("#chat-choose-reader").click();
      await page.locator("#reader-use:enabled").waitFor();
      await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
      await page.waitForFunction(() => !!navigator.serviceWorker.controller);
      await browser.close();
      browser = undefined;
      // Physically stop the HTTP server so even a service worker cannot fetch a cache miss.
      const closed = once(server, "close");
      server.close();
      server.closeAllConnections();
      await closed;
      browser = await engine.launchPersistentContext(dir, mobile);
      page = browser.pages()[0] ?? await browser.newPage();
      await open(page, url);
      await page.locator("#reader-use").selectOption(child);
      await page.locator("#reader-origin").filter({ hasText: /Held-out score 15\/16/ }).waitFor();
      exported.intercept += 0.125;
      await upload(page, "Imported teacher.json", exported);
      await page.locator("#reader-status").filter({ hasText: /Imported:/ }).waitFor();
      const imported = await page.locator("#reader-use").inputValue();
      await page.locator("#reader-base").selectOption(child);
      await page.locator("#reader-teacher").selectOption(imported);
      await page.locator("#reader-name").fill("Reader B");
      await page.locator("#reader-train").click();
      await page.locator("#reader-scores").getByText(/candidate · Reader B/).waitFor();
      await page.locator("#reader-save").click();
      await page.locator("#reader-status").filter({ hasText: /is saved/ }).waitFor();
      assert.equal(await page.locator("#reader-base option").count(), 5);
      assert.notEqual(await page.locator("#reader-use").inputValue(), child);
      await page.locator("#reader-chat").click();
      await page.locator("#chat-reader-source").fill(passage);
      await page.locator("#prompt").fill(originalQuestion);
      await page.locator("#send").click();
      await page.locator("#messages .message.assistant .message-label").filter({ hasText: /Reader B/ }).waitFor();
      const retainedReplies = page.locator("#messages .message.assistant");
      assert.equal(await retainedReplies.count(), 2, "the earlier Reader A reply survives the browser restart");
      assert.match(await retainedReplies.first().locator(".message-label").innerText(), /Reader A.*LOCAL DOCUMENT READER/);
      assert.equal(await retainedReplies.first().locator(".message-body").innerText(), localAnswer);
      assert.match(await retainedReplies.last().locator(".message-label").innerText(), /Reader B.*LOCAL DOCUMENT READER/);
      assert.ok((await retainedReplies.last().locator(".message-body").innerText()).length);

    });
}
