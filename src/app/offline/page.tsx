import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'Offline · Aimplifi' };

/**
 * Offline fallback shell (precached by the service worker, public/sw.js). Served
 * when a navigation fails with no network. Top-level route → uses the root
 * layout only (no session, no data), so it renders even fully offline. Styles
 * are INLINE so the shell is presentable offline even if the hashed CSS chunk
 * (left to the browser HTTP cache, not the SW) isn't available.
 */
export default function OfflinePage() {
  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '0.75rem',
        padding: '1.5rem',
        textAlign: 'center',
        background: '#0a0a0a',
        color: '#fafafa',
        fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
      }}
    >
      <p style={{ fontSize: '1.125rem', fontWeight: 700, letterSpacing: '-0.01em' }}>
        Aim<span style={{ color: '#10b981' }}>plifi</span>
      </p>
      <h1 style={{ fontSize: '1.25rem', fontWeight: 600 }} data-testid="offline-heading">
        You&apos;re offline
      </h1>
      <p style={{ maxWidth: '24rem', fontSize: '0.875rem', color: '#a1a1aa' }}>
        Aimplifi needs a connection to show your latest numbers. Reconnect and reload — your
        data is safe and waiting.
      </p>
    </main>
  );
}
