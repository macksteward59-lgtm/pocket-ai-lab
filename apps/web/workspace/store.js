// Browser-local workspace records. These are drafts and transcripts, not account
// identities, execution permissions, or a replacement for the governed runtime.
const DATABASE = "pocket-ai-lab-conversational-workspace";
const VERSION = 1;
const STORES = ["projects", "conversations", "messages", "turns", "resources", "metadata"];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HASH = /^[0-9a-f]{64}$/;
const FINAL = ["complete", "failed", "cancelled", "interrupted"];
const KINDS = ["chat", "reader", "resource-draft"];
const RESOURCE_KINDS = ["tool", "agent", "team"];
const COMMON = ["schema", "id", "revision", "createdAt", "updatedAt"];
const LIMIT = { name: 120, title: 160, text: 12000, source: 6000, description: 4000,
  instructions: 12000, answer: 64000, attribution: 160, context: 64 };

function failure(code, message, extra = {}) {
  return Object.assign(new Error(message), { code, ...extra });
}
function requireThat(ok, message, code = "invalid_input") {
  if (!ok) throw failure(code, message);
}
function fields(value, required, optional = []) {
  requireThat(value !== null && typeof value === "object" &&
    Object.getPrototypeOf(value) === Object.prototype &&
    required.every(key => Object.hasOwn(value, key)) &&
    Object.keys(value).every(key => required.includes(key) || optional.includes(key)),
  "The workspace record has missing or unsupported fields.");
}
function id(value) {
  requireThat(typeof value === "string" && UUID.test(value), "Choose a valid browser-local record ID.");
  return value;
}
function projectId(value) { return value === null ? null : id(value); }
function revision(value) {
  requireThat(Number.isSafeInteger(value) && value >= 1, "Choose a valid record revision.");
  return value;
}
function string(value, maximum, { nonempty = false, singleLine = false } = {}) {
  requireThat(typeof value === "string" && value.length <= maximum &&
    (!nonempty || value.trim().length > 0) && !/[\u0000\ud800-\udfff]/u.test(value) &&
    (!singleLine || !/[\u0000-\u001f\u007f-\u009f]/u.test(value)),
  "The workspace text is empty, too long, or contains unsupported characters.");
  return value;
}
function name(value, maximum = LIMIT.name) {
  return string(value, maximum, { nonempty: true, singleLine: true }).trim();
}
function modelReference(value) {
  if (value === null) return null;
  fields(value, ["location", "id", "hash"], ["name"]);
  requireThat(value.location === "browser" || value.location === "host", "Choose a supported model location.");
  requireThat(typeof value.id === "string" && (value.location === "browser"
    ? /^(?:build-)?[0-9a-f]{64}$/.test(value.id) : /^[a-zA-Z0-9_:-]{1,96}$/.test(value.id)),
  "Choose an exact saved model identity.");
  requireThat(typeof value.hash === "string" && HASH.test(value.hash), "The model reference needs its exact weight hash.");
  if (Object.hasOwn(value, "name")) string(value.name, LIMIT.attribution, { nonempty: true, singleLine: true });
  return structuredClone(value);
}
function same(a, b) {
  if (a === b) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object" || Array.isArray(a) !== Array.isArray(b)) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b, key) && same(a[key], b[key]));
}
function common(row) {
  requireThat(row.schema === VERSION, "This record uses an unsupported workspace schema.", "unsupported_schema");
  id(row.id); revision(row.revision);
  requireThat(Number.isSafeInteger(row.createdAt) && row.createdAt >= 0 &&
    Number.isSafeInteger(row.updatedAt) && row.updatedAt >= row.createdAt, "Invalid workspace timestamps.");
}
function contextIds(value) {
  requireThat(Array.isArray(value) && value.length <= LIMIT.context, "A turn may reference up to 64 context messages.");
  value.forEach(id);
  requireThat(new Set(value).size === value.length, "Context message IDs must be distinct.");
  return [...value];
}
function validateRecord(store, row) {
  if (store === "metadata") {
    fields(row, ["id", "schema", "revision", "projectId", "conversationId", "createdAt", "updatedAt"]);
    requireThat(row.id === "selection", "Invalid workspace selection.");
    common({ ...row, id: "00000000-0000-4000-8000-000000000000" });
    projectId(row.projectId);
    if (row.conversationId !== null) id(row.conversationId);
    return row;
  }
  if (store === "projects") {
    fields(row, [...COMMON, "name"]); common(row); name(row.name);
  } else if (store === "conversations") {
    fields(row, [...COMMON, "projectId", "title", "draft", "draftKind", "source", "modelRef", "pendingRequestId", "nextSequence"]);
    common(row); projectId(row.projectId); name(row.title, LIMIT.title);
    string(row.draft, LIMIT.text); string(row.source, LIMIT.source); modelReference(row.modelRef);
    requireThat(["", ...RESOURCE_KINDS].includes(row.draftKind), "Invalid assistant draft mode.");
    if (row.pendingRequestId !== null) id(row.pendingRequestId);
    requireThat(Number.isSafeInteger(row.nextSequence) && row.nextSequence >= 0, "Invalid message sequence.");
  } else if (store === "messages") {
    fields(row, [...COMMON, "conversationId", "projectId", "requestId", "role", "text", "status", "attribution", "sequence"]);
    common(row); id(row.conversationId); projectId(row.projectId); id(row.requestId);
    requireThat(row.role === "user" || row.role === "assistant", "Unsupported message role.");
    string(row.text, row.role === "user" ? LIMIT.text : LIMIT.answer);
    string(row.attribution, LIMIT.attribution, { singleLine: true });
    requireThat((row.role === "user" && row.status === "complete") ||
      (row.role === "assistant" && ["pending", ...FINAL].includes(row.status)), "Invalid message status.");
    requireThat(Number.isSafeInteger(row.sequence) && row.sequence >= 0, "Invalid message order.");
  } else if (store === "turns") {
    fields(row, [...COMMON, "requestId", "conversationId", "projectId", "kind", "status", "userMessageId",
      "assistantMessageId", "modelRef", "source", "contextMessageIds", "resourceKind"]);
    common(row); id(row.requestId); id(row.conversationId); projectId(row.projectId);
    requireThat(row.id === row.requestId, "Turn and request identities differ.");
    id(row.userMessageId); id(row.assistantMessageId);
    requireThat(row.userMessageId !== row.assistantMessageId, "A turn needs distinct message slots.");
    requireThat(KINDS.includes(row.kind) && ["pending", ...FINAL].includes(row.status), "Invalid turn kind or status.");
    requireThat(row.kind === "resource-draft" ? RESOURCE_KINDS.includes(row.resourceKind) : row.resourceKind === "", "Invalid captured resource kind.");
    modelReference(row.modelRef); string(row.source, LIMIT.source); contextIds(row.contextMessageIds);
  } else if (store === "resources") {
    fields(row, [...COMMON, "kind", "projectId", "name", "description", "instructions", "createdBy", "state", "version"], ["requestId"]);
    common(row); validateResourceInput(resourceInput(row));
    requireThat(row.state === "draft" && row.version === 1, "Only version-one resource drafts belong in this workspace.");
  } else throw failure("invalid_input", "Unknown workspace record type.");
  return row;
}
function checkedRecord(store, row) {
  requireThat(row !== undefined, "The workspace record no longer exists.", "not_found");
  if (row && typeof row === "object" && Object.hasOwn(row, "schema") && row.schema !== VERSION) {
    throw failure("unsupported_schema", "This saved record belongs to another workspace schema. Its data was preserved.");
  }
  try { return validateRecord(store, row); }
  catch (error) {
    throw failure(error.code === "unsupported_schema" ? error.code : "corrupt_record",
      "A saved " + store + " record cannot be used. Its stored data was preserved.");
  }
}
function resourceInput(row) {
  const result = {};
  for (const key of ["kind", "projectId", "name", "description", "instructions", "createdBy", "requestId"]) {
    if (Object.hasOwn(row, key)) result[key] = row[key];
  }
  return result;
}
function validateResourceInput(input) {
  fields(input, ["kind", "projectId", "name", "description", "instructions", "createdBy"], ["requestId"]);
  requireThat(RESOURCE_KINDS.includes(input.kind), "Choose a tool, agent, or team draft.");
  projectId(input.projectId); name(input.name); string(input.description, LIMIT.description);
  string(input.instructions, LIMIT.instructions);
  requireThat(input.createdBy === "user" || input.createdBy === "assistant", "Choose a supported draft creator.");
  requireThat(input.createdBy === "assistant" ? Object.hasOwn(input, "requestId") : !Object.hasOwn(input, "requestId"),
    "Assistant drafts require their originating request; user drafts must not claim one.");
  if (Object.hasOwn(input, "requestId")) id(input.requestId);
  return { ...structuredClone(input), name: name(input.name) };
}
function storageError(error) {
  if (typeof error?.code === "string") return error;
  if (error?.name === "QuotaExceededError") return failure("storage_full", "Browser storage is full. Your unsaved text has not been discarded.");
  if (error?.name === "VersionError") return failure("unsupported_schema", "A newer app version owns this workspace. Reload the current app; stored data was preserved.");
  return failure("storage_unavailable", "Could not access the workspace in this browser. Existing data was not reset.");
}
function changed(row, patch, now) {
  requireThat(row.revision < Number.MAX_SAFE_INTEGER, "This record cannot accept another revision.", "conflict");
  return { ...row, ...patch, revision: row.revision + 1, updatedAt: Math.max(row.updatedAt, now) };
}
function selectionView(row) {
  return { projectId: row.projectId, conversationId: row.conversationId, revision: row.revision };
}

