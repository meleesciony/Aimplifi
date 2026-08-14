'use client';

/**
 * SimpleFIN connect/sync front door (ROADMAP: cheaper Plaid alternative). The
 * user pastes a one-time setup token from simplefin.org; the action claims it,
 * stores an encrypted read-only access URL, and pulls accounts + transactions.
 * Dormant until used; no network on render.
 *
 * Reliable-mutation recipe (#166/#167, finished in #170): a successful
 * connect/sync/disconnect confirms with a FULL reload — not router.refresh() —
 * so the re-rendered accounts page can never show stale connection or
 * transaction state. The confirmation TEXT ("Synced 3 new transactions") rides
 * `flash('accounts')` across that one reload and renders in the accounts-list
 * success banner (this component is a child of AccountsList, which reads it).
 * No withDeadline here: unlike the light DB writes, a SimpleFIN action is a
 * single-shot NETWORK call that can legitimately outlast the 8s form deadline —
 * an early reload would abandon a live sync — and there is no rapid-sequential
 * severed-stream case to recover from.
 */
import { useState } from 'react';
import type { ConnectionDepth } from '@/lib/engine/account/connection-depth';
import { connectionDepthSentence } from '@/lib/engine/account/connection-depth-copy';
import { setFlash } from '@/components/finance/flash';
import { connectSimplefin, disconnectSimplefin, syncSimplefinNow } from '@/server/simplefin-actions';
import { type FreshnessResult, freshnessMessage } from '@/lib/engine/sync/health';
import { formatISODate, isoDate } from '@/lib/dates';

interface Result {
  ok: boolean;
  error?: string;
  added?: number;
  message?: string;
}

export function ConnectSimplefin({
  connected,
  health,
  orphaned,
  historyDepth,
}: {
  connected: boolean;
  /** How far back the SimpleFIN feed's own history reaches (TASKS H.1(b)). */
  historyDepth: ConnectionDepth;
  /** Freshness of the last sync (Gap 1 §3) — drives the "synced N days ago / reconnect" hint. */
  health: FreshnessResult;
  /** K.2b: non-null when SimpleFIN accounts exist but their connection row does NOT — the
   *  disconnect flow deletes the row and keeps the data, so this state is a designed
   *  destination, not corruption. The front door must then say the connection is GONE and
   *  read as a reconnect; the plain "+ Connect a bank" first-time door over 25 frozen
   *  accounts is how a deleted connection stayed invisible for 16 days on production. */
  orphaned: { count: number; lastDataAt: string | null } | null;
}) {
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState('');
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
        // `r.error` on an ok result is the connected-but-first-sync-failed case:
        // the connection DID save, so reload to show it — but frame it as the
        // success it is (a "failed" string would render green in the accounts
        // success banner; #170 critic P2) with the retry as the next step.
        const text = r.error
          ? 'Bank connected — open Accounts and tap “Sync now” to pull your transactions.'
          : (r.message ??
            (typeof r.added === 'number'
              ? `Synced ${r.added} new transaction${r.added === 1 ? '' : 's'}.`
              : 'Done.'));
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
        <p className="text-[11px] text-warning-300/80" data-testid="simplefin-type-notice">
          Account types are guessed from the bank’s name — double-check that any cards or loans
          appear under <b>Liabilities</b> so your net worth is right.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {orphaned && (
        // The connection is PROVEN gone (no row), while these accounts remain — state the fact
        // and the consequence before offering the door, so the button below cannot read as
        // first-time setup over frozen data. The date is when DATA stopped, not when the
        // connection was removed: nothing records the removal moment (the row that would is
        // the thing that was deleted), so the copy claims only what the data shows.
        <p className="text-xs text-warning-300" data-testid="simplefin-disconnected-notice" role="status">
          Your SimpleFIN connection was removed. {orphaned.count === 1 ? 'The account' : `${orphaned.count} accounts`} linked
          through it stopped updating
          {orphaned.lastDataAt ? ` — no new transactions since ${formatISODate(isoDate(orphaned.lastDataAt), 'long')}` : ''}.
          Reconnect below to resume updates; your saved transactions are kept.
        </p>
      )}
      {orphaned && (
        // The notice above says when the data STOPPED; this says where it STARTS. Together they
        // are the span, which is the whole point of H.1(b) — and this is the state the owner is
        // actually in (his SimpleFinConnection row is deleted, DECISIONS #421), so a depth line
        // that rendered only in the connected branch would answer for everyone except him.
        <div className="text-xs text-muted-foreground" data-testid="simplefin-history">
          {connectionDepthSentence(historyDepth)}
        </div>
      )}
      <button
        type="button"
        data-testid="simplefin-connect-btn"
        disabled={pending}
        onClick={() => { setOpen(!open); setError(null); }}
        className="rounded-md border border-brand-700/40 bg-brand-950/30 px-3 py-1.5 text-sm font-medium text-brand-300 hover:bg-brand-950/50 disabled:opacity-50"
      >
        {orphaned ? 'Reconnect your bank (SimpleFIN)' : '+ Connect a bank (SimpleFIN)'}
      </button>
      {open && (
        <div className="space-y-2 rounded-lg border p-3" data-testid="simplefin-form">
          <p className="text-xs text-muted-foreground">
            A cheaper, privacy-first alternative to Plaid. Create a one-time <b>setup token</b> at
            simplefin.org (a few dollars/year, read-only) and paste it below — Aimplifi stores only an
            encrypted read-only access URL, never your bank password.
            {orphaned && (
              // No "resumes where your data stopped" (critic P1-1): the backfill that covers
              // the disconnected gap works oldest-first in capped batches, so the most recent
              // gap is the LAST to fill — promise the kept data and the direction, not a
              // sequencing the machinery doesn't deliver.
              <>
                {' '}Reconnecting keeps everything already saved and restarts updates going
                forward; a background backfill then reaches back for the missed days and older
                history over the next several syncs, as far back as your bank still shares.
              </>
            )}
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
              {pending ? (orphaned ? 'Reconnecting…' : 'Connecting…') : orphaned ? 'Reconnect' : 'Connect'}
            </button>
            <button type="button" disabled={pending} onClick={() => { setOpen(false); setError(null); }} className="rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent disabled:opacity-50">
              Cancel
            </button>
          </div>
        </div>
      )}
      {error && <p role="alert" className="text-xs text-red-400" data-testid="simplefin-error">{error}</p>}
    </div>
  );
}
