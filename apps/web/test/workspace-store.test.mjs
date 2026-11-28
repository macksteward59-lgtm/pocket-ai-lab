import assert from "node:assert/strict";
import test from "node:test";
import { openWorkspace } from "../workspace/store.js";

// This small transactional test double exercises validation and record binding.
// Browser tests separately exercise native IndexedDB and competing connections;
// this double does not claim to implement IndexedDB's concurrency scheduler.
const copy = value => structuredClone(value);
const tick = () => new Promise(resolve => setImmediate(resolve));
const uuid = value => "00000000-0000-4000-8000-" + value.toString(16).padStart(12, "0");
const keyOf = (value, key) => Array.isArray(key) ? key.map(field => value[field]) : value[key];
const keyEqual = (left, right) => JSON.stringify(left) === JSON.stringify(right);

class MemoryFactory {
  tables = new Map();
  version = 0;
  writesUntilFailure = Infinity;
  holdCommit = false;
  held = [];
  open() {
    if (this.openFailure) throw this.openFailure;
    const request = {};
    queueMicrotask(() => {
      if (this.blocked) { request.onblocked?.({}); return; }
      if (this.version > 1) {
        request.error = new DOMException("Future database", "VersionError"); request.onerror?.({}); return;
      }
      const db = new MemoryDatabase(this);
      request.result = db;
      request.transaction = { abort() { throw new Error("Unexpected test upgrade abort"); } };
      if (!this.version) {
        request.onupgradeneeded?.({ oldVersion: 0 });
        this.version = 1;
      }
      request.onsuccess?.({});
    });
    return request;
  }
  release() { this.holdCommit = false; for (const commit of this.held.splice(0)) commit(); }
  record(store, identity) { return this.tables.get(store).rows.get(identity); }
}
class MemoryDatabase {
  constructor(factory) {
    this.factory = factory;
    this.objectStoreNames = { contains: name => factory.tables.has(name) };
  }
  createObjectStore(name) {
    const table = { rows: new Map(), indexes: new Map() };
    this.factory.tables.set(name, table);
    return {
      createIndex: (name, key, options = {}) => table.indexes.set(name, { key, ...options }),
      add: row => table.rows.set(row.id, copy(row)),
    };
  }
  transaction(names, mode) {
    if (this.closed) throw new DOMException("Closed", "InvalidStateError");
    return new MemoryTransaction(this.factory, names, mode);
  }
  close() { this.closed = true; }
}
class MemoryTransaction {
  constructor(factory, names, mode) {
    this.factory = factory; this.mode = mode; this.pending = 0; this.ended = false;
    this.tables = new Map(names.map(name => {
      const table = factory.tables.get(name);
      if (!table) throw new DOMException("Missing store", "NotFoundError");
      return [name, { rows: new Map([...table.rows].map(([id, row]) => [id, copy(row)])), indexes: table.indexes }];
    }));
    this.scheduleCommit();
  }
  request(work) {
    const request = {}; this.pending++;
    queueMicrotask(() => {
      if (this.ended) return;
      try {
        request.result = copy(work()); request.onsuccess?.({ target: request });
      } catch (error) { this.error = error; this.abort(); }
      this.pending--; this.scheduleCommit();
    });
    return request;
  }
  scheduleCommit() {
    setImmediate(() => {
      if (this.pending || this.ended || this.waiting) return;
      const commit = () => {
        if (this.pending || this.ended) return;
        this.ended = true;
        if (this.mode === "readwrite") {
          for (const [name, table] of this.tables) this.factory.tables.get(name).rows = table.rows;
        }
        this.oncomplete?.({});
      };
      if (this.factory.holdCommit) { this.waiting = true; this.factory.held.push(commit); }
      else commit();
    });
  }
  abort() {
    if (this.ended) return;
    this.ended = true; queueMicrotask(() => this.onabort?.({}));
  }
  objectStore(name) {
    const table = this.tables.get(name);
    if (!table) throw new DOMException("Outside transaction", "NotFoundError");
    const write = (row, add) => {
      const incoming = copy(row);
      return this.request(() => {
        if (this.mode !== "readwrite") throw new DOMException("Readonly", "ReadOnlyError");
        if (--this.factory.writesUntilFailure < 0) throw new DOMException("Full", "QuotaExceededError");
        if (add && table.rows.has(incoming.id)) throw new DOMException("Duplicate ID", "ConstraintError");
        for (const index of table.indexes.values()) {
          const value = keyOf(incoming, index.key);
          if (!index.unique || value === undefined) continue;
          if ([...table.rows.values()].some(row => row.id !== incoming.id && keyEqual(keyOf(row, index.key), value))) {
            throw new DOMException("Duplicate index", "ConstraintError");
          }
        }
        table.rows.set(incoming.id, incoming); return incoming.id;
      });
    };
    return {
      get: id => this.request(() => table.rows.get(id)),
      getAll: () => this.request(() => [...table.rows.values()]),
      add: row => write(row, true), put: row => write(row, false),
      index: name => {
        const index = table.indexes.get(name);
        if (!index) throw new DOMException("Missing index", "NotFoundError");
        return {
          get: value => this.request(() => [...table.rows.values()].find(row => keyEqual(keyOf(row, index.key), value))),
          getAll: value => this.request(() => [...table.rows.values()].filter(row => keyEqual(keyOf(row, index.key), value))),
        };
      },
    };
  }
}

