import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createPublicKey, randomUUID, verify } from "node:crypto";
import { chmodSync, existsSync, mkdtempSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { openRecoveryStore } from "../recovery/store.mjs";

const password = "a synthetic local passphrase";
const storeUrl = new URL("../recovery/store.mjs", import.meta.url).href;

function fixture(t) {
  const dir = mkdtempSync(path.join(tmpdir(), "pocket-review-"));
  const store = openRecoveryStore(dir);
  const filename = path.join(dir, "recovery.sqlite3");
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  return { dir, store, filename };
}

function runChild(dir, id, mode) {
  // Fault injection occurs immediately after the actual SQLite insert, before COMMIT.
  const code = `
    import { DatabaseSync } from "node:sqlite";
    import { openRecoveryStore } from ${JSON.stringify(storeUrl)};
    const [directory, task, mode] = process.argv.slice(1);
    if (mode === "interrupt-in-transaction") {
      const prepare = DatabaseSync.prototype.prepare;
      DatabaseSync.prototype.prepare = function (sql) {
        const stmt = prepare.call(this, sql);
        if (sql.startsWith("INSERT INTO executions")) {
          return { run(...params) { stmt.run(...params); process.kill(process.pid, "SIGKILL"); } };
        }
        return stmt;
      };
    }
    const store = openRecoveryStore(directory);
    const result = store.run("alice", task);
    if (mode === "lose-reply-after-commit") process.kill(process.pid, "SIGKILL");
    process.stdout.write(result.evidence.payload.attemptId);
    store.close();
  `;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--no-warnings", "--input-type=module", "-e", code, dir, id, mode]);
    let output = "", error = "";
    child.stdout.on("data", chunk => { output += chunk; });
    child.stderr.on("data", chunk => { error += chunk; });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      if (code !== 0 && signal !== "SIGKILL") return reject(new Error(error || "Child failed."));
      resolve({ output, signal, code });
    });
  });
}

test("local accounts use separate names and secrets, persistent expiring sessions and logout", async t => {
  const { store, filename } = fixture(t);
  assert.equal(existsSync(filename), false);
  const alice = await store.register(" Alice ", password);
  const bob = await store.register("bob", "another synthetic password");
  assert.equal(alice.username, "alice");
  assert.notEqual(alice.token, bob.token);
  assert.equal(store.username(alice.token), "alice");
  await assert.rejects(store.register("ALICE", password), { status: 409 });
  await assert.rejects(store.login("alice", "wrong password here"), { status: 401 });
  await assert.rejects(store.login("does-not-exist", password), { status: 401 });
  await assert.rejects(store.register("bad name", password), { status: 400 });
  await assert.rejects(store.register("short", "x"), { status: 400 });
  await assert.rejects(store.register("malformed", password + "\ud800"), { status: 400 });
  const relogged = await store.login("ALICE", password);
  assert.notEqual(relogged.token, alice.token);
  store.close();
  assert.equal(store.username(alice.token), "alice");
  store.logout(alice.token);
  assert.equal(store.username(alice.token), null);
  assert.equal(store.username(bob.token), "bob");
  const db = new DatabaseSync(filename);
  try {
    const rows = db.prepare("SELECT salt,hash FROM accounts").all();
    assert.ok(rows.every(r => r.salt.length === 16 && r.hash.length === 32));
    assert.notDeepEqual(rows[0].salt, rows[1].salt);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sessions WHERE digest=?").get(bob.token).n, 0);
    db.prepare("UPDATE sessions SET expires=0 WHERE owner=?").run("alice");
    assert.equal(store.username(relogged.token), null);
    if (process.platform !== "win32") assert.equal(statSync(filename).mode & 0o777, 0o600);
  } finally { db.close(); }
});

