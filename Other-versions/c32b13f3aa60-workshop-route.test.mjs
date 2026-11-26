import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";
import { createServer } from "../server.mjs";

test("the host must opt in; cross-origin, invalid or form-encoded training requests are rejected", async t => {
  const saved = process.env.POCKET_TRAINING_DIR;
  delete process.env.POCKET_TRAINING_DIR;
  const server = createServer();
  t.after(() => {
    if (saved !== undefined) process.env.POCKET_TRAINING_DIR = saved;
    server.close();
    server.closeAllConnections();
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const url = "http://127.0.0.1:" + server.address().port + "/api/model-workshop";
  const request = { op: "build", base: "one", teacher: "two", name: "test" };
  const post = (headers, body = request) => fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
  assert.deepEqual(await (await fetch(url)).json(), { configured: false, models: [] });
  assert.equal((await post({ "Content-Type": "application/json" })).status, 503);
  assert.equal((await post({ "Content-Type": "application/json", Origin: "https://example.org" })).status, 403);
  assert.equal((await post({ "Content-Type": "text/plain" })).status, 415);
  assert.equal((await post({ "Content-Type": "application/json" }, { ...request, teacher: "../outside" })).status, 400);
});
