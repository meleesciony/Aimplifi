'use client';

/**
 * Top-level error boundary (DECISIONS #81). Catches a crash in the ROOT layout — where
 * the normal (app)/error.tsx can't help and the app CSS may not have loaded — and renders
 * a self-contained, branded dark recovery screen with inline styles so it works even if
 * the stylesheet failed. Replaces a raw white browser 500.
 *
 * Gap 6 §2 (#189): report to Sentry when configured (dormant without DSN).
 */
import { useEffect } from 'react';
import { captureError } from '@/lib/errors';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    void captureError(error, {
      boundary: 'global',
      tags: error.digest ? { digest: error.digest.slice(0, 64) } : undefined,
    });
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#0a0a0a',
          color: '#fafafa',
          fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
        }}
      >
        <div style={{ maxWidth: '28rem', padding: '2rem', textAlign: 'center' }}>
          <h1 style={{ margin: '0 0 0.5rem', fontSize: '1.25rem', fontWeight: 600 }}>Something went wrong</h1>
          <p style={{ margin: '0 0 1.25rem', fontSize: '0.875rem', color: '#a1a1aa', lineHeight: 1.5 }}>
            Aimplifi hit an unexpected error. Try again — if it keeps happening, reload the page.
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              borderRadius: '0.5rem',
              border: '1px solid #3f3f46',
              background: '#18181b',
              color: '#fafafa',
              padding: '0.5rem 1rem',
              fontSize: '0.875rem',
              cursor: 'pointer',
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
