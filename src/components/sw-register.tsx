'use client';

/**
 * Registers the service worker (public/sw.js) in production only — a dev SW
 * would fight Next's HMR. Renders nothing. v3 is installability-only: it has NO
 * fetch handler, so it never intercepts (or serves stale) requests — an offline
 * visit fails like a normal website (see public/sw.js for the v1/v2 history).
 */
import { useEffect } from 'react';

export function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (!('serviceWorker' in navigator)) return;
    const register = () => navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    // Register after load so it never competes with first paint.
    if (document.readyState === 'complete') register();
    else {
      window.addEventListener('load', register, { once: true });
      return () => window.removeEventListener('load', register);
    }
  }, []);

  return null;
}
