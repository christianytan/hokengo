/* ==========================================================================
   Offline shell for ほけんご (Hokengo) — 保険・IT 用語トレーナー.

   The vocabulary data and the learner's progress already live in the browser
   (imported JSON + IndexedDB), so caching the app shell is all that is needed
   for the whole trainer to keep working with no network at all.

   Strategy:
     - navigations  -> network first, fall back to the cached index.html
     - same-origin assets -> cache first, then the network (build output is
       content-hashed, so a cached copy is always the right one)
   Bump CACHE_VERSION on every release to drop stale shells.
   ========================================================================== */

// v2: the first published shell was the raw repository index.html (it asked the
// browser for ./src/main.tsx and ./manifest.json, which do not exist on Pages).
// Bumping the version drops that broken shell from every already-installed client.
const CACHE_VERSION = "hokengo-v3";
const SHELL = ["./", "./index.html", "./manifest.json", "./favicon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_VERSION);
      // allSettled: a missing optional file must not break the whole install.
      await Promise.allSettled(SHELL.map((url) => cache.add(url)));
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => key !== CACHE_VERSION).map((key) => caches.delete(key)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(request);
          const cache = await caches.open(CACHE_VERSION);
          await cache.put("./index.html", fresh.clone());
          return fresh;
        } catch (error) {
          const cached = (await caches.match("./index.html")) || (await caches.match("./"));
          return cached || Response.error();
        }
      })()
    );
    return;
  }

  event.respondWith(
    (async () => {
      const cached = await caches.match(request);
      if (cached) return cached;
      try {
        const response = await fetch(request);
        if (response && response.ok) {
          const cache = await caches.open(CACHE_VERSION);
          await cache.put(request, response.clone());
        }
        return response;
      } catch (error) {
        return cached || Response.error();
      }
    })()
  );
});
