/* ============================================================
   Tripkit service worker — offline-resilient, deploy-safe.

   Safety contract (a bad SW bricks the live site for everyone):
   - install  -> skipWaiting()       : new SW takes over ASAP.
   - activate -> drop stale caches    : delete every cache whose
                 name !== CACHE/TILES, then clients.claim().
   - fetch    -> wrapped in try/catch : on ANY error fall through
                 to the network. The SW must never break a request.

   Strategies:
   - navigations + same-origin /api/  : NETWORK-FIRST  (online always
       gets fresh content; deploys are never trapped). On failure,
       serve the last-seen cached response (offline support).
   - same-origin static assets         : STALE-WHILE-REVALIDATE.
   - map tiles (cartocdn) + unpkg      : CACHE-FIRST into a runtime
       TILES cache, trimmed to <=250 entries.
   - anything else cross-origin        : passthrough (no respondWith).
   ============================================================ */

const VERSION = "tk-2";
const CACHE = VERSION;          // versioned precache / runtime cache for app shell + api
const TILES = "tk-tiles";       // long-lived runtime cache for map tiles + leaflet
const TILES_MAX = 250;

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const names = await caches.keys();
        await Promise.all(
          names.map((n) => (n !== CACHE && n !== TILES ? caches.delete(n) : null))
        );
      } catch (_) {}
      try {
        await self.clients.claim();
      } catch (_) {}
    })()
  );
});

// Best-effort precache for a future "save offline" feature; harmless if unused.
self.addEventListener("message", (event) => {
  const data = event.data;
  if (!data || data.type !== "precache" || !Array.isArray(data.urls)) return;
  event.waitUntil(
    (async () => {
      try {
        const cache = await caches.open(CACHE);
        await cache.addAll(data.urls);
      } catch (_) {}
    })()
  );
});

function isStaticAsset(url) {
  const p = url.pathname;
  return (
    p.startsWith("/shared/") ||
    p.startsWith("/trip/") ||
    p.startsWith("/split/") ||
    p.startsWith("/icons") ||
    p.startsWith("/favicon") ||
    p === "/manifest.webmanifest" ||
    p.startsWith("/apple-touch-icon") ||
    /\.(?:css|js|woff2?|ttf|otf|png|svg|jpg|jpeg|webp|gif|ico|json)$/.test(p)
  );
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(request);
    // Only cache successful, basic/cors responses (never opaque error pages).
    if (res && res.ok) {
      try {
        await cache.put(request, res.clone());
      } catch (_) {}
    }
    return res;
  } catch (err) {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw err;
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  const fetching = fetch(request)
    .then((res) => {
      if (res && res.ok) {
        cache.put(request, res.clone()).catch(() => {});
      }
      return res;
    })
    .catch(() => undefined);
  if (cached) return cached;
  const res = await fetching;
  if (res) return res;
  // Nothing cached and network failed — surface a real fetch error.
  return fetch(request);
}

async function trimCache(cacheName, max) {
  try {
    const cache = await caches.open(cacheName);
    const keys = await cache.keys();
    if (keys.length <= max) return;
    // keys() preserves insertion order — delete the oldest first.
    const excess = keys.length - max;
    for (let i = 0; i < excess; i++) {
      await cache.delete(keys[i]);
    }
  } catch (_) {}
}

async function cacheFirstTiles(request) {
  const cache = await caches.open(TILES);
  const cached = await cache.match(request);
  if (cached) return cached;
  const res = await fetch(request);
  if (res && (res.ok || res.type === "opaque")) {
    try {
      await cache.put(request, res.clone());
    } catch (_) {}
    trimCache(TILES, TILES_MAX);
  }
  return res;
}

self.addEventListener("fetch", (event) => {
  let request;
  try {
    request = event.request;

    // Only GET is ever intercepted; everything else passes straight through.
    if (request.method !== "GET") return;

    const url = new URL(request.url);
    const sameOrigin = url.origin === self.location.origin;

    // Navigations + same-origin API: NETWORK-FIRST (fresh online, cached offline).
    if (request.mode === "navigate" || (sameOrigin && url.pathname.startsWith("/api/"))) {
      event.respondWith(
        networkFirst(request).catch(() => fetch(request))
      );
      return;
    }

    // Same-origin static assets: STALE-WHILE-REVALIDATE.
    if (sameOrigin && isStaticAsset(url)) {
      event.respondWith(
        staleWhileRevalidate(request).catch(() => fetch(request))
      );
      return;
    }

    // Map tiles + Leaflet from CDNs: CACHE-FIRST into the TILES cache.
    if (url.host === "basemaps.cartocdn.com" || url.host === "unpkg.com") {
      event.respondWith(
        cacheFirstTiles(request).catch(() => fetch(request))
      );
      return;
    }

    // Anything else cross-origin: passthrough (no respondWith).
  } catch (_) {
    // On ANY error, do nothing — the request falls through to the network.
  }
});
