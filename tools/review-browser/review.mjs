import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { chromium, webkit } from "playwright";

const root = fileURLToPath(new URL("../../", import.meta.url));
const input = JSON.parse(await readFile(new URL("../openclaw-review/pr-245.activity.json", import.meta.url)));
const device = { viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true };

async function startServer(directory) {
  const child = spawn(process.execPath, ["--import", "tsx", "apps/web/server.mjs"], {
    cwd: root,
    env: { ...process.env, HOST: "127.0.0.1", PORT: "0", POCKET_MEMORY_DIR: directory },
    stdio: ["ignore", "pipe", "inherit"]
  });
  const lines = createInterface({ input: child.stdout });
  try {
    for await (const line of lines) {
      const match = /listening on (http:\/\/127\.0\.0\.1:[1-9][0-9]*)$/.exec(line);
      if (match) return {
        url: match[1],
        async stop(signal = "SIGTERM") {
          if (child.exitCode !== null || child.signalCode !== null) return;
          const exit = once(child, "exit");
          child.kill(signal);
          await exit;
        }
      };
      throw new Error("Unexpected server startup message: " + line);
    }
    throw new Error("Local server exited during startup");
  } catch (error) {
    child.kill();
    throw error;
  } finally {
    lines.close();
  }
}

async function openView(page, name) {
  await page.locator("#mobile-menu").click();
  await page.locator('[data-view="' + name + '"]').click();
}

async function importFile(page, data) {
  const buffer = Buffer.from(typeof data === "string" ? data : JSON.stringify(data));
  await page.locator("#review-file").setInputFiles({ name: "review.json", mimeType: "application/json", buffer });
}