test("source and corrections remain attributable, exact and isolated across accounts", async t => {
  const { store } = fixture(t);
  await store.register("alice", password);
  await store.register("bob", password);
  const input = { id: randomUUID(), title: "Reviewed passage", source: "🚲 Tall trees.\nTall grass.", quote: "Tall trees." };
  const initial = store.create("alice", input);
  assert.equal(initial.status, "pending");
  assert.deepEqual(store.create("alice", input), initial);
  assert.throws(() => store.create("alice", { ...input, title: "Changed title" }), { status: 409 });
  for (const change of [{ source: "aaa", quote: "aa" }, { quote: "Absent" }, { quote: " " },
    { source: "before\u0000after" }, { title: "unpaired\ud800" }]) {
    assert.throws(() => store.create("alice", { ...input, ...change, id: randomUUID() }), { status: 400 });
  }
  const correction = { id: randomUUID(), note: "Include this citation in the reading list." };
  assert.throws(() => store.correct("alice", input.id, correction), { status: 409 });
  assert.equal(store.list("bob").length, 0);
  for (const read of [() => store.get("bob", input.id), () => store.run("bob", input.id),
    () => store.correct("bob", input.id, correction)]) assert.throws(read, { status: 404 });
  const key = store.publicKey();
  assert.equal(key.crv, "P-256");
  assert.equal("d" in key, false);
  const completed = store.run("alice", input.id);
  assert.deepEqual(store.run("alice", input.id), completed);
  assert.equal(completed.evidence.payload.offset, 3);
  const revised = store.correct("alice", input.id, correction);
  assert.deepEqual(store.correct("alice", input.id, correction), revised);
  assert.throws(() => store.correct("alice", input.id, { ...correction, note: "different" }), { status: 409 });
  assert.deepEqual(revised.evidence.payload.corrections, [correction]);
  assert.equal(revised.evidence.payload.attemptId, completed.evidence.payload.attemptId);
  assert.equal(revised.evidence.payload.executionCount, 1);
  const { payload, signature } = revised.evidence;
  const publicKey = createPublicKey({ format: "jwk", key });
  const check = value => verify("sha256", Buffer.from(JSON.stringify(value)),
    { key: publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(signature, "base64"));
  assert.equal(check(payload), true);
  assert.equal(check({ ...payload, owner: "bob" }), false);
  store.close();
  assert.deepEqual(store.publicKey(), key);
  assert.deepEqual(store.get("alice", input.id), revised);
  // The request ID is scoped to its owner, even if both clients use the same UUID.
  assert.equal(store.create("bob", input).status, "pending");
  assert.equal(store.get("alice", input.id).status, "completed");
  assert.deepEqual(store.list("bob").map(row => row.status), ["pending"]);
});

test("SQLite recovers a killed transaction and replays a lost reply across concurrent processes", {
  skip: process.platform === "win32" ? "Process-kill acceptance uses POSIX signals." : false,
}, async t => {
  const { store, dir, filename } = fixture(t);
  await store.register("alice", password);
  const id = randomUUID();
  store.create("alice", { id, title: "Resume", source: "Use the marked text.", quote: "marked text" });
  store.close();
  assert.equal((await runChild(dir, id, "interrupt-in-transaction")).signal, "SIGKILL");
  assert.equal(store.get("alice", id).status, "pending");
  store.close();
  assert.equal((await runChild(dir, id, "lose-reply-after-commit")).signal, "SIGKILL");
  const clients = await Promise.all(Array.from({ length: 4 }, () => runChild(dir, id, "resume")));
  const completed = store.get("alice", id);
  assert.ok(clients.every(client => client.output === completed.evidence.payload.attemptId));
  const raced = randomUUID();
  store.create("alice", { id: raced, title: "Parallel start", source: "Review this sentence.", quote: "this sentence" });
  const starts = await Promise.all(Array.from({ length: 4 }, () => runChild(dir, raced, "resume")));
  assert.equal(new Set(starts.map(client => client.output)).size, 1);
  const db = new DatabaseSync(filename);
  try {
    const count = db.prepare("SELECT COUNT(*) AS n FROM executions WHERE owner=? AND task_id=?");
    assert.equal(count.get("alice", id).n, 1);
    assert.equal(count.get("alice", raced).n, 1);
  } finally { db.close(); }
});

test("private store refuses unsafe permissions or linked SQLite companions", {
  skip: process.platform === "win32" ? "POSIX file mode and symlink checks" : false,
}, t => {
  const { store, dir, filename } = fixture(t);
  chmodSync(dir, 0o755);
  assert.throws(() => store.publicKey(), { status: 503 });
  assert.equal(statSync(dir).mode & 0o777, 0o755);
  chmodSync(dir, 0o700);
  writeFileSync(path.join(dir, "unrelated"), "preserve", { mode: 0o600 });
  symlinkSync(path.join(dir, "unrelated"), filename + "-journal");
  assert.throws(() => store.publicKey(), { status: 503 });
});
