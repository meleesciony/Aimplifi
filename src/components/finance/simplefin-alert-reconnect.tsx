'use client';

/**
 * Dashboard connection-alert reconnect for SimpleFIN.
 * Sync now for a transient failure; paste a new setup token for a dead credential
 * (same connectSimplefin writer as Accounts — reconnect keeps lastSyncedAt).
 */
import { useState } from 'react';
import { setFlash } from '@/components/finance/flash';
import { connectSimplefin, syncSimplefinNow } from '@/server/simplefin-actions';

export function SimplefinAlertReconnect() {
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function run(fn: () => Promise<{ ok: boolean; error?: string; message?: string; added?: number }>) {
    if (pending) return;
    setError(null);
    setPending(true);
    void (async () => {
      try {
        const r = await fn();
        if (!r.ok) {
          setError(r.error ?? 'Something went wrong.');
          setPending(false);
          return;
        }
        const text = r.error
          ? 'Bank connected — tap Sync now if transactions still look behind.'
          : (r.message ??
            (typeof r.added === 'number'
              ? `Synced ${r.added} new transaction${r.added === 1 ? '' : 's'}.`
              : 'Done.'));
        setFlash('accounts', text);
        window.location.reload();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Something went wrong.');
        setPending(false);
      }
    })();
  }

  const btn =
    'rounded-md border px-2 py-1 text-xs font-medium hover:bg-accent disabled:opacity-50';

  return (
    <div className="space-y-2" data-testid="simplefin-alert-reconnect">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          data-testid="simplefin-alert-sync"
          disabled={pending}
          onClick={() => run(syncSimplefinNow)}
          className={btn}
        >
          {pending ? 'Working…' : 'Sync now'}
        </button>
        <button
          type="button"
          data-testid="simplefin-alert-reconnect-btn"
          disabled={pending}
          onClick={() => {
            setOpen(!open);
            setError(null);
          }}
          className={btn}
        >
          Paste a new setup token
        </button>
      </div>
      {open ? (
        <div className="space-y-2 rounded-md border p-2" data-testid="simplefin-alert-form">
          <p className="text-xs text-muted-foreground">
            Create a one-time setup token at simplefin.org and paste it here. Reconnecting keeps
            saved transactions and restarts updates.
          </p>
          <textarea
            data-testid="simplefin-alert-token"
            aria-label="SimpleFIN setup token"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="Paste your SimpleFIN setup token"
            rows={3}
            className="w-full rounded-md border bg-background px-2 py-1.5 font-mono text-xs"
          />
          <button
            type="button"
            data-testid="simplefin-alert-submit"
            disabled={pending || !token.trim()}
            onClick={() => run(() => connectSimplefin(token))}
            className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/80 disabled:opacity-50"
          >
            {pending ? 'Reconnecting…' : 'Reconnect SimpleFIN'}
          </button>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="text-xs text-red-400" data-testid="simplefin-alert-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}
