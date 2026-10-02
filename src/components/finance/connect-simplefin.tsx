'use client';

/**
 * The SimpleFIN connection, for a reader who HAS one — or had one.
 *
 * SimpleFIN was the bridge to live bank data before Plaid was available. It is retired
 * as a way IN (DECISIONS #780): this component no longer offers to connect, and renders
 * nothing at all for a reader who never used it. What it still does:
 *
 *   - A connection that exists is shown and stays manageable: its freshness, how far
 *     back it reaches, Sync now, Disconnect. Nothing about an existing connection
 *     changed.
 *   - Accounts that outlived their connection (K.2b) still get the plain statement that
 *     the connection is gone and when their data stopped — and are pointed at the Plaid
 *     button directly below, which is how such a bank is linked now.
 *
 * Every stored SimpleFIN account, transaction and holding is untouched, as is the sync
 * code behind an existing connection; `connectSimplefin` itself remains for the
 * dashboard alert's repair of an existing connection (`simplefin-alert-reconnect.tsx`).
 *
 * Reliable-mutation recipe (#166/#167, finished in #170): a successful sync or
 * disconnect confirms with a FULL reload — not router.refresh() — so the re-rendered
 * accounts page can never show stale connection or transaction state. The confirmation
 * TEXT ("Synced 3 new transactions") rides `flash('accounts')` across that one reload
 * and renders in the accounts-list success banner (this component is a child of
 * AccountsList, which reads it). No withDeadline here: unlike the light DB writes, a
 * SimpleFIN action is a single-shot NETWORK call that can legitimately outlast the 8s
 * form deadline — an early reload would abandon a live sync.
 */
import { useState } from 'react';
import type { ConnectionDepth } from '@/lib/engine/account/connection-depth';
import { connectionDepthSentence } from '@/lib/engine/account/connection-depth-copy';
import { setFlash } from '@/components/finance/flash';
import { disconnectSimplefin, syncSimplefinNow } from '@/server/simplefin-actions';
import { type FreshnessResult, freshnessMessage } from '@/lib/engine/sync/health';
import { formatISODate, isoDate } from '@/lib/dates';

interface Result {
  ok: boolean;
  error?: string;
  added?: number;
  message?: string;
}

export function SimplefinConnection({
  connected,
  health,
  orphaned,
  historyDepth,
}: {
  connected: boolean;
  /** How far back the SimpleFIN feed's own history reaches (TASKS H.1(b)). */
  historyDepth: ConnectionDepth;
  /** Freshness of the last sync (Gap 1 §3) — drives the "synced N days ago" hint. */
  health: FreshnessResult;
  /** K.2b: non-null when SimpleFIN accounts exist but their connection row does NOT — the
   *  disconnect flow deletes the row and keeps the data, so this state is a designed
   *  destination, not corruption. The page must then say the connection is GONE; frozen
   *  accounts with nothing said about them is how a deleted connection stayed invisible
   *  for 16 days on production. */
  orphaned: { count: number; lastDataAt: string | null } | null;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  function run(fn: () => Promise<Result>) {
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
        // Success. Carry the confirmation text across the confirming reload.
        const text =
          r.message ??
          (typeof r.added === 'number' ? `Synced ${r.added} new transaction${r.added === 1 ? '' : 's'}.` : 'Done.');
        setFlash('accounts', text);
        // Reload, not router.refresh() — the re-rendered page can't lie. `pending`
        // stays true so the controls remain disabled until the new page paints.
        window.location.reload();
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Something went wrong.');
        setPending(false);
      }
    })();
  }

  const btn = 'rounded-md border px-2 py-1 text-xs hover:bg-accent disabled:opacity-50';

  const stale = health.level === 'stale' || health.level === 'very_stale';

  if (connected) {
    return (
      <div className="space-y-1" data-testid="simplefin-connected">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className={`text-xs ${stale ? 'text-warning-300' : 'text-muted-foreground'}`}
            data-testid="simplefin-sync-status"
          >
            Bank sync connected · {freshnessMessage(health)}
          </span>
          <button type="button" data-testid="simplefin-sync" disabled={pending} onClick={() => run(syncSimplefinNow)} className={btn}>
            {pending ? 'Syncing…' : 'Sync now'}
          </button>
          <button type="button" data-testid="simplefin-disconnect" disabled={pending} onClick={() => run(disconnectSimplefin)} className={`${btn} text-red-400`}>
            Disconnect
          </button>
        </div>
        {/* Same claim, same rule and the same sentence set as every Plaid connection card
            (TASKS H.1(b)). Silence here would make the depth answer appear and disappear
            across providers with no rule the reader could infer — and on the live corpus this
            feed is the DEEPER half. */}
        <div className="text-xs text-muted-foreground" data-testid="simplefin-history">
          {connectionDepthSentence(historyDepth)}
        </div>
        {error && <p role="alert" className="text-xs text-red-400">{error}</p>}
        {/* #780 critic P2-1: before the retirement a disconnected SimpleFIN could be
            re-linked by pasting a new token; now it cannot, so the one-way door is named
            before it is used. */}
        <p className="text-[11px] text-muted-foreground" data-testid="simplefin-disconnect-note">
          Disconnecting is final: SimpleFIN is no longer offered, so it cannot be reconnected.
          Your synced history stays either way, and the bank can be linked again with Plaid.
        </p>
        <p className="text-[11px] text-warning-300/80" data-testid="simplefin-type-notice">
          Account types are guessed from the bank’s name — double-check that any cards or loans
          appear under <b>Liabilities</b> so your net worth is right.
        </p>
      </div>
    );
  }

  // Never connected, or every SimpleFIN account has since been combined into the account
  // that carries it on: there is nothing to say, and nothing is offered.
  if (!orphaned) return null;

  return (
    <div className="space-y-1">
      {/* The connection is PROVEN gone (no row), while these accounts remain — state the fact
          and the consequence. The date is when DATA stopped, not when the connection was
          removed: nothing records the removal moment (the row that would is the thing that
          was deleted), so the copy claims only what the data shows. */}
      <p className="text-xs text-warning-300" data-testid="simplefin-disconnected-notice" role="status">
        Your SimpleFIN connection was removed. {orphaned.count === 1 ? 'The account' : `${orphaned.count} accounts`} linked
        through it stopped updating
        {orphaned.lastDataAt ? ` — no new transactions since ${formatISODate(isoDate(orphaned.lastDataAt), 'long')}` : ''}.
        Your saved transactions are kept. SimpleFIN is no longer offered for new connections — to
        resume updates, connect that bank with the button below.
      </p>
      {/* The notice above says when the data STOPPED; this says where it STARTS. Together they
          are the span, which is the whole point of H.1(b). */}
      <div className="text-xs text-muted-foreground" data-testid="simplefin-history">
        {connectionDepthSentence(historyDepth)}
      </div>
    </div>
  );
}
