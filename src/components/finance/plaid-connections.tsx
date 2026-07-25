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
import { connectionOrdinals } from '@/components/finance/duplicate-card-view';
import { setFlash } from '@/components/finance/flash';
import { ConfirmPrompt, useConfirmArm } from '@/components/ui/confirm-action';
import { PlaidUpdateButton } from '@/components/finance/plaid-update-button';
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

  const ordinals = connectionOrdinals(items);

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
        // A BLOCK card, not one wrapping flex row (owner-reported 2026-07-24: "some are aligned
        // while others aren't"). The old `flex-wrap … justify-between` put the controls on the
        // right for a short bank name ("Plaid: Chase") but WRAPPED them onto their own
        // left-aligned line for a long one ("Plaid: American Express"), so the buttons landed in
        // two different places down the list. Now the status text flexes/wraps in its own column
        // and the controls are pinned right on the first line, identically for every row.
        <div key={item.itemId} className="rounded-md border px-2 py-1.5">
          {/* Numbered the SAME way as the duplicate card (#296), so "connection 1 of 2" there is
              verifiable here instead of being card-local jargon. The ordinal also rides the two
              destructive controls' ACCESSIBLE NAMES: without it a screen-reader user hears
              "Disconnect U.S. Bank (Plaid)" twice with nothing to choose between (the same defect
              #296 fixes on the card, one section up — critic P2). Only shown when this bank really
              has more than one connection; "connection 1 of 1" would be noise. */}
          {(() => {
            const ord = ordinals.get(item.itemId);
            const bank = item.institution ?? 'this bank';
            const numbered = ord && ord.sameBankCount > 1;
            const which = numbered ? `, connection ${ord.ordinal} of ${ord.sameBankCount}` : '';
            const feeds = `${item.accounts.length} account${item.accounts.length === 1 ? '' : 's'}`;
            return (
              <>
                <div className="flex items-start justify-between gap-2">
                  <span className="min-w-0 flex-1 text-xs text-muted-foreground" data-testid="plaid-item-status">
                    Plaid: {item.institution ?? 'Connected bank'}
                    {numbered ? ` · connection ${ord.ordinal} of ${ord.sameBankCount}` : ''}{' '}
                    · {item.lastSyncedAt ? `last synced ${item.lastSyncedAt}` : 'not synced yet'}
                  </span>
                  {!confirm.isArmed(item.itemId) && (
                    <div className="flex shrink-0 flex-wrap justify-end gap-1">
                      {/* The duplicate-prevention door (L.10 layer 1). It sits beside Sync
                          because that is where someone goes when a bank looks wrong — and
                          the alternative they would otherwise reach for, connecting the
                          same bank a second time, is what creates a duplicate copy. */}
                      <PlaidUpdateButton
                        itemId={item.itemId}
                        bank={bank}
                        which={which}
                        disabled={syncing || pending}
                        onError={setError}
                      />
                      <button
                        type="button"
                        data-testid="plaid-sync"
                        aria-label={`Sync ${bank}${which} now (Plaid)`}
                        disabled={syncing || pending}
                        onClick={() => syncNow(item.itemId, item.institution)}
                        className="tap-target inline-flex items-center justify-center rounded-md border px-2 py-1 text-xs hover:bg-accent disabled:opacity-50"
                      >
                        {syncing ? 'Syncing…' : 'Sync'}
                      </button>
                      <button
                        type="button"
                        data-testid="plaid-disconnect"
                        aria-label={`Disconnect ${bank}${which} (Plaid, feeds ${feeds})`}
                        disabled={pending}
                        onClick={() => confirm.arm(item.itemId)}
                        className="tap-target inline-flex shrink-0 items-center justify-center rounded-md border px-2 py-1 text-xs text-red-400 hover:bg-accent disabled:opacity-50"
                      >
                        Disconnect
                      </button>
                    </div>
                  )}
                </div>
                {item.accounts.length > 0 && (
                  // The accounts under this connection, each with its last-4, so two same-bank
                  // connections are distinguishable and you can see what a Disconnect removes.
                  // Stays ABOVE the armed prompt (its original position): it is the evidence the
                  // confirm is asking you to act on, so it must not be pushed below the question.
                  // Not muted/70 — same contrast reason as the duplicate card's feeds line.
                  <div className="mt-1 text-xs text-muted-foreground" data-testid="plaid-item-accounts">
                    {item.accounts.map((a) => (a.mask ? `${a.name} ····${a.mask}` : a.name)).join(' · ')}
                  </div>
                )}
                {confirm.isArmed(item.itemId) && (
                  // Armed state gets its own full-width row — a sentence plus two buttons never
                  // fits beside the status text at 380px. The prompt names WHICH connection and
                  // what it feeds, and states the same two-step truth as the duplicate card
                  // (#296): disconnecting stops updates but the rows keep counting until deleted.
                  <div className="mt-1">
                    <ConfirmPrompt
                      rowTestId="plaid-disconnect-confirm-row"
                      prompt={`Disconnect ${bank}${which}? ${feeds} stop${item.accounts.length === 1 ? 's' : ''} updating. Nothing is deleted — they keep their history and keep counting until you delete them. Reconnecting means signing in at your bank again.`}
                      confirmLabel={pending ? 'Disconnecting…' : 'Yes'}
                      confirmTestId="plaid-disconnect-confirm"
                      confirmAriaLabel={`Yes, disconnect ${bank}${which}`}
                      pending={pending}
                      onConfirm={() => disconnect(item.itemId)}
                      onCancel={confirm.disarm}
                    />
                  </div>
                )}
              </>
            );
          })()}
        </div>
      ))}
      {/* Says once, where the decision is actually made, what the control above is for.
          Without it the honest-looking move for "my bank is missing an account" remains
          connecting that bank again — which is the one action that creates a second copy
          of everything already here.

          Both qualifiers are load-bearing, and a fresh-context critic put them there.
          "listed above" scopes the advice to banks that are actually in this list: a
          DISCONNECTED bank's row is deleted (removeItem) while its accounts are kept, so
          without the qualifier this sentence would name a control that isn't there and
          then forbid the only remaining action. And a genuinely different login at the
          same bank — a business account, a spouse's — really does need connecting
          separately: update mode cannot reach accounts behind another login, so calling
          that a duplicate would send someone hunting through a picker that will never
          list what they want. */}
      <p className="pt-1 text-xs text-muted-foreground" data-testid="plaid-update-hint">
        Missing an account, or a bank that stopped updating? Use <b>Add or fix accounts</b> on
        that bank in the list above — it reopens the connection you already have. Connecting a
        bank listed above a second time no longer makes a second copy: if every account that
        login shares is already here, we refresh what you have instead. (A different login at
        the same bank — a business account, or a partner’s — is not a copy: connect that one
        normally, and it is kept.)
      </p>
      {error && (
        <p role="alert" className="text-xs text-red-400" data-testid="plaid-disconnect-error">
          {error}
        </p>
      )}
    </div>
  );
}
