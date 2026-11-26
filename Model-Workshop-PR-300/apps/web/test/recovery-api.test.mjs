import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { createServer } from "../server.mjs";

test("review sessions are browser-private, owner-bound and revoked on sign-out", async t => {
  const originalDir = process.env.POCKET_RECOVERY_DIR;
  const directory = await mkdtemp(path.join(tmpdir(), "pocket-review-http-"));
  process.env.POCKET_RECOVERY_DIR = directory;
  const server = createServer();
  t.after(async () => {
    await new Promise(resolve => server.close(resolve));
    if (originalDir === undefined) delete process.env.POCKET_RECOVERY_DIR;
    else process.env.POCKET_RECOVERY_DIR = originalDir;
    await rm(directory, { recursive: true, force: true });
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = "http://127.0.0.1:" + server.address().port;
  const post = (input, headers = {}) => fetch(origin + "/api/recovery", {
    method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(input)
  });

  const register = { action: "register", username: "reader", password: randomUUID() };
  assert.equal((await post(register, { Origin: "https://example.org" })).status, 403);
  assert.equal((await post(register, { "Content-Type": "text/plain" })).status, 415);
  const response = await post(register);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { username: "reader" });
  const header = response.headers.get("set-cookie");
  assert.match(header, /HttpOnly/);
  assert.match(header, /SameSite=Strict/);
  const cookie = header.split(";")[0];
  assert.equal((await post({ action: "list", username: "reader" })).status, 401);
  assert.equal((await post({ action: "list" }, { cookie: cookie + "; " + cookie })).status, 401);
  const mismatch = await post({ action: "create", expectedOwner: "different" }, { cookie });
  assert.equal(mismatch.status, 409);
  assert.equal((await mismatch.json()).code, "account_changed");
  assert.deepEqual(await (await post({ action: "list" }, { cookie })).json(), { tasks: [] });
  const removed = await post({ action: "logout", expectedOwner: "reader" }, { cookie });
  assert.equal(removed.status, 200);
  assert.match(removed.headers.get("set-cookie"), /Max-Age=0/);
  assert.equal((await post({ action: "list" }, { cookie })).status, 401);
});
