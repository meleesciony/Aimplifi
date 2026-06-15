/**
 * Pulse Finance service worker (ROADMAP #5) — installable, offline-aware PWA.
 *
 * Deliberately minimal and conservative so it can never serve stale or
 * cross-user data and can't grow unbounded:
 *  - PAGE NAVIGATIONS → network-first: always hit the network when online (so
 *    nothing personal is ever served stale), and only when the network fails
 *    fall back to the precached /offline shell. Navigation responses are NEVER
 *    cached (no cross-user leakage on a shared device). /offline itself is a
 *    navigation, so online it is always fresh — the cached copy is offline-only.
 *  - ICONS / MANIFEST → cache-first (a tiny, fixed, stable allowlist), only
 *    storing successful (res.ok) responses.
 *  - HASHED BUILD ASSETS (/_next/static/*) → PASSTHROUGH. They are immutable and
 *    content-addressed, so the browser's HTTP cache already handles them; the SW
 *    deliberately doesn't cache them, which keeps SW storage bounded (no
 *    per-deploy accumulation) and avoids pinning a transient error.
 *  - Everything else (API, POST/actions, cross-origin) → passthrough, untouched.
 * Any handler error falls through to the network, so a SW bug can't break loads.
 *
 * Bump CACHE whenever a PRECACHEd asset's CONTENT changes (the byte-change to
 * this file triggers a reinstall; activate then evicts the prior cache).
 */
const CACHE = 'pulse-v1';
const OFFLINE_URL = '/offline';
const PRECACHE = [OFFLINE_URL, '/icon.svg', '/icon-192.png', '/icon-512.png', '/manifest.webmanifest'];
const CACHE_FIRST = new Set(['/icon.svg', '/icon-192.png', '/icon-512.png', '/manifest.webmanifest']);

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      // Per-asset so one bad URL can't void the whole shell (atomic addAll would).
      .then((cache) => Promise.allSettled(PRECACHE.map((u) => cache.add(u))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return; // never touch POST / server actions

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }
  if (url.origin !== self.location.origin) return; // only our own origin
  if (url.pathname.startsWith('/api/')) return; // dynamic — passthrough

  // Page navigations: network-first, offline → precached shell.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match(OFFLINE_URL).then((hit) => hit || Response.error())),
    );
    return;
  }

  // Small fixed allowlist of stable assets: cache-first, store only successes.
  if (CACHE_FIRST.has(url.pathname)) {
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ||
          fetch(request).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(request, copy)).catch(() => undefined);
            }
            return res;
          }),
      ),
    );
  }
  // Hashed build assets (/_next/static) and everything else: do not intercept.
});
