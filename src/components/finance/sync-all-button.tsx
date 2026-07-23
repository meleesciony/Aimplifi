'use client';

/**
 * "Sync all accounts" — one button that refreshes EVERY connected provider
 * (owner request 2026-07-23: *"I want one button sync of all accounts. And
 * individual syncing if required."*).
 *
 * The individual controls remain: SimpleFIN keeps its own Sync now, and each
 * Plaid bank has a per-connection Sync. This is the path for "just refresh
 * everything" without knowing or caring which bank came from which provider —
 * a distinction the user shouldn't have to hold.
 *
 * Renders nothing when no bank is connected: a sync button for a manual-only or
 * demo account would be a control that can't do anything.
 */
import { useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { setFlash } from '@/components/finance/flash';
import { syncAllAccounts } from '@/server/sync-actions';

export function SyncAllButton({ connected }: { connected: boolean }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!connected) return null;

  function run() {
    if (pending) return;
    setError(null);
    setPending(true);
    void (async () => {
      try {
        const r = await syncAllAccounts();
        if (!r.ok) {
          // A partial failure still returns ok:true with its own summary, so this
          // branch really is "nothing worked".
          setError(r.error ?? r.summary ?? 'Sync failed — please try again in a minute.');
          setPending(false);
          return;
        }
        // The summary names what changed (including "no new transactions"), so a
        // sync that did nothing can't be mistaken for one that never ran.
        setFlash('accounts', r.summary);
        // Full reload, matching the disconnect/sync precedent: every figure on the
        // page is server-rendered from what this just changed.
        window.location.reload();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Something went wrong.');
        setPending(false);
      }
    })();
  }

  return (
    <div className="space-y-1">
      <button
        type="button"
        data-testid="sync-all"
        disabled={pending}
        onClick={run}
        className="tap-target inline-flex w-full items-center justify-center gap-2 rounded-md border px-3 py-1.5 text-sm hover:bg-accent disabled:opacity-50"
      >
        <RefreshCw className={`size-4 ${pending ? 'animate-spin' : ''}`} aria-hidden />
        {pending ? 'Syncing all accounts…' : 'Sync all accounts'}
      </button>
      {error && (
        <p role="alert" className="text-xs text-red-400" data-testid="sync-all-error">
          {error}
        </p>
      )}
    </div>
  );
}