async function fixture(t, options = {}) {
  const factory = new MemoryFactory(); let next = 1;
  const config = { indexedDB: factory, now: () => 1000, randomUUID: () => uuid(next++), ...options };
  const store = await openWorkspace(config);
  t.after(() => store.close());
  return { store, factory, config };
}
const rejectCode = (promise, code) => assert.rejects(promise, error => error.code === code);
const conversation = (store, projectId = null, extra = {}) => store.createConversation({ projectId, title: "Conversation", modelRef: null, ...extra });
const begin = (store, chat, requestId = uuid(10000), extra = {}) => store.beginTurn(chat.id, chat.revision, {
  requestId, text: "Question", modelRef: chat.modelRef, contextMessageIds: [], ...extra,
});
const draft = (projectId = null, extra = {}) => ({ kind: "tool", projectId, name: "Draft tool", description: "A proposed helper",
  instructions: "Review a supplied document", createdBy: "user", ...extra });
const browserModel = () => ({ location: "browser", id: "a".repeat(64), hash: "b".repeat(64), name: "Pinned reader" });

test("fresh workspace and reopening retain separate projects, chats, draft modes and selection", async t => {
  const { store, config } = await fixture(t);
  assert.deepEqual((await store.snapshot()).selection, { projectId: null, conversationId: null, revision: 1 });
  const project = await store.createProject({ name: " Research " });
  const scoped = await conversation(store, project.id), standalone = await conversation(store);
  const updated = await store.updateConversation(scoped.id, 1, { draft: "  unfinished\n", source: "Provided passage", draftKind: "team" });
  await store.setSelection({ projectId: project.id, conversationId: scoped.id }, 1);
  const reopened = await openWorkspace(config); t.after(() => reopened.close());
  assert.deepEqual((await reopened.loadConversation(scoped.id)).conversation, updated);
  assert.equal((await reopened.loadConversation(standalone.id)).conversation.draft, "");
  assert.equal((await reopened.snapshot()).selection.conversationId, scoped.id);
  assert.equal(project.name, "Research");
});

test("conversation, project and resource changes require exact non-boolean revisions", async t => {
  const { store } = await fixture(t);
  const project = await store.createProject({ name: "Original" });
  assert.equal((await store.renameProject(project.id, 1, { name: "Renamed" })).revision, 2);
  await rejectCode(store.renameProject(project.id, 1, { name: "Lost update" }), "conflict");
  const chat = await conversation(store);
  const saved = await store.updateConversation(chat.id, 1, { draft: "New draft" });
  await assert.rejects(store.updateConversation(chat.id, 1, { draft: "Old draft" }), error => error.code === "conflict" && error.latestRevision === 2);
  await rejectCode(store.updateConversation(chat.id, true, { draft: "Boolean" }), "invalid_input");
  saved.draft = "Caller changed its copy";
  assert.equal((await store.loadConversation(chat.id)).conversation.draft, "New draft");
});

