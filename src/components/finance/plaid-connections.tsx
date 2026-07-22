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
import { disconnectPlaidItem } from '@/server/plaid-actions';

export interface PlaidItemView {
  itemId: string;
  institution: string | null;
  lastSyncedAt: string | null;
}

export function PlaidConnections({ items }: { items: PlaidItemView[] }) {
  const confirm = useConfirmArm();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (items.length === 0) return null;

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
