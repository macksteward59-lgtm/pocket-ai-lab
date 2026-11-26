import {
  createHash, createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes, randomUUID,
  scrypt, sign, timingSafeEqual, verify,
} from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { promisify } from "node:util";

const require = createRequire(import.meta.url);
const derive = promisify(scrypt);
const SESSION_MS = 8 * 60 * 60 * 1000;
const DUMMY_SALT = randomBytes(16);
const UUID = /^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i;
let activeDerivations = 0;

function fail(status, message) {
  throw Object.assign(new Error(message), { status });
}

function exactText(value, name, maxBytes) {
  if (typeof value !== "string" || !value.trim() || !value.isWellFormed() ||
      value.includes("\u0000") || Buffer.byteLength(value) > maxBytes) {
    fail(400, `Invalid ${name} (maximum ${maxBytes} UTF-8 bytes).`);
  }
  return value;
}

function identifier(value) {
  if (typeof value !== "string" || !UUID.test(value)) fail(400, "A UUID is required.");
  return value.toLowerCase();
}

function quoteOffset(source, quote) {
  const offset = source.indexOf(quote);
  if (offset < 0 || source.indexOf(quote, offset + 1) !== -1) {
    fail(400, "The exact quote must occur once in the source.");
  }
  return offset;
}

function accountName(value) {
  if (typeof value !== "string" || !/^[a-z\d][a-z\d._-]{0,47}$/i.test(value.trim())) {
    fail(400, "Use 1–48 letters, numbers, dots, underscores or hyphens for the account name.");
  }
  return value.trim().toLowerCase();
}

async function passwordHash(password, salt) {
  exactText(password, "password", 128);
  if (Buffer.byteLength(password) < 12) fail(400, "Use at least 12 UTF-8 bytes for the password.");
  if (activeDerivations >= 2) fail(429, "Sign-in is busy. Try again shortly.");
  activeDerivations++;
  try {
    return await derive(password, salt, 32, { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 });
  } finally {
    activeDerivations--;
  }
}

function tokenDigest(token) {
  if (typeof token !== "string" || !/^[a-f\d]{64}$/.test(token)) return null;
  return createHash("sha256").update(token).digest("hex");
}

function writeTransaction(db, operation) {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = operation();
    db.exec("COMMIT");
    return result;
  } catch (error) {
    try { db.exec("ROLLBACK"); } catch { /* SQLite may have already rolled back. */ }
    throw error;
  }
}

function checkPrivate(stat) {
  if ((typeof process.getuid === "function" && stat.uid !== process.getuid()) ||
      (process.platform !== "win32" && (stat.mode & 0o077) !== 0)) {
    fail(503, "Recovery storage requires a dedicated private directory and database.");
  }
}

function checkDatabaseFile(file) {
  if (!file.isFile() || file.nlink !== 1) fail(503, "Recovery storage needs a private database file.");
  checkPrivate(file);
}