test("caller mutation after invocation cannot alter the saved model reference", async t => {
  const { store } = await fixture(t), ref = browserModel();
  const pending = conversation(store, null, { modelRef: ref });
  ref.id = "c".repeat(64); ref.name = "Changed later";
  const chat = await pending;
  assert.equal(chat.modelRef.id, "a".repeat(64));
  assert.equal(chat.modelRef.name, "Pinned reader");
});

test("model references reject provider URLs, callbacks, unknown fields and malformed identities", async t => {
  const { store } = await fixture(t);
  for (const modelRef of [false, {}, { ...browserModel(), endpoint: "https://example.com" },
    { ...browserModel(), id: "display-name" }, { ...browserModel(), hash: "short" },
    { ...browserModel(), name: "x".repeat(161) }, { ...browserModel(), answer() {} },
    { ...browserModel(), location: "remote" }, { location: "host", id: "../model", hash: "a".repeat(64) }]) {
    await rejectCode(conversation(store, null, { modelRef }), "invalid_input");
  }
  assert.equal((await store.snapshot()).conversations.length, 0);
});

test("bounded text and explicit field sets reject oversized, unsafe and scope-changing input", async t => {
  const { store } = await fixture(t), chat = await conversation(store);
  for (const patch of [{}, { draft: "x".repeat(12001) }, { source: "x".repeat(6001) },
    { title: "x".repeat(161) }, { draft: "bad\0text" }, { projectId: uuid(2) },
    { revision: 20 }, { pendingRequestId: uuid(3) }, { draftKind: "execute" }, { draftKind: false }]) {
    await rejectCode(store.updateConversation(chat.id, 1, patch), "invalid_input");
  }
  await rejectCode(store.createProject({ name: "" }), "invalid_input");
  await rejectCode(store.createProject({ name: "Multiline\nname" }), "invalid_input");
  await rejectCode(store.createProject({ name: "x".repeat(121) }), "invalid_input");
  assert.equal((await store.loadConversation(chat.id)).conversation.revision, 1);
});

test("project references and selection membership are checked before committing", async t => {
  const { store } = await fixture(t);
  await rejectCode(conversation(store, uuid(999)), "not_found");
  const project = await store.createProject({ name: "Project" }), chat = await conversation(store, project.id);
  await rejectCode(store.setSelection({ projectId: null, conversationId: chat.id }, 1), "scope_mismatch");
  await rejectCode(store.setSelection({ projectId: uuid(777), conversationId: null }, 1), "not_found");
  await store.setSelection({ projectId: project.id, conversationId: chat.id }, 1);
  await rejectCode(store.setSelection({ projectId: null, conversationId: null }, 1), "conflict");
});

test("begin commits ordered message slots and finish preserves a newer draft and model selection", async t => {
  const { store } = await fixture(t);
  let chat = await conversation(store);
  chat = await store.updateConversation(chat.id, chat.revision, { draft: "Question", source: "Captured source" });
  const started = await begin(store, chat);
  assert.equal(started.conversation.draft, "");
  assert.equal(started.turn.source, "Captured source");
  assert.equal(started.userMessage.sequence, 0); assert.equal(started.assistantMessage.sequence, 1);
  const newer = await store.updateConversation(chat.id, started.conversation.revision, { draft: "Next question", source: "Next source", modelRef: browserModel() });
  const result = await store.finishTurn(started.turn.requestId, { status: "complete", text: "Original answer", attribution: "Configured model" });
  assert.equal(result.conversation.draft, newer.draft); assert.equal(result.conversation.source, newer.source);
  assert.deepEqual(result.conversation.modelRef, newer.modelRef);
  assert.equal(result.turn.source, "Captured source"); assert.equal(result.turn.modelRef, null);
  assert.equal(result.conversation.pendingRequestId, null);
  assert.deepEqual((await store.loadConversation(chat.id)).messages.map(row => row.text), ["Question", "Original answer"]);
});

