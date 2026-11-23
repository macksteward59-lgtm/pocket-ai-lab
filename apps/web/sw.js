const RELEASE = 17;
const SHELL = [
  "/", "/styles.css", "/app.js",
  "/recovery/ui.js", "/recovery/verify.js",
  "/model-workshop/ui.js", "/model-workshop/host.js", "/model-workshop/catalog.js", "/model-workshop/reader.js", "/model-workshop/edit.js",
  "/model-workshop/hard.json", "/model-workshop/soft.json", "/model-workshop/training.json",
  "/model-workshop/evaluation.json", "/manifest.webmanifest", "/icon.svg"
];
const EXTRA_CACHE = "pocket-ai-lab-shell-extra-" + RELEASE;
let shell;

function openShellStore() {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open("pocket-ai-lab-offline-shell", 1);
    open.onupgradeneeded = () => open.result.createObjectStore("releases");
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
  });
}
async function saveShell(files) {
  const db = await openShellStore();
  try {
    await new Promise((resolve, reject) => {
      const tx = db.transaction("releases", "readwrite");
      const releases = tx.objectStore("releases");
      releases.put(files, RELEASE);
      // Keep the preceding worker's shell while its clients finish updating.
      releases.delete(IDBKeyRange.upperBound(RELEASE - 2));
      tx.oncomplete = resolve;
      tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}
async function loadShell() {
  const db = await openShellStore();
  try {
    return await new Promise((resolve, reject) => {
      const get = db.transaction("releases").objectStore("releases").get(RELEASE);
      get.onsuccess = () => resolve(get.result);
      get.onerror = () => reject(get.error);
    });
  } finally { db.close(); }
}
self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const entries = await Promise.all(SHELL.map(async pathname => {
      const response = await fetch(pathname, { cache: "reload" });
      if (!response.ok) throw Error("Offline shell file unavailable: " + pathname);
      const headers = new Headers(response.headers);
      // The stored arrayBuffer contains the decoded representation.
      for (const header of ["content-encoding", "content-length", "transfer-encoding"]) headers.delete(header);
      return [pathname, { bytes: await response.arrayBuffer(), headers: [...headers] }];
    }));
    // Publish all version-matched assets in one transaction, including the navigation document.
    await saveShell(Object.fromEntries(entries));
  })());
});
self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith("pocket-ai-lab-shell-") && key !== EXTRA_CACHE)
      .map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});
self.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api/")) return;
  if (!url.search && SHELL.includes(url.pathname)) {
    event.respondWith((async () => {
      shell ??= loadShell().catch(() => { shell = undefined; });
      const file = (await shell)?.[url.pathname];
      return file ? new Response(file.bytes, { headers: file.headers }) : fetch(request);
    })());
    return;
  }
  event.respondWith((async () => {
    const cache = await caches.open(EXTRA_CACHE);
    const hit = await cache.match(request);
    if (hit) return hit;
    const response = await fetch(request);
    if (response.ok) event.waitUntil(cache.put(request, response.clone()).catch(() => {}));
    return response;
  })());
});
