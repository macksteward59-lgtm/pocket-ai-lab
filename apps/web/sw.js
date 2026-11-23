const CACHE = "pocket-ai-lab-shell-v9";
const SHELL = [
  "/", "/styles.css", "/app.js", "/native-review.js", "/project-sources-ui.js",
  "/model-workshop/ui.js", "/model-workshop/catalog.js", "/model-workshop/reader.js",
  "/model-workshop/hard.json", "/model-workshop/soft.json", "/model-workshop/training.json",
  "/model-workshop/evaluation.json", "/manifest.webmanifest", "/icon.svg"
];
self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)));
});
self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith("pocket-ai-lab-shell-") && key !== CACHE)
      .map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});
self.addEventListener("fetch", event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== location.origin || url.pathname.startsWith("/api/")) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    // Static shell files have one representation regardless of navigation/fetch headers.
    const isShell = !url.search && SHELL.includes(url.pathname);
    const hit = isShell ? await cache.match(url.pathname, { ignoreVary: true }) : await cache.match(request);
    if (hit) return hit;
    const response = await fetch(request);
    if (response.ok) event.waitUntil(cache.put(request, response.clone()).catch(() => {}));
    return response;
  })());
});
