import assert from "node:assert/strict";
import { once } from "node:events";
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
      const server = createServer();
      let browser;
      t.after(async () => {
        await browser?.close();
        server.close();
        server.closeAllConnections();
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
    });
}
