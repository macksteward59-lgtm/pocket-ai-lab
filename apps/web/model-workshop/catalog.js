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
