'use client';

/**
 * Registers the service worker (public/sw.js) in production only — a dev SW
 * would fight Next's HMR. Renders nothing. The SW is conservative (network-first
 * navigations, cache-first hashed assets, offline fallback), so registering it
 * never serves stale or cross-user data online.
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