test("pending and duplicate request guards do not add messages or reset existing drafts", async t => {
  const { store } = await fixture(t), chat = await conversation(store);
  const first = await begin(store, chat);
  await rejectCode(begin(store, first.conversation, uuid(10001)), "pending_turn");
  await store.finishTurn(first.turn.requestId, { status: "complete", text: "Answer" });
  const latest = (await store.loadConversation(chat.id)).conversation;
  await rejectCode(begin(store, latest, first.turn.requestId), "conflict");
  assert.equal((await store.loadConversation(chat.id)).messages.length, 2);
});

test("context IDs cannot cross chats, use pending messages, repeat IDs or reverse order", async t => {
  const { store } = await fixture(t), first = await conversation(store), other = await conversation(store);
  const started = await begin(store, first);
  await rejectCode(begin(store, other, uuid(10001), { contextMessageIds: [started.userMessage.id] }), "scope_mismatch");
  const finished = await store.finishTurn(started.turn.requestId, { status: "complete", text: "Answer" });
  for (const contextMessageIds of [[started.assistantMessage.id, started.userMessage.id], [started.userMessage.id, started.userMessage.id]]) {
    await rejectCode(begin(store, finished.conversation, uuid(10002), { contextMessageIds }), "invalid_input");
  }
  const second = await begin(store, finished.conversation, uuid(10003), { contextMessageIds: [started.userMessage.id, started.assistantMessage.id] });
  assert.deepEqual(second.turn.contextMessageIds, [started.userMessage.id, started.assistantMessage.id]);
});

test("finishing by request ID remains bound to the original conversation after selection changes", async t => {
  const { store } = await fixture(t), first = await conversation(store), other = await conversation(store);
  const started = await begin(store, first);
  await store.setSelection({ projectId: null, conversationId: other.id }, 1);
  await store.finishTurn(started.turn.requestId, { status: "complete", text: "Belongs to first" });
  assert.equal((await store.loadConversation(other.id)).messages.length, 0);
  assert.equal((await store.loadConversation(first.id)).messages[1].text, "Belongs to first");
  assert.equal((await store.snapshot()).selection.conversationId, other.id);
});

test("reopening never replays or interrupts pending work; explicit recovery blocks late completion", async t => {
  const { store, config } = await fixture(t), chat = await conversation(store);
  const started = await begin(store, chat);
  const reopened = await openWorkspace(config); t.after(() => reopened.close());
  assert.equal((await reopened.loadConversation(chat.id)).turns[0].status, "pending");
  assert.deepEqual(await reopened.recoverPending([started.turn.requestId, uuid(99999)]), {
    recovered: [started.turn.requestId], skipped: [uuid(99999)],
  });
  await rejectCode(store.finishTurn(started.turn.requestId, { status: "complete", text: "Late answer" }), "stale_turn");
  assert.equal((await store.loadConversation(chat.id)).messages[1].status, "interrupted");
});

test("identical completion is idempotent while changed or incomplete outcomes fail closed", async t => {
  const { store } = await fixture(t), chat = await conversation(store), started = await begin(store, chat);
  await rejectCode(store.finishTurn(started.turn.requestId, { status: "complete", text: "" }), "invalid_input");
  await rejectCode(store.finishTurn(started.turn.requestId, { status: "running", text: "Pretend" }), "invalid_input");
  const input = { status: "complete", text: "Answer", attribution: "Reader" };
  const first = await store.finishTurn(started.turn.requestId, input);
  assert.deepEqual(await store.finishTurn(started.turn.requestId, input), first);
  await rejectCode(store.finishTurn(started.turn.requestId, { ...input, text: "Rewritten" }), "stale_turn");
});

