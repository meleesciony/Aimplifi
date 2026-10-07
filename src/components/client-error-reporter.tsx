'use client';

/**
 * The browser half of client error reporting (DECISIONS #794; the why is in
 * `lib/client-error.ts`). Mounted once in the root layout. Listens for thrown
 * errors, unhandled rejections and React's hydration-failure console lines,
 * and POSTs each (capped) to `/api/client-error`. `keepalive` so a report
 * survives the navigation that often follows an error. Fails silently: a
 * reporter that itself throws would be the error it exists to catch.
 */
import { useEffect } from 'react';
import {
  MAX_REPORTS_PER_PAGE,
  isHydrationMessage,
  type ClientErrorKind,
  type ClientErrorReport,
} from '@/lib/client-error';

export function ClientErrorReporter() {
  useEffect(() => {
    let sent = 0;
    const seen = new Set<string>();

    const send = (kind: ClientErrorKind, message: string, stack?: string) => {
      if (sent >= MAX_REPORTS_PER_PAGE) return;
      const key = `${kind}:${message.slice(0, 120)}`;
      if (seen.has(key)) return;
      seen.add(key);
      sent += 1;
      const report: ClientErrorReport = {
        kind,
        message,
        ...(stack ? { stack } : {}),
        route: window.location.pathname,
        userAgent: navigator.userAgent,
      };
      try {
        void fetch('/api/client-error', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(report),
          keepalive: true,
        }).catch(() => undefined);
      } catch {
        /* nothing — see the docblock */
      }
    };

    const onError = (e: ErrorEvent) => {
      send('error', e.message || String(e.error ?? 'Unknown error'), e.error?.stack);
    };
    const onRejection = (e: PromiseRejectionEvent) => {
      const r = e.reason;
      const message = r instanceof Error ? r.message : typeof r === 'string' ? r : 'Unhandled rejection';
      send('unhandledrejection', message, r instanceof Error ? r.stack : undefined);
    };
    const original = console.error;
    const patched = (...args: unknown[]) => {
      try {
        const text = args
          .map((a) => (a instanceof Error ? a.message : typeof a === 'string' ? a : ''))
          .join(' ');
        if (isHydrationMessage(text)) send('hydration', text.slice(0, 500));
      } catch {
        /* nothing */
      }
      original.apply(console, args);
    };

    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    console.error = patched;
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
      if (console.error === patched) console.error = original;
    };
  }, []);

  return null;
}
