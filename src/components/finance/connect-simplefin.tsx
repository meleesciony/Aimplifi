'use client';

/**
 * SimpleFIN connect/sync front door (ROADMAP: cheaper Plaid alternative). The
 * user pastes a one-time setup token from simplefin.org; the action claims it,
 * stores an encrypted read-only access URL, and pulls accounts + transactions.
 * Dormant until used; no network on render.
 */
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { connectSimplefin, disconnectSimplefin, syncSimplefinNow } from '@/server/simplefin-actions';

interface Result {
  ok: boolean;
  error?: string;
  added?: number;
  message?: string;
}

export function ConnectSimplefin({ connected, lastSyncedAt }: { connected: boolean; lastSyncedAt: string | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function run(fn: () => Promise<Result>) {
    setError(null);
    setMsg(null);
    start(async () => {
      try {
        const r = await fn();
        if (!r.ok) {
          setError(r.error ?? 'Something went wrong.');
          return;
        }
        if (r.error) setError(r.error); // connected but first sync failed
        else if (r.message) setMsg(r.message);
        else if (typeof r.added === 'number') setMsg(`Synced ${r.added} new transaction${r.added === 1 ? '' : 's'}.`);
        setOpen(false);
        setToken('');
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Something went wrong.');
      }
    });
  }

  const btn = 'rounded-md border px-2 py-1 text-xs hover:bg-accent disabled:opacity-50';

  if (connected) {
    return (
      <div className="space-y-1" data-testid="simplefin-connected">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">
            Bank sync connected{lastSyncedAt ? ` · last synced ${lastSyncedAt}` : ' · not yet synced'}
          </span>
          <button type="button" data-testid="simplefin-sync" disabled={pending} onClick={() => run(syncSimplefinNow)} className={btn}>
            {pending ? 'Syncing…' : 'Sync now'}
          </button>
          <button type="button" data-testid="simplefin-disconnect" disabled={pending} onClick={() => run(disconnectSimplefin)} className={`${btn} text-red-400`}>
            Disconnect
          </button>
        </div>
        {msg && <p role="status" className="text-xs text-emerald-400">{msg}</p>}
        {error && <p role="alert" className="text-xs text-red-400">{error}</p>}
        <p className="text-[11px] text-amber-300/80" data-testid="simplefin-type-notice">
          Account types are guessed from the bank’s name — double-check that any cards or loans
          appear under <b>Liabilities</b> so your net worth is right.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <button
        type="button"
        data-testid="simplefin-connect-btn"
        disabled={pending}
        onClick={() => { setOpen(!open); setError(null); }}
        className="rounded-md border border-emerald-700/40 bg-emerald-950/30 px-3 py-1.5 text-sm font-medium text-emerald-300 hover:bg-emerald-950/50 disabled:opacity-50"
      >
        + Connect a bank (SimpleFIN)
      </button>
      {open && (
        <div className="space-y-2 rounded-lg border p-3" data-testid="simplefin-form">
          <p className="text-xs text-muted-foreground">
            A cheaper, privacy-first alternative to Plaid. Create a one-time <b>setup token</b> at
            simplefin.org (a few dollars/year, read-only) and paste it below — Aimplifi stores only an
            encrypted read-only access URL, never your bank password.
          </p>
          <textarea
            data-testid="simplefin-token"
            aria-label="SimpleFIN setup token"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="Paste your SimpleFIN setup token"
            rows={3}
            className="w-full rounded-md border bg-background px-2 py-1.5 font-mono text-xs"
          />
          <div className="flex gap-2">
            <button
              type="button"
              data-testid="simplefin-submit"
              disabled={pending || !token.trim()}
              onClick={() => run(() => connectSimplefin(token))}
              className="rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/80 disabled:opacity-50"
            >
              {pending ? 'Connecting…' : 'Connect'}
            </button>
            <button type="button" disabled={pending} onClick={() => { setOpen(false); setError(null); }} className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent disabled:opacity-50">
              Cancel
            </button>
          </div>
        </div>
      )}
      {msg && <p role="status" className="text-xs text-emerald-400" data-testid="simplefin-msg">{msg}</p>}
      {error && <p role="alert" className="text-xs text-red-400" data-testid="simplefin-error">{error}</p>}
    </div>
  );
}