test("resource drafts remain non-executing, bounded and revisioned", async t => {
  const { store } = await fixture(t);
  const tool = await store.createResourceDraft(draft());
  assert.equal(tool.state, "draft"); assert.equal(tool.version, 1);
  const revised = await store.updateResourceDraft(tool.id, tool.revision, { instructions: "Updated specification" });
  assert.equal(revised.revision, 2); assert.equal(revised.state, "draft");
  await rejectCode(store.updateResourceDraft(tool.id, 1, { name: "Stale" }), "conflict");
  for (const patch of [{ state: "active" }, { kind: "agent" }, { projectId: uuid(99) }, { createdBy: "assistant" },
    { permissions: ["network"] }, { instructions: "x".repeat(12001) }, { description: "x".repeat(4001) }]) {
    await rejectCode(store.updateResourceDraft(tool.id, 2, patch), "invalid_input");
  }
  await rejectCode(store.createResourceDraft(draft(null, { authorized: true })), "invalid_input");
  await rejectCode(store.createResourceDraft(draft(null, { createdBy: "assistant" })), "invalid_input");
});

test("assistant resource creation binds scope, captured kind and a live originating turn", async t => {
  const { store } = await fixture(t), project = await store.createProject({ name: "Project" });
  const chat = await conversation(store, project.id, { draftKind: "tool" });
  const started = await begin(store, chat, uuid(10000), { kind: "resource-draft" });
  assert.equal(started.turn.resourceKind, "tool");
  const input = draft(project.id, { createdBy: "assistant", requestId: started.turn.requestId });
  await rejectCode(store.createResourceDraft({ ...input, projectId: null }), "scope_mismatch");
  await rejectCode(store.createResourceDraft({ ...input, kind: "team" }), "scope_mismatch");
  const saved = await store.createResourceDraft(input);
  assert.deepEqual(await store.createResourceDraft(input), saved);
  await store.finishTurn(started.turn.requestId, { status: "cancelled", text: "Stopped after draft save" });
  assert.deepEqual(await store.createResourceDraft(input), saved);
  await rejectCode(store.createResourceDraft({ ...input, instructions: "Changed retry" }), "conflict");
  await store.updateResourceDraft(saved.id, saved.revision, { instructions: "Owner changed this" });
  await rejectCode(store.createResourceDraft(input), "conflict");
});

test("stopped assistant requests and ordinary chat replies cannot create late resources", async t => {
  const { store } = await fixture(t);
  for (const [index, status] of ["failed", "cancelled", "interrupted"].entries()) {
    const chat = await conversation(store, null, { draftKind: "tool" });
    const started = await begin(store, chat, uuid(10000 + index), { kind: "resource-draft" });
    await store.finishTurn(started.turn.requestId, { status, text: "Stopped" });
    await rejectCode(store.createResourceDraft(draft(null, { createdBy: "assistant", requestId: started.turn.requestId })), "stale_turn");
  }
  const chat = await conversation(store), ordinary = await begin(store, chat, uuid(10010));
  await rejectCode(store.createResourceDraft(draft(null, { createdBy: "assistant", requestId: ordinary.turn.requestId })), "stale_turn");
  assert.equal((await store.snapshot()).resources.length, 0);
});

test("resource-draft mode is captured and must be chosen before beginning that request", async t => {
  const { store } = await fixture(t), chat = await conversation(store);
  await rejectCode(begin(store, chat, uuid(10000), { kind: "resource-draft" }), "invalid_input");
  const configured = await store.updateConversation(chat.id, chat.revision, { draftKind: "agent" });
  const started = await begin(store, configured, uuid(10001), { kind: "resource-draft" });
  await store.updateConversation(chat.id, started.conversation.revision, { draftKind: "team" });
  assert.equal((await store.loadConversation(chat.id)).turns[0].resourceKind, "agent");
});

