const databaseName = "pocket-ai-lab-reader-drafts";
const storeName = "drafts";
const storageMessage = "Could not access saved drafts. Check available browser storage and try again.";

export function openDraftStore() {
  return new Promise((resolve, reject) => {
    let request;
    try { request = indexedDB.open(databaseName, 1); }
    catch { reject(Error(storageMessage)); return; }
    let blocked = false;
    request.onblocked = () => {
      blocked = true;
      reject(Error("Another tab is blocking draft storage. Close it and try again."));
    };
    request.onupgradeneeded = () => {
      if (blocked) request.transaction.abort();
      else request.result.createObjectStore(storeName, { keyPath: "id" });
    };
    request.onerror = () => reject(Error(storageMessage));
    request.onsuccess = () => {
      const db = request.result;
      if (blocked || !db.objectStoreNames.contains(storeName)) {
        db.close();
        reject(Error(storageMessage));
        return;
      }
      db.onversionchange = () => db.close();
      resolve(db);
    };
  });
}

// Keep each operation inside one transaction, including the lookup and conditional
// addition for competing saves. A request's success alone does not commit a write.
function transact(db, mode, work) {
  return new Promise((resolve, reject) => {
    let tx, result, failure;
    try {
      tx = db.transaction(storeName, mode);
      tx.oncomplete = () => resolve(result);
      tx.onabort = () => reject(failure ?? Error(storageMessage));
      work(tx.objectStore(storeName), (request, handle) => {
        request.onsuccess = () => {
          try { result = handle(request.result); }
          catch (error) {
            failure = error instanceof DOMException ? Error(storageMessage) : error;
            tx.abort();
          }
        };
      });
    } catch {
      if (tx) tx.abort();
      else reject(Error(storageMessage));
    }
  });
}

function summary(row) {
  return {
    id: row.id,
    name: typeof row.snapshot?.name === "string" ? row.snapshot.name : "Damaged draft",
    createdAt: Number.isSafeInteger(row.createdAt) ? row.createdAt : null,
  };
}

export function listDrafts(db) {
  return transact(db, "readonly", (store, read) => {
    const entries = [];
    read(store.openCursor(), cursor => {
      if (cursor) {
        entries.push(summary(cursor.value));
        cursor.continue();
      } else {
        return entries.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
      }
    });
  });
}

// Receives a canonical JSON snapshot from createDraft. Compare every field on a hit
// so a damaged record cannot silently replace the draft the user just tried to save.
function sameSnapshot(left, right) {
  if (left === right) return true;
  if (!left || !right || typeof left !== "object" || typeof right !== "object" ||
      Array.isArray(left) !== Array.isArray(right)) return false;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length &&
    keys.every(key => Object.hasOwn(right, key) && sameSnapshot(left[key], right[key]));
}

export async function saveDraft(db, incoming) {
  if (typeof incoming?.id !== "string" || !/^draft-[a-f0-9]{64}$/.test(incoming.id) ||
      typeof incoming.name !== "string") throw Error("Choose a valid editor draft to save.");
  const snapshot = structuredClone(incoming);
  return transact(db, "readwrite", (store, read) => {
    read(store.get(snapshot.id), existing => {
      if (existing) {
        if (!sameSnapshot(existing.snapshot, snapshot)) {
          throw Error("A saved draft with this ID has different contents. Remove the damaged draft to save it again.");
        }
        return summary(existing);
      }
      const row = { id: snapshot.id, createdAt: Date.now(), snapshot };
      store.add(row);
      return summary(row);
    });
  });
}

export async function getDraft(db, id) {
  if (typeof id !== "string") throw Error("Choose a single saved draft.");
  return transact(db, "readonly", (store, read) => {
    read(store.get(id), row => {
      if (row === undefined) return undefined;
      if (row.snapshot?.id !== id) throw Error("This saved draft is damaged. You can remove it from the draft list.");
      return row.snapshot;
    });
  });
}

export async function deleteDraft(db, id) {
  if (typeof id !== "string") throw Error("Choose a single saved draft.");
  return transact(db, "readwrite", store => store.delete(id));
}
