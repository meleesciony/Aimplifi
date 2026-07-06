/**
 * Aimplifi service worker v3 — installability shell ONLY. NO fetch handler.
 *
 * v1/v2 intercepted requests (network-first navigations + a cached offline
 * shell). #166's probes (scripts/audit-probes/budget-mutation.ts) recorded streamed
 * server-action POST responses aborting mid-read (net::ERR_ABORTED after a
 * 200) with the v1/v2 fetch listener present, in bundled Chromium AND branded
 * Chrome. The root wedge turned out to be the Next action-application race
 * (#164 — fixed app-side by the explicit-busy + withDeadline + refresh form
 * pattern), and SW interception both amplified the abort class in probes and
 * adds staleness/complexity for near-zero value (the offline shell is a
 * nicety; wedged "Save" buttons are product-breaking). So: no interception at
 * all — installability only.
 *
 * This file must keep EXISTING installs healthy too: browsers replace an old
 * SW on byte-change, so activate() deletes every cache the old versions made
 * and takes over clients immediately. The app remains installable (manifest +
 * this registered worker); an offline visit now fails like a normal website.
 * If offline support returns, it must ship with a regression e2e that drives
 * a server action UNDER A CONTROLLING SW (tests/e2e/pwa-offline.spec.ts).
 */

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});