test("unknown schemas and damaged records remain stored and do not erase healthy conversations", async t => {
  const { store, factory } = await fixture(t), healthy = await conversation(store), future = await conversation(store);
  factory.record("conversations", future.id).schema = 2;
  const savedFuture = copy(factory.record("conversations", future.id));
  const snapshot = await store.snapshot();
  assert.deepEqual(snapshot.conversations.map(row => row.id), [healthy.id]);
  assert.ok(snapshot.issues.some(issue => issue.id === future.id && issue.code === "unsupported_schema"));
  await rejectCode(store.loadConversation(future.id), "unsupported_schema");
  assert.deepEqual(factory.record("conversations", future.id), savedFuture);
  factory.record("conversations", healthy.id).modelRef = { location: "remote" };
  await rejectCode(store.updateConversation(healthy.id, 1, { draft: "Cannot replace corruption" }), "corrupt_record");
});

test("a damaged selection is reported without being automatically rewritten", async t => {
  const { store, factory } = await fixture(t);
  factory.record("metadata", "selection").projectId = uuid(9999);
  const before = copy(factory.record("metadata", "selection"));
  const snapshot = await store.snapshot();
  assert.equal(snapshot.selection, null);
  assert.ok(snapshot.issues.some(issue => issue.store === "metadata"));
  assert.deepEqual(factory.record("metadata", "selection"), before);
});

test("turn ordering uses message sequence even when timestamps tie and request UUID order reverses", async t => {
  const { store } = await fixture(t), chat = await conversation(store);
  const first = await begin(store, chat, uuid(99999));
  const completed = await store.finishTurn(first.turn.requestId, { status: "complete", text: "First answer" });
  const second = await begin(store, completed.conversation, uuid(10000));
  await store.finishTurn(second.turn.requestId, { status: "complete", text: "Second answer" });
  const loaded = await store.loadConversation(chat.id);
  assert.deepEqual(loaded.turns.map(row => row.requestId), [uuid(99999), uuid(10000)]);
  assert.deepEqual(loaded.messages.map(row => row.sequence), [0, 1, 2, 3]);
});

test("an aborted turn transaction leaves no partial user, assistant or request records", async t => {
  const { store, factory } = await fixture(t), chat = await conversation(store);
  factory.writesUntilFailure = 1;
  await rejectCode(begin(store, chat), "storage_full");
  factory.writesUntilFailure = Infinity;
  const loaded = await store.loadConversation(chat.id);
  assert.equal(loaded.messages.length, 0); assert.equal(loaded.turns.length, 0);
  assert.equal(loaded.conversation.pendingRequestId, null); assert.equal(loaded.conversation.revision, 1);
});

test("request success is not reported as saved before transaction completion", async t => {
  const { store, factory } = await fixture(t);
  factory.holdCommit = true;
  let saved = false;
  const pending = store.createProject({ name: "Not committed yet" }).then(result => { saved = true; return result; });
  await tick(); await tick();
  assert.equal(saved, false); assert.equal(factory.tables.get("projects").rows.size, 0);
  factory.release();
  assert.equal((await pending).name, "Not committed yet");
});

test("unavailable, blocked, future-version and closed stores fail explicitly", async t => {
  const unavailable = new MemoryFactory(); unavailable.openFailure = new DOMException("Denied", "SecurityError");
  await rejectCode(openWorkspace({ indexedDB: unavailable }), "storage_unavailable");
  const blocked = new MemoryFactory(); blocked.blocked = true;
  await rejectCode(openWorkspace({ indexedDB: blocked }), "storage_blocked");
  const future = new MemoryFactory(); future.version = 9;
  await rejectCode(openWorkspace({ indexedDB: future }), "unsupported_schema");
  const { store, config } = await fixture(t), saved = await conversation(store);
  store.close(); await rejectCode(store.snapshot(), "storage_unavailable");
  const reopened = await openWorkspace(config); t.after(() => reopened.close());
  assert.equal((await reopened.loadConversation(saved.id)).conversation.id, saved.id);
});
