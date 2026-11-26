import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { chromium, webkit } from "playwright";
import { createServer } from "../../apps/web/server.mjs";

const fixtureTool = fileURLToPath(new URL("../../scripts/custom-gguf/workshop/test_worker.py", import.meta.url));
const mobile = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };

async function openHost(browser, url) {
  const page = await browser.newPage(mobile);
  await page.goto(url);
  await page.locator("#chat-choose-reader").click();
  await page.locator("#reader-train:enabled").waitFor();
  await page.locator("#workshop-engine").selectOption("host");
  await page.locator("#reader-base:enabled").waitFor();
  return page;
}

for (const engine of [chromium, webkit]) {
  test(engine.name() + " pauses LoRA at step 12, reopens and resumes training, then uses the child in Chat",
    { timeout: 240000 }, async t => {
      const directory = await mkdtemp(path.join(tmpdir(), "pocket-host-build-"));
      const prior = process.env.POCKET_TRAINING_DIR;
      process.env.POCKET_TRAINING_DIR = directory;
      const server = createServer();
      let browser;
      t.after(async () => {
        await browser?.close();
        server.close();
        server.closeAllConnections();
        if (prior === undefined) delete process.env.POCKET_TRAINING_DIR;
        else process.env.POCKET_TRAINING_DIR = prior;
        await rm(directory, { recursive: true, force: true });
      });
      execFileSync("python3", [fixtureTool, "--make-fixtures", directory], { timeout: 45000 });
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      const url = "http://127.0.0.1:" + server.address().port;
      const catalog = async () => {
        const response = await fetch(url + "/api/model-workshop");
        assert.equal(response.status, 200);
        return response.json();
      };
      const { models: imports } = await catalog();
      const base = imports.find(m => m.name === "Fixture base");
      const teacher = imports.find(m => m.name === "Fixture teacher");
      assert.ok(base && teacher);
      browser = await engine.launch();
      let page = await openHost(browser, url);
      await page.locator("#reader-base").selectOption(base.id);
      await page.locator("#reader-teacher").selectOption(teacher.id);
      await page.locator("#reader-name").fill("Local student");
      await page.locator("#host-pause").click();
      await page.locator("#reader-status").filter({ hasText: /Paused at step 12 of 24/i }).waitFor({ timeout: 90000 });
      const paused = await catalog();
      assert.deepEqual(paused.models, imports);
      assert.equal(paused.drafts.length, 1);
      const [draft] = paused.drafts;
      assert.equal(draft.name, "Local student");
      assert.deepEqual(draft.parents, { base: base.id, teacher: teacher.id });
      assert.equal(draft.completedSteps, 12);
      assert.equal(draft.totalSteps, 24);
      await browser.close();

      // A fresh browser has no cookies, IndexedDB or cached draft selections.
      browser = await engine.launch();
      page = await openHost(browser, url);
      await page.locator("#host-resume:enabled").waitFor();
      await page.locator("#host-drafts").selectOption(draft.id);
      const info = page.locator("#host-draft-info");
      await info.filter({ hasText: /step 12 of 24/i }).waitFor();
      assert.match(await info.innerText(), /Fixture base/);
      assert.match(await info.innerText(), /Fixture teacher/);
      await page.locator("#host-resume").click();
      await page.locator("#reader-status").filter({ hasText: /Checkpoint saved/ }).waitFor({ timeout: 90000 });
      assert.equal(await page.locator("#reader-scores li").count(), 3);
      const finished = await catalog();
      assert.deepEqual(finished.drafts ?? [], []);
      const children = finished.models.filter(m => m.kind === "candidate");
      assert.equal(children.length, 1);
      const [child] = children;
      assert.equal(child.id, draft.id);
      assert.deepEqual(child.parents, { base: base.id, teacher: teacher.id });
      assert.equal(await page.locator("#reader-use").inputValue(), child.id);
      await page.locator("#reader-chat").click();
      assert.ok(await page.locator("#chat-reader-source").isHidden());
      await page.locator("#prompt").fill("Record: The alder gate is closed.\nQuestion: Is this gate open?\nAnswer:");
      await page.locator("#send").click();
      await page.locator(".message.assistant .message-label").filter({ hasText: /Local student.*LOCAL TRAINING HOST/ }).waitFor();
      assert.ok((await page.locator(".message.assistant .message-body").innerText()).trim());
      await page.locator(".reader-review").click();
      assert.match(await page.locator("#memory-content").inputValue(), new RegExp(child.id));
      assert.match(await page.locator("#memory-source").inputValue(), new RegExp(child.weightsSHA256));
      await page.reload();
      await page.locator("#chat-choose-reader").click();
      await page.locator("#reader-train:enabled").waitFor();
      await page.locator("#workshop-engine").selectOption("host");
      await page.locator("#reader-base").selectOption(child.id);
      assert.equal(await page.locator("#reader-base").inputValue(), child.id);
      t.diagnostic(JSON.stringify({ browser: engine.name(), base: base.id, teacher: teacher.id,
        pausedStep: draft.completedSteps, completedSteps: draft.totalSteps, child: child.id,
        weightsSHA256: child.weightsSHA256, chatAnswered: true }));
    });
}
