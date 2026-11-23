import { readWeights } from "./reader.js";

export const sources = {
  hard: "cbe45e272cd1f398bb2b141a5ef0ee453db70d1e78f288c988f73f09b1ee82e9",
  soft: "a83d342fa81b413eb38602ed2c6f76f3be4153fad3db5b628f1ea02314826754",
  training: "306766f1c6ccfbc38bc6a783a6bfc2a8b5df996d2305d9cc5548dc0f998d7f8f",
  evaluation: "3df3e3b661f56a95528040ead3818d262a58cf7f797a4b9e37988e3d0995994f"
};

export async function digest(bytes) {
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), n => n.toString(16).padStart(2, "0")).join("");
}
export async function asset(key) {
  const response = await fetch(new URL(key + ".json", import.meta.url));
  if (!response.ok) throw Error("Could not load the " + key + " workshop file.");
  const bytes = await response.arrayBuffer();
  if (await digest(bytes) !== sources[key]) throw Error("The " + key + " workshop file differs from its recorded version.");
  return JSON.parse(new TextDecoder().decode(bytes));
}
export async function modelRecord(raw, name) {
  const weights = readWeights(raw);
  const hash = await digest(new TextEncoder().encode(JSON.stringify(weights)));
  return { id: hash, hash, name, weights };
}

export function exportReader(record) {
  return { ...record.weights, workshop: {
    id: record.id, name: record.name, weightsSHA256: record.hash, run: record.run ?? null
  } };
}

function sameJson(left, right) {
  if (left === right) return true;
  if (!left || !right || typeof left !== "object" || typeof right !== "object" ||
      Array.isArray(left) !== Array.isArray(right)) return false;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length &&
    keys.every(key => Object.hasOwn(right, key) && sameJson(left[key], right[key]));
}

export async function importReader(raw, name, catalog) {
  const plain = await modelRecord(raw, name);
  const info = raw.workshop;
  if (info?.weightsSHA256 === plain.hash) {
    if (Object.hasOwn(info, "id")) {
      const local = catalog.get(info.id);
      if (local?.hash === plain.hash && sameJson(local.run ?? null, info.run ?? null)) return local;
    } else if (info.run) {
      // Earlier exports identified a build only by its complete run and its weights.
      const matches = [...catalog.values()].filter(local =>
        local.hash === plain.hash && local.run && sameJson(local.run, info.run));
      if (matches.length === 1) return matches[0];
    }
  }
  // An unknown declaration cannot give a plain weight file a local build's history.
  return catalog.get(plain.id) ?? plain;
}

export function openCatalog() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("pocket-ai-lab-document-readers", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("readers", { keyPath: "id" });
    request.onerror = () => reject(Error("The browser could not open saved readers."));
    request.onsuccess = () => resolve(request.result);
  });
}
export function savedReaders(db) {
  return new Promise((resolve, reject) => {
    const read = db.transaction("readers").objectStore("readers").getAll();
    read.onsuccess = () => resolve(read.result);
    read.onerror = () => reject(Error("Saved readers could not be loaded."));
  });
}
// A read/write transaction also serializes two tabs saving the same build.
export function insertReader(db, record) {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("readers", "readwrite");
    const store = transaction.objectStore("readers");
    const lookup = store.get(record.id);
    let saved;
    lookup.onsuccess = () => {
      saved = lookup.result ?? record;
      if (!lookup.result) store.add(record);
    };
    transaction.oncomplete = () => resolve(saved);
    transaction.onabort = () => reject(Error("Could not save the reader in this browser. Check available storage."));
  });
}

const parentRoles = ["base", "teacher", "second"];

function runIdentity(run) {
  if (run == null) return null;
  // The recipe and ancestry identify a build. These measurements can vary by engine.
  const { scores, verifiedPairs, ...identity } = run;
  for (const role of parentRoles) {
    if (identity[role]) {
      const { label, ...reference } = identity[role];
      identity[role] = reference;
    }
  }
  return identity;
}

function matchesFamilyRecord(local, imported) {
  return local.id === imported.id && local.hash === imported.hash &&
    sameJson(local.weights, imported.weights) && sameJson(runIdentity(local.run), runIdentity(imported.run));
}

// inspectFamily supplies the verified ancestry in parent-first order.
export function insertFamily(db, records, bundledReaders = []) {
  return new Promise((resolve, reject) => {
    const incoming = structuredClone(records);
    const bundled = new Map(bundledReaders.map(reader => [reader.id, reader]));
    const resolved = new Map();
    const result = { added: 0, existing: 0 };
    const tx = db.transaction("readers", "readwrite");
    const store = tx.objectStore("readers");
    let index = 0, failure;
    tx.oncomplete = () => resolve(result);
    tx.onabort = () => reject(failure ?? Error("Could not save the reader family in this browser. Check available storage."));

    // Issue each new request from an active request callback. The same lock covers
    // the final conflict check and all writes, including concurrent imports in other tabs.
    function next() {
      if (index === incoming.length) return;
      const record = incoming[index++];
      const lookup = store.get(record.id);
      lookup.onsuccess = () => {
        try {
          const stored = lookup.result;
          const builtin = bundled.get(record.id);
          for (const local of [stored, builtin]) {
            if (local !== undefined && !matchesFamilyRecord(local, record)) {
              throw Error("Reader family conflicts with an existing catalog entry.");
            }
          }
          const local = stored ?? builtin;
          if (local) {
            resolved.set(record.id, local);
            result.existing++;
          } else {
            if (record.run) record.importedFamily = true;
            for (const role of parentRoles) {
              const ref = record.run?.[role];
              if (!ref) continue;
              const parent = resolved.get(ref.id);
              if (!parent || parent.hash !== ref.hash) throw Error("Reader family contains an unresolved parent.");
              ref.label = parent.name + " · " + parent.hash.slice(0, 8);
            }
            store.add(record);
            resolved.set(record.id, record);
            result.added++;
          }
          next();
        } catch (error) {
          failure = error;
          tx.abort();
        }
      };
    }
    next();
  });
}