export async function openWorkspace(options = {}) {
  fields(options, [], ["indexedDB", "now", "randomUUID"]);
  const factory = options.indexedDB ?? globalThis.indexedDB;
  const clock = options.now ?? Date.now;
  const newId = options.randomUUID ?? (() => globalThis.crypto.randomUUID());
  function now() {
    const value = clock();
    requireThat(Number.isSafeInteger(value) && value >= 0, "The workspace clock is invalid.");
    return value;
  }
  function freshId() { return id(newId()); }
  function fresh(identity, timestamp) { return { schema: VERSION, id: identity, revision: 1, createdAt: timestamp, updatedAt: timestamp }; }
  let closed = false;
  const db = await new Promise((resolve, reject) => {
    let request, blocked = false;
    try { request = factory.open(DATABASE, VERSION); }
    catch (error) { reject(storageError(error)); return; }
    request.onblocked = () => {
      blocked = true;
      reject(failure("storage_blocked", "Another tab is blocking workspace storage. Close that tab and try again."));
    };
    request.onupgradeneeded = event => {
      if (blocked || event.oldVersion !== 0) { request.transaction.abort(); return; }
      try {
        for (const store of STORES) {
          const table = request.result.createObjectStore(store, { keyPath: "id" });
          if (store === "messages" || store === "turns") table.createIndex("conversationId", "conversationId");
          if (store === "messages") table.createIndex("conversationSequence", ["conversationId", "sequence"], { unique: true });
          if (store === "resources") table.createIndex("requestId", "requestId", { unique: true });
          if (store === "metadata") {
            const timestamp = now();
            table.add({ ...fresh("selection", timestamp), projectId: null, conversationId: null });
          }
        }
      } catch (error) { request.transaction.abort(); reject(storageError(error)); }
    };
    request.onerror = () => reject(storageError(request.error));
    request.onsuccess = () => {
      const connection = request.result;
      if (blocked || !STORES.every(store => connection.objectStoreNames.contains(store))) {
        connection.close(); reject(failure("unsupported_schema", "Workspace stores are missing. Existing data was preserved.")); return;
      }
      connection.onversionchange = () => { closed = true; connection.close(); };
      connection.onclose = () => { closed = true; };
      resolve(connection);
    };
  });

  // Request callbacks keep the transaction active. Never await a network request,
  // hash, or other asynchronous operation between a conditional read and its write.
  function transaction(stores, mode, work) {
    return new Promise((resolve, reject) => {
      if (closed) { reject(failure("storage_unavailable", "Workspace storage is closed. Reload or reopen it.")); return; }
      let tx, result, error;
      function guard(callback) {
        try { callback(); }
        catch (cause) { error = storageError(cause); try { tx.abort(); } catch { reject(error); } }
      }
      try {
        tx = db.transaction([...new Set(stores)], mode);
        tx.oncomplete = () => resolve(structuredClone(result));
        tx.onabort = () => reject(error ?? storageError(tx.error));
        const context = {
          store: name => tx.objectStore(name),
          read(request, callback) { request.onsuccess = () => guard(() => callback(request.result)); },
          done(value) { result = value; },
        };
        guard(() => work(context));
      } catch (cause) {
        error = storageError(cause);
        if (tx) { try { tx.abort(); } catch { reject(error); } } else reject(error);
      }
    });
  }
  function get(context, store, identity, callback) {
    context.read(context.store(store).get(identity), row => callback(checkedRecord(store, row)));
  }
  function checkProject(context, identity, callback) {
    if (identity === null) callback();
    else get(context, "projects", identity, callback);
  }
  function assertScope(left, right) {
    requireThat(left.projectId === right.projectId, "Records from different projects cannot be combined.", "scope_mismatch");
  }
  function put(context, store, record) {
    validateRecord(store, record);
    context.store(store).put(record);
  }
  function list(context, store, callback) { context.read(context.store(store).getAll(), callback); }
  function safeRows(store, rows, issues) {
    return rows.filter(row => {
      try { checkedRecord(store, row); return true; }
      catch (error) {
        issues.push({ store, id: typeof row?.id === "string" && row.id.length <= 128 ? row.id : null,
          code: error.code, message: error.message });
        return false;
      }
    });
  }
  function scopeIssue(store, row, issues) {
    issues.push({ store, id: row.id, code: "scope_mismatch", message: "This record references unavailable or inconsistent project data. It was preserved." });
    return false;
  }
  function mutate(store, identity, expected, patch, validatePatch) {
    id(identity); revision(expected);
    const input = validatePatch(patch);
    return transaction([store, "projects"], "readwrite", context => {
      get(context, store, identity, row => {
        if (row.revision !== expected) throw failure("conflict", "This record changed. Reload it before saving.", { latestRevision: row.revision });
        checkProject(context, store === "projects" ? null : row.projectId, () => {
          const updated = changed(row, input, now());
          put(context, store, updated); context.done(updated);
        });
      });
    });
  }
  const api = {
    async snapshot() {
      return transaction(STORES, "readonly", context => {
        const raw = {}, issues = [];
        let remaining = 4;
        for (const store of ["projects", "conversations", "resources", "metadata"]) list(context, store, rows => {
          raw[store] = rows;
          if (--remaining) return;
          const projects = safeRows("projects", raw.projects, issues);
          const projectIds = new Set(projects.map(row => row.id));
          const inScope = (store, row) => row.projectId === null || projectIds.has(row.projectId) || scopeIssue(store, row, issues);
          const conversations = safeRows("conversations", raw.conversations, issues).filter(row => inScope("conversations", row));
          const resources = safeRows("resources", raw.resources, issues).filter(row => inScope("resources", row));
          const selections = safeRows("metadata", raw.metadata, issues);
          let selection = selections.find(row => row.id === "selection") ?? null;
          if (selection && (!inScope("metadata", selection) || (selection.conversationId !== null &&
            !conversations.some(row => row.id === selection.conversationId && row.projectId === selection.projectId)))) {
            scopeIssue("metadata", selection, issues); selection = null;
          }
          if (!raw.metadata.some(row => row.id === "selection")) issues.push({ store: "metadata", id: "selection", code: "corrupt_record", message: "The saved selection is missing. Other records were preserved." });
          const sort = rows => rows.sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id));
          context.done({ projects: sort(projects), conversations: sort(conversations), resources: sort(resources),
            selection: selection && selectionView(selection), issues });
        });
      });
    },
    async loadConversation(identity) {
      id(identity);
      return transaction(["projects", "conversations", "messages", "turns"], "readonly", context => {
        get(context, "conversations", identity, conversation => checkProject(context, conversation.projectId, () => {
          context.read(context.store("messages").index("conversationId").getAll(identity), messageRows => {
            context.read(context.store("turns").index("conversationId").getAll(identity), turnRows => {
              const issues = [];
              const validMessages = safeRows("messages", messageRows, issues);
              const byMessage = new Map(validMessages.map(row => [row.id, row]));
              const turns = safeRows("turns", turnRows, issues).filter(row => {
                const user = byMessage.get(row.userMessageId), assistant = byMessage.get(row.assistantMessageId);
                return (row.projectId === conversation.projectId && row.conversationId === identity &&
                  user?.role === "user" && assistant?.role === "assistant" &&
                  [user, assistant].every(message => message.projectId === conversation.projectId &&
                    message.conversationId === identity && message.requestId === row.requestId) &&
                  assistant.status === row.status && assistant.sequence === user.sequence + 1) || scopeIssue("turns", row, issues);
              });
              const byRequest = new Map(turns.map(row => [row.requestId, row]));
              const messages = validMessages.filter(row => {
                const turn = byRequest.get(row.requestId);
                return (row.projectId === conversation.projectId && row.conversationId === identity && turn &&
                  (row.role === "user" ? turn.userMessageId === row.id : turn.assistantMessageId === row.id && turn.status === row.status)) ||
                  scopeIssue("messages", row, issues);
              }).sort((a, b) => a.sequence - b.sequence || a.id.localeCompare(b.id));
              context.done({ conversation, messages, turns: turns.sort((a, b) =>
                byMessage.get(a.userMessageId).sequence - byMessage.get(b.userMessageId).sequence), issues });
            });
          });
        }));
      });
    },
    async createProject(input) {
      fields(input, ["name"]);
      const value = name(input.name), timestamp = now();
      const record = { ...fresh(freshId(), timestamp), name: value };
      return transaction(["projects"], "readwrite", context => { context.store("projects").add(record); context.done(record); });
    },
    async renameProject(identity, expected, patch) {
      return mutate("projects", identity, expected, patch, value => { fields(value, ["name"]); return { name: name(value.name) }; });
    },
    async createConversation(input) {
      fields(input, ["projectId", "title", "modelRef"], ["draftKind"]);
      const scope = projectId(input.projectId), title = name(input.title, LIMIT.title), modelRef = modelReference(input.modelRef);
      const draftKind = input.draftKind ?? "";
      requireThat(["", ...RESOURCE_KINDS].includes(draftKind), "Choose a supported assistant draft mode.");
      const timestamp = now();
      const record = { ...fresh(freshId(), timestamp), projectId: scope, title, draft: "", draftKind, source: "", modelRef,
        pendingRequestId: null, nextSequence: 0 };
      return transaction(["projects", "conversations"], "readwrite", context => checkProject(context, scope, () => {
        context.store("conversations").add(record); context.done(record);
      }));
    },
    async updateConversation(identity, expected, patch) {
      return mutate("conversations", identity, expected, patch, value => {
        fields(value, [], ["title", "draft", "draftKind", "source", "modelRef"]);
        requireThat(Object.keys(value).length > 0, "Choose a conversation field to update.");
        const copy = structuredClone(value);
        if (Object.hasOwn(copy, "title")) copy.title = name(copy.title, LIMIT.title);
        if (Object.hasOwn(copy, "draft")) string(copy.draft, LIMIT.text);
        if (Object.hasOwn(copy, "draftKind")) requireThat(["", ...RESOURCE_KINDS].includes(copy.draftKind), "Choose a supported assistant draft mode.");
        if (Object.hasOwn(copy, "source")) string(copy.source, LIMIT.source);
        if (Object.hasOwn(copy, "modelRef")) copy.modelRef = modelReference(copy.modelRef);
        return copy;
      });
    },
    async setSelection(input, expected) {
      fields(input, ["projectId", "conversationId"]); revision(expected);
      const scope = projectId(input.projectId), identity = input.conversationId === null ? null : id(input.conversationId);
      return transaction(["projects", "conversations", "metadata"], "readwrite", context => {
        get(context, "metadata", "selection", existing => {
          if (existing.revision !== expected) throw failure("conflict", "The saved selection changed. Reload it before selecting.", { latestRevision: existing.revision });
          checkProject(context, scope, () => {
            function save(conversation) {
              if (conversation) requireThat(conversation.projectId === scope, "The conversation does not belong to the selected project.", "scope_mismatch");
              const updated = changed(existing, { projectId: scope, conversationId: identity }, now());
              put(context, "metadata", updated); context.done(selectionView(updated));
            }
            if (identity === null) save(); else get(context, "conversations", identity, save);
          });
        });
      });
    },
    async beginTurn(identity, expected, input) {
      id(identity); revision(expected);
      fields(input, ["requestId", "text", "modelRef", "contextMessageIds"], ["kind"]);
      const requestId = id(input.requestId), text = string(input.text, LIMIT.text, { nonempty: true });
      const modelRef = modelReference(input.modelRef), contextMessageIds = contextIds(input.contextMessageIds);
      const kind = input.kind ?? "chat";
      requireThat(KINDS.includes(kind), "Choose a supported turn kind.");
      const userId = freshId(), assistantId = freshId();
      requireThat(userId !== assistantId, "Message identities must be distinct.");
      return transaction(["projects", "conversations", "turns", "messages"], "readwrite", context => {
        get(context, "conversations", identity, conversation => checkProject(context, conversation.projectId, () => {
          if (conversation.revision !== expected) throw failure("conflict", "The conversation changed before this request was saved.", { latestRevision: conversation.revision });
          requireThat(conversation.pendingRequestId === null, "This conversation already has an unfinished request.", "pending_turn");
          requireThat(same(conversation.modelRef, modelRef), "The selected model changed before this request was saved.", "conflict");
          requireThat(kind !== "resource-draft" || RESOURCE_KINDS.includes(conversation.draftKind), "Choose the type of resource draft before sending.");
          requireThat(conversation.nextSequence <= Number.MAX_SAFE_INTEGER - 2, "This conversation cannot accept more messages.");
          context.read(context.store("turns").get(requestId), existing => {
            requireThat(existing === undefined, "This request ID is already recorded. It must not be sent again.", "conflict");
            let index = 0, priorSequence = -1;
            function next() {
              if (index < contextMessageIds.length) {
                get(context, "messages", contextMessageIds[index++], message => {
                  assertScope(message, conversation);
                  requireThat(message.conversationId === identity && message.status === "complete", "Context must use completed messages from this conversation.", "scope_mismatch");
                  requireThat(message.sequence > priorSequence, "Context messages must remain in conversation order.");
                  priorSequence = message.sequence;
                  next();
                });
                return;
              }
              const timestamp = Math.max(now(), conversation.updatedAt);
              const turn = { ...fresh(requestId, timestamp), requestId, conversationId: identity,
                projectId: conversation.projectId, kind, status: "pending", userMessageId: userId,
                assistantMessageId: assistantId, modelRef, source: conversation.source, contextMessageIds,
                resourceKind: kind === "resource-draft" ? conversation.draftKind : "" };
              const message = (messageId, role, content, status, sequence) => ({ ...fresh(messageId, timestamp),
                conversationId: identity, projectId: conversation.projectId, requestId, role, text: content,
                status, attribution: "", sequence });
              const userMessage = message(userId, "user", text, "complete", conversation.nextSequence);
              const assistantMessage = message(assistantId, "assistant", "", "pending", conversation.nextSequence + 1);
              const updated = changed(conversation, { pendingRequestId: requestId, nextSequence: conversation.nextSequence + 2,
                draft: conversation.draft === text ? "" : conversation.draft }, timestamp);
              for (const [store, row] of [["turns", turn], ["messages", userMessage], ["messages", assistantMessage]]) {
                validateRecord(store, row); context.store(store).add(row);
              }
              put(context, "conversations", updated);
              context.done({ conversation: updated, turn, userMessage, assistantMessage });
            }
            next();
          });
        }));
      });
    },
    async finishTurn(requestId, input) { return settle(requestId, input, false); },
    async recoverPending(requestIds) {
      const requests = contextIds(requestIds), recovered = [], skipped = [];
      for (const requestId of requests) {
        const result = await settle(requestId, { status: "interrupted", text: "This saved request has no confirmed completion. It was marked interrupted without replay.", attribution: "" }, true);
        (result.recovered ? recovered : skipped).push(requestId);
      }
      return { recovered, skipped };
    },
    async createResourceDraft(input) {
      const snapshot = validateResourceInput(input);
      return transaction(["projects", "resources", "turns", "conversations"], "readwrite", context => {
        checkProject(context, snapshot.projectId, () => {
          function create() {
            const timestamp = now(), record = { ...fresh(freshId(), timestamp), ...snapshot, state: "draft", version: 1 };
            validateRecord("resources", record); context.store("resources").add(record); context.done(record);
          }
          if (!snapshot.requestId) { create(); return; }
          context.read(context.store("resources").index("requestId").get(snapshot.requestId), existing => {
            if (existing !== undefined) {
              checkedRecord("resources", existing);
              requireThat(same(resourceInput(existing), snapshot), "This request already created a different or edited draft.", "conflict");
              context.done(existing); return;
            }
            get(context, "turns", snapshot.requestId, turn => {
              assertScope(turn, snapshot);
              requireThat(turn.kind === "resource-draft" && ["pending", "complete"].includes(turn.status),
                "A stopped or unrelated request cannot create a resource draft.", "stale_turn");
              requireThat(turn.resourceKind === snapshot.kind, "The proposed draft kind differs from the originating request.", "scope_mismatch");
              get(context, "conversations", turn.conversationId, conversation => {
                assertScope(turn, conversation);
                if (turn.status === "pending") requireThat(conversation.pendingRequestId === turn.requestId, "This draft request is no longer current.", "stale_turn");
                create();
              });
            });
          });
        });
      });
    },
    async updateResourceDraft(identity, expected, patch) {
      return mutate("resources", identity, expected, patch, value => {
        fields(value, [], ["name", "description", "instructions"]);
        requireThat(Object.keys(value).length > 0, "Choose a draft field to update.");
        const copy = structuredClone(value);
        if (Object.hasOwn(copy, "name")) copy.name = name(copy.name);
        if (Object.hasOwn(copy, "description")) string(copy.description, LIMIT.description);
        if (Object.hasOwn(copy, "instructions")) string(copy.instructions, LIMIT.instructions);
        return copy;
      });
    },
    close() { closed = true; db.close(); },
  };
  function settle(requestId, input, recovering) {
    id(requestId); fields(input, ["status", "text"], ["attribution"]);
    requireThat(FINAL.includes(input.status), "Choose a terminal turn status.");
    const result = { status: input.status, text: string(input.text, LIMIT.answer, { nonempty: input.status === "complete" }),
      attribution: string(input.attribution ?? "", LIMIT.attribution, { singleLine: true }) };
    return transaction(["projects", "conversations", "turns", "messages"], "readwrite", context => {
      context.read(context.store("turns").get(requestId), raw => {
        if (recovering && raw === undefined) { context.done({ recovered: false }); return; }
        const turn = checkedRecord("turns", raw);
        if (recovering && turn.status !== "pending") { context.done({ recovered: false }); return; }
        get(context, "conversations", turn.conversationId, conversation => checkProject(context, conversation.projectId, () => {
          assertScope(turn, conversation);
          get(context, "messages", turn.assistantMessageId, assistant => {
            assertScope(assistant, turn);
            requireThat(assistant.requestId === requestId && assistant.conversationId === conversation.id && assistant.role === "assistant" && assistant.status === turn.status,
              "The saved assistant slot does not match its request.", "corrupt_record");
            if (turn.status !== "pending") {
              requireThat(turn.status === result.status && assistant.text === result.text && assistant.attribution === result.attribution,
                "This request has already settled. A late result cannot replace it.", "stale_turn");
              context.done({ conversation, turn, assistantMessage: assistant }); return;
            }
            requireThat(conversation.pendingRequestId === requestId, "This request is no longer the conversation's pending request.", "stale_turn");
            const timestamp = Math.max(now(), turn.updatedAt, conversation.updatedAt, assistant.updatedAt);
            const finished = changed(turn, { status: result.status }, timestamp);
            const reply = changed(assistant, result, timestamp);
            const updated = changed(conversation, { pendingRequestId: null }, timestamp);
            put(context, "turns", finished); put(context, "messages", reply); put(context, "conversations", updated);
            context.done({ conversation: updated, turn: finished, assistantMessage: reply, ...(recovering ? { recovered: true } : {}) });
          });
        }));
      });
    });
  }
  return api;
}