function openDatabase(directory) {
  if (typeof directory !== "string" || !path.isAbsolute(directory)) {
    fail(503, "Recovery storage needs an absolute directory path.");
  }
  mkdirSync(directory, { mode: 0o700, recursive: true });
  const root = lstatSync(directory);
  if (!root.isDirectory()) fail(503, "Recovery storage needs a directory.");
  checkPrivate(root);
  const filename = path.join(directory, "recovery.sqlite3");
  for (const suffix of ["-journal", "-wal", "-shm"]) {
    const stat = lstatSync(filename + suffix, { throwIfNoEntry: false });
    if (stat) checkDatabaseFile(stat);
  }
  const fd = openSync(filename, constants.O_CREAT | constants.O_RDWR | (constants.O_NOFOLLOW ?? 0), 0o600);
  try {
    checkDatabaseFile(fstatSync(fd));
  } finally {
    closeSync(fd);
  }
  // Delay loading SQLite until the first recovery request. Other web routes need no database.
  const { DatabaseSync } = require("node:sqlite");
  const db = new DatabaseSync(filename);
  try {
    db.exec("PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL; PRAGMA trusted_schema=OFF");
    const signingKey = writeTransaction(db, () => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS accounts (
          name TEXT PRIMARY KEY, salt BLOB NOT NULL, hash BLOB NOT NULL
        ) STRICT;
        CREATE TABLE IF NOT EXISTS sessions (
          digest TEXT PRIMARY KEY, owner TEXT NOT NULL REFERENCES accounts(name), expires INTEGER NOT NULL
        ) STRICT;
        CREATE INDEX IF NOT EXISTS sessions_by_owner ON sessions(owner, expires);
        CREATE TABLE IF NOT EXISTS tasks (
          owner TEXT NOT NULL REFERENCES accounts(name), task_id TEXT NOT NULL, title TEXT NOT NULL,
          source TEXT NOT NULL, quote TEXT NOT NULL,
          PRIMARY KEY (owner, task_id)
        ) STRICT;
        CREATE TABLE IF NOT EXISTS executions (
          owner TEXT NOT NULL, task_id TEXT NOT NULL, attempt_id TEXT NOT NULL UNIQUE,
          payload TEXT NOT NULL, signature TEXT NOT NULL,
          PRIMARY KEY (owner, task_id), FOREIGN KEY (owner, task_id) REFERENCES tasks(owner, task_id)
        ) STRICT;
        CREATE TABLE IF NOT EXISTS signer (
          singleton INTEGER PRIMARY KEY CHECK(singleton = 1), private_key TEXT NOT NULL
        ) STRICT;
      `);
      const row = db.prepare("SELECT private_key FROM signer WHERE singleton=1").get();
      if (row) return createPrivateKey(row.private_key);
      if (db.prepare("SELECT 1 FROM accounts LIMIT 1").get()) fail(503, "Recovery signing key is missing.");
      const { privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
      const pem = privateKey.export({ type: "pkcs8", format: "pem" });
      db.prepare("INSERT INTO signer(singleton,private_key) VALUES (1,?)").run(pem);
      return privateKey;
    });
    return { db, signingKey, verifyKey: createPublicKey(signingKey) };
  } catch (error) {
    db.close();
    throw error;
  }
}

export function openRecoveryStore(directory) {
  let connection;
  function current() {
    return connection ??= openDatabase(directory);
  }

  function issueSession(db, owner) {
    const now = Date.now();
    db.prepare("DELETE FROM sessions WHERE expires<=?").run(now);
    // Bound the retained sessions per account. A new sign-in invalidates the oldest excess sessions.
    db.prepare(`DELETE FROM sessions WHERE owner=? AND digest NOT IN
      (SELECT digest FROM sessions WHERE owner=? ORDER BY expires DESC,rowid DESC LIMIT 15)`).run(owner, owner);
    const token = randomBytes(32).toString("hex");
    db.prepare("INSERT INTO sessions(digest,owner,expires) VALUES(?,?,?)")
      .run(tokenDigest(token), owner, now + SESSION_MS);
    return { username: owner, token };
  }

  function get(owner, id) {
    const { db } = current();
    const row = db.prepare(`SELECT t.task_id AS id,t.title,t.source,t.quote,e.payload,e.signature
      FROM tasks t LEFT JOIN executions e ON e.owner=t.owner AND e.task_id=t.task_id
      WHERE t.owner=? AND t.task_id=?`).get(owner, identifier(id));
    if (!row) fail(404, "Task not found.");
    const { payload, signature, ...task } = row;
    if (!payload) return { ...task, status: "pending" };
    return { ...task, status: "completed", evidence: { payload: JSON.parse(payload), signature } };
  }

  function signPayload(payload) {
    const { signingKey } = current();
    const json = JSON.stringify(payload);
    const bytes = sign("sha256", Buffer.from(json), { key: signingKey, dsaEncoding: "ieee-p1363" });
    return [json, bytes.toString("base64")];
  }

  return {
    close() {
      connection?.db.close();
      connection = undefined;
    },
    publicKey() {
      return current().verifyKey.export({ format: "jwk" });
    },
    async register(name, password) {
      const owner = accountName(name);
      const salt = randomBytes(16);
      const hash = await passwordHash(password, salt);
      const { db } = current();
      return writeTransaction(db, () => {
        if (db.prepare("SELECT 1 FROM accounts WHERE name=?").get(owner)) fail(409, "Account name already in use.");
        db.prepare("INSERT INTO accounts(name,salt,hash) VALUES(?,?,?)").run(owner, salt, hash);
        return issueSession(db, owner);
      });
    },
    async login(name, password) {
      const owner = accountName(name);
      const { db } = current();
      const row = db.prepare("SELECT salt,hash FROM accounts WHERE name=?").get(owner);
      const hash = await passwordHash(password, row?.salt ?? DUMMY_SALT);
      if (!row || !timingSafeEqual(hash, row.hash)) fail(401, "Incorrect account name or password.");
      return writeTransaction(db, () => issueSession(db, owner));
    },
    username(token) {
      const digest = tokenDigest(token);
      if (!digest) return null;
      return current().db.prepare("SELECT owner FROM sessions WHERE digest=? AND expires>?")
        .get(digest, Date.now())?.owner ?? null;
    },
    logout(token) {
      const digest = tokenDigest(token);
      if (digest) current().db.prepare("DELETE FROM sessions WHERE digest=?").run(digest);
    },
    list(owner) {
      return current().db.prepare(`SELECT t.task_id AS id,t.title,
        CASE WHEN e.task_id IS NULL THEN 'pending' ELSE 'completed' END AS status
        FROM tasks t LEFT JOIN executions e ON e.owner=t.owner AND e.task_id=t.task_id
        WHERE t.owner=? ORDER BY t.rowid DESC`).all(owner);
    },
    create(owner, input) {
      const id = identifier(input?.id);
      const title = exactText(input.title, "title", 160);
      const source = exactText(input.source, "source", 16384);
      const quote = exactText(input.quote, "quote", 4096);
      quoteOffset(source, quote);
      const { db } = current();
      return writeTransaction(db, () => {
        db.prepare(`INSERT INTO tasks(owner,task_id,title,source,quote) VALUES(?,?,?,?,?)
          ON CONFLICT(owner,task_id) DO NOTHING`).run(owner, id, title, source, quote);
        const task = get(owner, id);
        if (task.title !== title || task.source !== source || task.quote !== quote) {
          fail(409, "The task ID is already in use with different input.");
        }
        return task;
      });
    },
    get,
    run(owner, id) {
      const { db } = current();
      return writeTransaction(db, () => {
        const task = get(owner, id);
        if (task.status === "completed") return task;
        const attemptId = randomUUID();
        const payload = {
          schema: "pocket.source-review.v1", taskId: task.id, attemptId, owner, title: task.title,
          source: task.source, quote: task.quote, offset: quoteOffset(task.source, task.quote),
          executionCount: 1, corrections: [],
        };
        const [json, signature] = signPayload(payload);
        // This insert is the entire task's effect. No external call can outlive the transaction.
        db.prepare("INSERT INTO executions(owner,task_id,attempt_id,payload,signature) VALUES(?,?,?,?,?)")
          .run(owner, task.id, attemptId, json, signature);
        return get(owner, task.id);
      });
    },
    correct(owner, id, input) {
      const correctionId = identifier(input?.id);
      const note = exactText(input.note, "correction note", 2048);
      const { db, verifyKey } = current();
      return writeTransaction(db, () => {
        const task = get(owner, id);
        if (task.status !== "completed") fail(409, "Complete the task before adding a correction.");
        const { payload, signature } = task.evidence;
        const valid = verify("sha256", Buffer.from(JSON.stringify(payload)),
          { key: verifyKey, dsaEncoding: "ieee-p1363" }, Buffer.from(signature, "base64"));
        if (!valid || payload.owner !== owner || payload.taskId !== task.id ||
            payload.source !== task.source || payload.quote !== task.quote || payload.title !== task.title) {
          fail(409, "Existing evidence could not be verified.");
        }
        const prior = payload.corrections.find(c => c.id === correctionId);
        if (prior) {
          if (prior.note !== note) fail(409, "The correction ID is already in use with different text.");
          return task;
        }
        if (payload.corrections.length >= 128) fail(409, "This task has reached its correction limit.");
        payload.corrections.push({ id: correctionId, note });
        const [updated, nextSignature] = signPayload(payload);
        db.prepare("UPDATE executions SET payload=?,signature=? WHERE owner=? AND task_id=?")
          .run(updated, nextSignature, owner, task.id);
        return get(owner, task.id);
      });
    },
  };
}
