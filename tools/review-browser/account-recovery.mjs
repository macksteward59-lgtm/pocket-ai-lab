import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createPublicKey, randomUUID, verify } from "node:crypto";
import { once } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { chromium, webkit } from "playwright";

const project = fileURLToPath(new URL("../../", import.meta.url));
const mobile = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true };
const title = "Archive the orchard count";
const source = "🍐 Field note. The orchard has five pear trees. Recorded on Tuesday.";
const quote = "The orchard has five pear trees.";
const correction = "The count applies to the north plot.";
const password = "Pears-in-the-north-plot-2026";

// Binding port zero lets the OS allocate an unused port without a probe/close race.
// IPC announces readiness only after the real application server has bound its socket.
async function startHost(directory, port = 0) {
  const code = `
    import { createServer } from "./apps/web/server.mjs";
    const server = createServer();
    server.listen(Number(process.env.PORT), "127.0.0.1", () => process.send(server.address().port));
  `;
  const child = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "--eval", code], {
    cwd: project,
    env: {
      ...process.env, HOST: "127.0.0.1", PORT: String(port), POCKET_RECOVERY_DIR: directory,
      POCKET_MEMORY_DIR: path.join(directory, "memory"), POCKET_TRAINING_DIR: "",
      LLAMACPP_BASE_URL: "http://127.0.0.1:1"
    },
    stdio: ["ignore", "ignore", "inherit", "ipc"]
  });
  try {
    const [boundPort] = await Promise.race([
      once(child, "message", { signal: AbortSignal.timeout(20000) }),
      once(child, "exit").then(([code, signal]) => {
        throw new Error("Recovery host exited during startup: " + (signal || code));
      })
    ]);
    return { child, port: boundPort };
  } catch (error) {
    await stopHost(child);
    throw error;
  }
}

async function stopHost(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const stopped = once(child, "exit");
  child.kill("SIGKILL");
  await stopped;
}

async function openReview(page, url) {
  await page.goto(url);
  await page.locator("#mobile-menu").click();
  await page.locator('[data-view="recovery"]').click();
}

async function signIn(page, url, name, action = "login") {
  await openReview(page, url);
  await page.locator("#recovery-username").fill(name);
  await page.locator("#recovery-password").fill(password);
  await page.locator("#recovery-" + action).click();
  await page.locator("#recovery-logout").waitFor();
}

// Use the browser's own session cookie and origin on every request, just as the UI does.
async function request(page, input) {
  return page.evaluate(async body => {
    const response = await fetch("/api/recovery", { method: "POST", credentials: "same-origin",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() };
  }, input);
}

function verifyExport(evidence, jwk, id, expectedNotes) {
  const { payload, signature } = evidence;
  const key = createPublicKey({ key: jwk, format: "jwk" });
  assert.ok(verify("sha256", Buffer.from(JSON.stringify(payload)), { key, dsaEncoding: "ieee-p1363" },
    Buffer.from(signature, "base64")), "signature from the original host key");
  assert.equal(payload.schema, "pocket.source-review.v1");
  assert.equal(payload.taskId, id);
  assert.equal(payload.title, title);
  assert.equal(payload.owner, "orchard-owner");
  assert.equal(payload.source, source);
  assert.equal(payload.offset, source.indexOf(quote));
  assert.equal(payload.quote, quote);
  assert.equal(payload.executionCount, 1);
  assert.match(payload.attemptId, /^[0-9a-f-]{36}$/);
  assert.deepEqual(payload.corrections.map(item => item.note), expectedNotes);
}

async function saveAcceptance(engine, version, evidence, trustedKey, observations) {
  if (!process.env.RECOVERY_EVIDENCE_DIR) return;
  const destination = path.join(process.env.RECOVERY_EVIDENCE_DIR, engine);
  await mkdir(destination, { recursive: true });
  const receiptPath = path.join(destination, "signed-review.json");
  const keyPath = path.join(destination, "public-key.json");
  const save = (file, value) => writeFile(file, JSON.stringify(value, null, 2) + "\n", { flag: "wx" });
  const { kty, crv, x, y } = trustedKey;
  await save(receiptPath, evidence);
  await save(keyPath, { kty, crv, x, y });
  const { owner, taskId, attemptId } = evidence.payload;
  const cli = JSON.parse(execFileSync(process.execPath, [
    "tools/verify-review-task.mjs", receiptPath, keyPath, owner, taskId
  ], { cwd: project, encoding: "utf8" }));
  assert.deepEqual(cli, { verified: true, owner, taskId, attemptId, executionCount: 1, corrections: 1 });
  const checkoutCommit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: project, encoding: "utf8" }).trim();
  if (process.env.GITHUB_SHA) assert.equal(checkoutCommit, process.env.GITHUB_SHA);
  await save(path.join(destination, "acceptance.json"), {
    scope: "Synthetic exact-excerpt task on a loopback host in a mobile browser viewport",
    engine, browserVersion: version, nodeVersion: process.version, checkoutCommit,
    sourceHead: process.env.RECOVERY_SOURCE_HEAD || checkoutCommit,
    workflowRunId: process.env.GITHUB_RUN_ID || null,
    verified: true, taskId, attemptId, ...observations, cli
  });
}

