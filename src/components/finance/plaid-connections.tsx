'use client';

/**
 * Plaid connections manager (#256) — one row per linked bank (Plaid item) with a
 * two-tap Disconnect. Complements ConnectAccountsButton (the link front door):
 * before this, `/item/remove` existed in the provider but had NO surface, so a
 * user could connect a bank and never sever it (the gap #253 recorded as
 * "unblocks when a Plaid item-disconnect action exists").
 *
 * Disconnect keeps already-synced accounts and history (the SimpleFIN
 * precedent); the success message says so and points at the now-available
 * per-account Delete controls. Reliable-mutation recipe: success confirms with a
 * FULL reload, and the confirmation text rides flash('accounts') across it.
 */
import { useState } from 'react';
import { setFlash } from '@/components/finance/flash';
import { ConfirmPrompt, useConfirmArm } from '@/components/ui/confirm-action';
import { disconnectPlaidItem, syncPlaidNow } from '@/server/plaid-actions';

export interface PlaidItemView {
  itemId: string;
  institution: string | null;
  lastSyncedAt: string | null;
  /** The accounts under this connection (name + last-4). Rendered so two connections at the
   *  SAME bank — e.g. a member's own Chase and their spouse's Chase — are distinguishable, and
   *  so it's clear which one a Disconnect removes (owner-reported 2026-07-23). */
  accounts: { name: string; mask: string | null }[];
}

export function PlaidConnections({ items }: { items: PlaidItemView[] }) {
  const confirm = useConfirmArm();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  if (items.length === 0) return null;

  /**
   * On-demand sync for every linked Plaid bank. Before this the only Plaid ingest
   * was the one-shot pull at link time, so "last synced" could sit a week stale
   * with nothing in the UI able to move it (owner-reported 2026-07-23).
   */
  function syncNow(itemId: string, institution: string | null) {
    if (syncing || pending) return;
    setError(null);
    setSyncing(true);
    void (async () => {
      try {
        const r = await syncPlaidNow(itemId);
        if (!r.ok) {
          setError(r.error ?? 'Something went wrong.');
          setSyncing(false);
          return;
        }
        // Say what actually happened rather than a generic "done": a sync that
        // ingests nothing is a real outcome the user should be able to tell apart
        // from one that never ran.
        setFlash(
          'accounts',
          [
            `Synced ${institution ?? 'your bank'}.`,
            // Same rule as the all-provider summary: a failed pull is NOT zero
            // transactions, and must never be reported as (or silently look like)
            // a clean result.
            r.transactionsFailed
              ? 'Your bank didn’t return transactions this time, so anything new is still missing.'
              : `${r.added ?? 0} new transaction${(r.added ?? 0) === 1 ? '' : 's'}.`,
            r.statementsWritten
              ? `${r.statementsWritten} card statement${r.statementsWritten === 1 ? '' : 's'} updated.`
              : r.liabilitiesFailed
                ? 'Your bank returned no card statement data this time.'
                : null,
          ]
            .filter(Boolean)
            .join(' '),
        );
        // Full reload for the same reason disconnect does it: every figure on the
        // page is server-rendered from what this sync just changed.
        window.location.reload();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Something went wrong.');
        setSyncing(false);
      }
    })();
  }

  function disconnect(itemId: string) {
    if (pending) return;
    setError(null);
    setPending(true);
    void (async () => {
      try {
        const r = await disconnectPlaidItem(itemId);
        if (!r.ok) {
          setError(r.error ?? 'Something went wrong.');
          setPending(false);
          confirm.disarm();
          return;
        }
        setFlash('accounts', r.message ?? 'Bank disconnected.');
        // Reload, not router.refresh() — the re-rendered page can't lie (the
        // Delete controls this disconnect unlocks must appear). `pending` stays
        // true so the controls remain disabled until the new page paints.
        window.location.reload();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Something went wrong.');
        setPending(false);
        confirm.disarm();
      }
    })();
  }

  return (
    <div className="space-y-1" data-testid="plaid-connections">
      {items.map((item) => (
        // A5 (2026-07-21 review): one CARD per bank, not one flex row. At 380px the
        // institution line plus a Disconnect button never fit on one line — and the
        // armed state (a full sentence plus two buttons) made it worse — so the row
        // is now a bordered block whose status text and controls stack when they
        // must. Multiple linked banks also stop reading as one run-on list.
        <div
          key={item.itemId}
          className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 rounded-md border px-2 py-1.5"
        >
          <span className="min-w-0 text-xs text-muted-foreground" data-testid="plaid-item-status">
            Plaid: {item.institution ?? 'Connected bank'} ·{' '}
            {item.lastSyncedAt ? `last synced ${item.lastSyncedAt}` : 'not synced yet'}
          </span>
          {!confirm.isArmed(item.itemId) ? (
            <div className="flex shrink-0 gap-1">
            <button
              type="button"
              data-testid="plaid-sync"
              aria-label={`Sync ${item.institution ?? 'this bank'} now (Plaid)`}
              disabled={syncing || pending}
              onClick={() => syncNow(item.itemId, item.institution)}
              className="tap-target inline-flex items-center justify-center rounded-md border px-2 py-1 text-xs hover:bg-accent disabled:opacity-50"
            >
              {syncing ? 'Syncing…' : 'Sync'}
            </button>
            <button
              type="button"
              data-testid="plaid-disconnect"
              aria-label={`Disconnect ${item.institution ?? 'this bank'} (Plaid)`}
              disabled={pending}
              onClick={() => confirm.arm(item.itemId)}
              className="shrink-0 rounded-md border px-2 py-1 text-xs text-red-400 hover:bg-accent disabled:opacity-50"
            >
              Disconnect
            </button>
            </div>
          ) : (
            <ConfirmPrompt
              rowTestId="plaid-disconnect-confirm-row"
              prompt="Disconnect? Synced accounts and history are kept."
              confirmLabel={pending ? 'Disconnecting…' : 'Yes'}
              confirmTestId="plaid-disconnect-confirm"
              confirmAriaLabel={`Yes, disconnect ${item.institution ?? 'this bank'}`}
              pending={pending}
              onConfirm={() => disconnect(item.itemId)}
              onCancel={confirm.disarm}
            />
          )}
          {item.accounts.length > 0 && (
            // Full-width second line: the cards under this connection, each with its last-4, so
            // two same-bank connections are distinguishable and you can see what a Disconnect
            // would remove (owner-reported: two identical "Plaid: Chase" rows).
            <span
              className="w-full text-xs text-muted-foreground/70"
              data-testid="plaid-item-accounts"
            >
              {item.accounts
                .map((a) => (a.mask ? `${a.name} ····${a.mask}` : a.name))
                .join(' · ')}
            </span>
          )}
        </div>
      ))}
      {error && (
        <p role="alert" className="text-xs text-red-400" data-testid="plaid-disconnect-error">
          {error}
        </p>
      )}
    </div>
  );
}