for (const engine of [chromium, webkit]) {
  test(engine.name() + " preserves separate citations after an edit and an abrupt server restart",
    { timeout: 60000 }, async t => {
      const directory = await mkdtemp(path.join(tmpdir(), "pocket-citation-recovery-"));
      t.after(() => rm(directory, { recursive: true, force: true }));
      let server = await startServer(directory);
      t.after(() => server.stop());
      const refs = ["Research notebook, page 4", "https://example.org/study?pages=1,2"];
      const created = await fetch(server.url + "/api/memory", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: "Initial finding", sourceRefs: refs })
      });
      assert.equal(created.status, 201);
      const original = (await created.json()).entry;
      assert.deepEqual(original.provenance.sourceRefs, refs);
      const browser = await engine.launch();
      t.after(() => browser.close());
      const page = await browser.newPage(device);
      page.setDefaultTimeout(10000);
      await page.goto(server.url);
      await openView(page, "memory");
      const edit = page.getByRole("button", { name: "Edit", exact: true });
      const save = page.getByRole("button", { name: "Save changes" });
      const card = page.locator(".memory-entry");
      await edit.click();
      await page.getByLabel("Memory content", { exact: true }).fill("Reviewed finding");
      await save.click();
      await card.getByText("Reviewed finding", { exact: true }).waitFor();
      assert.deepEqual(await card.locator(".memory-source").allTextContents(), refs.map(r => "Source: " + r));
      await edit.click();
      const revised = [refs[0], "https://example.org/study?pages=2,4", "Review log, row 7"];
      await page.getByLabel("Source 2 (optional)", { exact: true }).fill(revised[1]);
      await page.getByRole("button", { name: "Add source" }).click();
      await page.getByLabel("Source 3 (optional)", { exact: true }).fill(revised[2]);
      await save.click();
      await card.getByText("Source: " + revised[2], { exact: true }).waitFor();
      await server.stop("SIGKILL");
      server = await startServer(directory);
      await page.goto(server.url);
      await openView(page, "memory");
      await card.getByText("Reviewed finding", { exact: true }).waitFor();
      assert.deepEqual(await card.locator(".memory-source").allTextContents(), revised.map(r => "Source: " + r));
      const list = await (await fetch(server.url + "/api/memory")).json();
      assert.deepEqual(list.entries, [{ ...original, content: "Reviewed finding",
        provenance: { ...original.provenance, verified: false, sourceRefs: revised } }]);
    });

  test(engine.name() + " reads a local draft and recovers the saved assessment after a process restart",
    { timeout: 90000 }, async t => {
      const directory = await mkdtemp(path.join(tmpdir(), "pocket-review-"));
      t.after(() => rm(directory, { recursive: true, force: true }));
      let server = await startServer(directory);
      t.after(() => server.stop());
      const browser = await engine.launch();
      t.after(() => browser.close());
      const context = await browser.newContext(device);
      const page = await context.newPage();
      page.setDefaultTimeout(10000);
      const writes = [];
      const errors = [];
      page.on("request", req => { if (req.method() === "POST") writes.push(new URL(req.url()).pathname); });
      page.on("pageerror", err => errors.push(err.message));
      await page.goto(server.url);
      await openView(page, "activity");
      const details = page.locator("#review-details");
      await details.waitFor();
      assert.equal(await page.locator("#review-draft").innerText(), input.receipt.final);
      assert.match(await page.locator("#review-evidence").innerText(), /359 provider/);

      for (const [badFile, error] of [
        [{ ...input, evidence_sha256: "0".repeat(64) }, "The file does not match"],
        ["{", "Invalid review JSON."],
        ["x".repeat(65537), "Choose a review file of 64 KiB or less."]
      ]) {
        await importFile(page, badFile);
        await page.getByText(error).waitFor();
        assert.equal(await details.isVisible(), false);
      }

      // Import the actual result of this run, separately from the bundled historical draft.
      const live = JSON.parse(Buffer.from(process.env.OPENCLAW_REVIEW_PACKET, "base64"));
      await importFile(page, live);
      await page.getByText("Imported draft ·", { exact: false }).waitFor();
      assert.equal(await page.locator("#review-draft").innerText(), live.receipt.final);
      // Older full receipts have no format tag. Metadata from a file must never replace the source.
      const oldFormat = { ...live, source: { ...live.source, local_tests: 999 }, review_status: "approved" };
      delete oldFormat.format;
      await importFile(page, oldFormat);
      await page.getByText("Imported draft ·", { exact: false }).waitFor();
      assert.match(await page.locator("#review-comparison").innerText(), /Correction needed|Check their meaning/);
      assert.doesNotMatch(await page.locator("#review-evidence").innerText(), /999/);
      assert.deepEqual(writes, []);

      await page.locator("#review-to-memory").click();
      const note = page.locator("#memory-content");
      assert.match(await note.inputValue(), /PR #245 CI evidence/);
      assert.match(await note.inputValue(), /Independent local validation passed 359 tests in 11 files/);
      assert.ok((await note.inputValue()).includes(input.evidence_sha256));
      const assessment = "Assessment: The local run passed 359 tests in 11 files.";
      await note.fill((await note.inputValue()) + "\n\n" + assessment);
      await openView(page, "activity");
      await page.locator("#review-to-memory").click();
      await page.getByText("A note is already being edited in Memory.", { exact: false }).waitFor();
      await openView(page, "memory");
      await page.locator("#memory-save").click();
      await page.locator(".memory-entry").waitFor();
      assert.deepEqual(writes, ["/api/memory"]);
      const before = (await (await fetch(server.url + "/api/memory")).json()).entries;
      assert.equal(before.length, 1);
      assert.equal(before[0].provenance.verified, false);
      assert.ok(before[0].provenance.sourceRefs[0].endsWith("/job/" + input.source.job_id));

      await context.close();
      await server.stop();
      server = await startServer(directory);
      const fresh = await browser.newContext(device);
      const reopened = await fresh.newPage();
      await reopened.goto(server.url);
      await openView(reopened, "memory");
      await reopened.locator(".memory-entry").waitFor();
      assert.ok((await reopened.locator(".memory-entry").innerText()).includes(assessment));
      const after = (await (await fetch(server.url + "/api/memory")).json()).entries;
      assert.deepEqual(after, before);

      // Exercise exactly the bytes Swift exported after reopening the journal.
      const packet = Buffer.from(process.env.NATIVE_REVIEW_PACKET, "base64");
      const expected = process.env.NATIVE_REVIEW_DIGEST;
      assert.match(expected, /^[0-9a-f]{64}$/);
      await openView(reopened, "activity");
      const uploadNative = data => reopened.locator("#native-review-file").setInputFiles({
        name: "native-attempt.json", mimeType: "application/json", buffer: data
      });
      const check = reopened.getByRole("button", { name: "Check evaluation" });
      await uploadNative(packet);
      await reopened.locator("#native-review-hash").fill("0".repeat(64));
      await check.click();
      await reopened.getByText("The file does not match the digest you supplied.").waitFor();
      await reopened.locator("#native-review-hash").fill(expected);
      const wrongType = JSON.parse(packet);
      wrongType.eventID = [wrongType.eventID];
      await uploadNative(Buffer.from(JSON.stringify(wrongType)));
      await check.click();
      await reopened.getByText("This file does not contain a supported evaluation event.").waitFor();
      const changed = JSON.parse(packet);
      changed.payloadJSON = changed.payloadJSON.replace("café", "cafe");
      await uploadNative(Buffer.from(JSON.stringify(changed)));
      await check.click();
      await reopened.getByText("The file does not match the digest you supplied.").waitFor();
      await uploadNative(packet);
      await check.click();
      await reopened.locator("#native-review-result").waitFor();
      assert.equal(await reopened.locator("#native-review-output").innerText(), "café\n茶");
      assert.match(await reopened.locator("#native-review-metadata").innerText(), /unverifiedProvider/);
      assert.equal((await (await fetch(server.url + "/api/memory")).json()).entries.length, 1);
      await reopened.locator("#native-to-memory").click();
      assert.equal(await reopened.locator("#memory-source").inputValue(), "urn:sha256:" + expected);
      await reopened.locator("#memory-save").click();
      await reopened.locator(".memory-entry").nth(1).waitFor();
      await fresh.close();
      await server.stop();
      server = await startServer(directory);
      const records = (await (await fetch(server.url + "/api/memory")).json()).entries;
      assert.equal(records.length, 2);
      assert.deepEqual(records.find(entry => entry.id === before[0].id), before[0]);
      const native = records.find(entry => entry.id !== before[0].id);
      assert.equal(native.provenance.verified, false);
      assert.deepEqual(native.provenance.sourceRefs, ["urn:sha256:" + expected]);
      assert.ok(native.content.includes("unicode-roundtrip"));
      if (process.env.POCKET_CI_REVIEW_DIR) {
        const summary = before[0].content + "\n\n" + native.content;
        assert.ok(Buffer.byteLength(summary) <= 4000);
        await writeFile(path.join(process.env.POCKET_CI_REVIEW_DIR, engine.name() + ".txt"), summary);
      }
      assert.deepEqual(errors, []);
    });
}