for (const engine of [chromium, webkit]) {
  test(engine.name() + " recovers one account's signed review after interruption and a lost reply",
    { timeout: 120000 }, async t => {
      const directory = await mkdtemp(path.join(tmpdir(), "pocket-recovery-"));
      let browser, host;
      t.after(async () => {
        try { await browser?.close(); } finally {
          await stopHost(host?.child);
          await rm(directory, { recursive: true, force: true });
        }
      });
      host = await startHost(directory);
      const port = host.port;
      let restarts = 0;
      const restart = async () => {
        await stopHost(host.child);
        host = await startHost(directory, port);
        restarts++;
      };
      const url = "http://127.0.0.1:" + port;
      browser = await engine.launch();
      const original = await browser.newContext(mobile);
      const first = await original.newPage();
      await signIn(first, url, "orchard-owner", "register");
      await first.locator("#recovery-title").fill(title);
      await first.locator("#recovery-source").fill(source);
      await first.locator("#recovery-quote").fill(quote);
      await first.locator("#recovery-create").click();
      await first.locator("#recovery-run:enabled").waitFor();
      const id = await first.locator("#recovery-details").getAttribute("data-task-id");
      assert.match(id, /^[0-9a-f-]{36}$/);
      const key = await request(first, { action: "publicKey" });
      assert.equal(key.status, 200);
      await original.close();
      await restart();

      // Blocking only this client's service worker makes Playwright's network fault target the
      // browser request directly. route.fetch sends the actual request to the restarted server.
      const unreliable = await browser.newContext({ ...mobile, serviceWorkers: "block" });
      const resumed = await unreliable.newPage();
      await signIn(resumed, url, "orchard-owner");
      await resumed.locator("#recovery-tasks").getByRole("button", { name: title, exact: true }).click();
      const pending = await request(resumed, { action: "get", id });
      assert.equal(pending.body.task.status, "pending");
      const lost = Promise.withResolvers();
      await resumed.route("**/api/recovery", async route => {
        if (route.request().postDataJSON()?.action !== "run") return route.continue();
        try {
          const response = await route.fetch();
          assert.equal(response.status(), 200);
          const committed = (await response.json()).task.evidence;
          await route.abort("failed");
          lost.resolve(committed);
        } catch (error) { lost.reject(error); }
      });
      const failed = resumed.waitForEvent("requestfailed",
        req => req.url().endsWith("/api/recovery") && req.postDataJSON()?.action === "run");
      const [, , committed] = await Promise.all([resumed.locator("#recovery-run").click(), failed, lost.promise]);
      verifyExport(committed, key.body.key, id, []);
      await unreliable.close();
      await restart();

      const recovered = await browser.newContext(mobile);
      const owner = await recovered.newPage();
      await signIn(owner, url, "orchard-owner");
      const retries = await Promise.all([request(owner, { action: "run", id }), request(owner, { action: "run", id })]);
      for (const retry of retries) {
        assert.equal(retry.status, 200);
        assert.deepEqual(retry.body.task.evidence, committed);
      }
      await owner.locator("#recovery-tasks").getByRole("button", { name: title, exact: true }).click();
      await owner.locator("#recovery-verify").click();
      await owner.locator("#recovery-verdict").filter({ hasText: "Evidence verified" }).waitFor();
      await owner.locator("#recovery-note").fill(correction);
      await owner.locator("#recovery-correct").click();
      await owner.locator("#recovery-corrections").getByText(correction, { exact: true }).waitFor();
      await owner.locator("#recovery-logout").click();
      await owner.locator("#recovery-username").waitFor();
      await recovered.close();

      const other = await browser.newContext(mobile);
      const outsider = await other.newPage();
      await signIn(outsider, url, "orchard-reader", "register");
      const list = await request(outsider, { action: "list" });
      assert.equal(list.status, 200);
      assert.deepEqual(list.body.tasks, []);
      const crossAccount = {};
      for (const body of [{ action: "get", id }, { action: "run", id },
        { action: "correct", id, correctionId: randomUUID(), note: "Other account's proposed correction." }]) {
        const denied = await request(outsider, body);
        assert.equal(denied.status, 404);
        assert.ok(!JSON.stringify(denied.body).includes(quote));
        crossAccount[body.action] = denied.status;
      }
      await other.close();
      await restart();
      const final = await browser.newContext({ ...mobile, serviceWorkers: "block" });
      const page = await final.newPage();
      await signIn(page, url, "orchard-owner");
      await page.locator("#recovery-tasks").getByRole("button", { name: title, exact: true }).click();
      await page.locator("#recovery-corrections").getByText(correction, { exact: true }).waitFor();
      await page.locator("#recovery-verify").click();
      await page.locator("#recovery-verdict").filter({ hasText: "Evidence verified" }).waitFor();
      const result = await request(page, { action: "get", id });
      assert.equal(result.status, 200);
      const corrected = result.body.task.evidence;
      verifyExport(corrected, key.body.key, id, [correction]);
      assert.equal(corrected.payload.attemptId, committed.payload.attemptId);

      // Sign out from a second tab while the first tab is waiting for a real verification key.
      // Neither a saved passage nor a late verification may reappear after revocation.
      const peer = await final.newPage();
      await openReview(peer, url);
      await peer.locator("#recovery-logout").waitFor();
      await page.locator("#recovery-note").fill("Unsaved owner note");
      const intercepted = Promise.withResolvers();
      const release = Promise.withResolvers();
      const finished = Promise.withResolvers();
      await page.route("**/api/recovery", async route => {
        if (route.request().postDataJSON()?.action !== "publicKey") return route.continue();
        try {
          const response = await route.fetch();
          assert.equal(response.status(), 200);
          intercepted.resolve();
          await release.promise;
          // Engines differ on whether fulfilling an already-aborted request throws.
          try { await route.fulfill({ response }); } catch (error) {
            if (!route.request().failure()) throw error;
          }
          finished.resolve();
        } catch (error) { intercepted.reject(error); finished.reject(error); }
      });
      await Promise.all([page.locator("#recovery-verify").click(), intercepted.promise]);
      try {
        await peer.locator("#recovery-logout").click();
        await page.locator("#recovery-username").waitFor();
      } finally { release.resolve(); }
      await finished.promise;
      assert.ok(await page.locator("#recovery-details").isHidden());
      for (const field of ["selected-title", "passage", "excerpt", "verdict", "corrections"]) {
        assert.equal(await page.locator("#recovery-" + field).textContent(), "");
      }
      assert.equal(await page.locator("#recovery-note").inputValue(), "");
      await final.close();
      await stopHost(host.child);
      const db = new DatabaseSync(path.join(directory, "recovery.sqlite3"), { readOnly: true });
      try {
        const attempts = db.prepare("SELECT attempt_id FROM executions WHERE owner = ? AND task_id = ?")
          .all("orchard-owner", id);
        assert.deepEqual(attempts.map(row => row.attempt_id), [committed.payload.attemptId]);
        await saveAcceptance(engine.name(), browser.version(), corrected, key.body.key, {
          restarts, successfulRunReplyLost: true, concurrentRetries: retries.length,
          executionRows: attempts.length, crossAccount, peerSignOutClearedPrivateView: true
        });
      } finally { db.close(); }
      t.diagnostic("Three host restarts; one committed execution; two run retries; three cross-account denials; signed correction recovered.");
    });
}
