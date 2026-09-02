'use client';

/**
 * The two levers on /recurring (O.13f / O.15 slice 4).
 *
 * A false detection is visible HERE and almost nowhere else — the reader sees
 * "you pay Supercuts $45 every 3 months" and knows it is three haircuts, not a
 * bill. So this is where "not a bill" belongs, and where the instructions he has
 * already given are listed with their undo. Without that list a demoted series
 * would vanish from the page entirely, taking its own undo with it.
 *
 * Client islands only: the page itself stays a server component, and each control
 * calls the same server action the transaction detail view calls.
 */
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { ActionDeadline, withDeadline } from '@/components/triage/action-deadline';
import { FORM_ACTION_DEADLINE_MS } from '@/components/finance/form-deadline';
import {
  clearRecurringVerdict,
  markMerchantNotABill,
  recordRepeatingBillPaidThisCycle,
} from '@/server/recurring-override-actions';
import { PROJECTIONS_STALE_PARAM } from '@/components/finance/transaction-detail-params';
import type { VerdictEffect } from '@/lib/engine/recurring/override';

/** How each stored cadence reads in a sentence — never the raw enum spelling. */
const CADENCE_ADVERB: Record<string, string> = {
  WEEKLY: 'every week',
  BIWEEKLY: 'every two weeks',
  MONTHLY: 'every month',
  QUARTERLY: 'every three months',
  SEMIANNUAL: 'twice a year',
  ANNUAL: 'once a year',
};

type VerdictAction = () => Promise<
  { ok: true; projectionsRefreshed: boolean } | { ok: false; error: string }
>;

/** Shared: run, then reload so every figure on the page re-reads from the server
 *  rather than from an optimistic guess held here. */
function useVerdictRunner() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  function run(fn: VerdictAction) {
    if (busy) return;
    setBusy(true);
    setError(null);
    void (async () => {
      try {
        // The same deadline every other mutation on this app carries. Without it a
        // hung action left both buttons disabled forever with no sentence, and the
        // reader could not tell saved from lost (critic P2-7).
        const res = await withDeadline(fn(), FORM_ACTION_DEADLINE_MS);
        if (!res.ok) {
          setError(res.error);
          setBusy(false);
          return;
        }
        // Saved. If the rebuild that carries it to the cash surfaces did not run,
        // the reload carries a flag and the SERVER renders the notice — setting it
        // in state here would paint a sentence this navigation immediately throws
        // away, which is a message the reader never sees.
        window.location.assign(
          res.projectionsRefreshed
            ? window.location.pathname
            : `${window.location.pathname}?${PROJECTIONS_STALE_PARAM}=1`,
        );
      } catch (e) {
        setError(
          e instanceof ActionDeadline
            ? 'Aimplifi could not confirm that in time. Reload the page to see whether it saved.'
            : 'That did not go through. Reload the page to see the latest, then try again.',
        );
        setBusy(false);
      }
    })();
  }
  return { busy, error, run };
}

/**
 * "This does not repeat", on the row where the false detection is visible.
 *
 * Labelled "Not recurring" rather than "Not a bill" because this page lists
 * INCOME series too, and a paycheck the detector got wrong is not a bill by any
 * reading — the button has to be true of every row it renders on.
 */
export function NotABillButton({ merchantCanonical }: { merchantCanonical: string }) {
  const { busy, error, run } = useVerdictRunner();
  return (
    <div className="text-right">
      <Button
        size="sm"
        variant="ghost"
        disabled={busy}
        data-testid="recurring-not-a-bill"
        data-merchant={merchantCanonical}
        // The merchant is in the ACCESSIBLE name, not only in a data attribute:
        // a screen reader otherwise hears "Not recurring" a dozen times with
        // nothing to tell the rows apart (critic P2-8). `tap-target` is the app's
        // own minimum touch size, which this button had skipped.
        aria-label={`Mark ${merchantCanonical} as not recurring`}
        className="tap-target h-auto px-1.5 py-0.5 text-[11px] text-muted-foreground"
        onClick={() => run(() => markMerchantNotABill({ merchantCanonical }))}
      >
        Not recurring
      </Button>
      {error && (
        <p role="alert" className="text-[11px] text-rose-600 dark:text-rose-400">
          {error}
        </p>
      )}
    </div>
  );
}


/**
 * "I paid the upcoming occurrence" — advances next date. Expense rows only.
 */
export function PaidThisCycleButton({ merchantCanonical }: { merchantCanonical: string }) {
  const { busy, error, run } = useVerdictRunner();
  return (
    <div className="text-right">
      <Button
        size="sm"
        variant="ghost"
        disabled={busy}
        data-testid="recurring-paid-this-cycle"
        data-merchant={merchantCanonical}
        aria-label={`Record that ${merchantCanonical} paid this cycle`}
        className="tap-target h-auto px-1.5 py-0.5 text-[11px] text-muted-foreground"
        onClick={() => run(() => recordRepeatingBillPaidThisCycle({ merchantCanonical }))}
      >
        Paid this cycle
      </Button>
      {error && (
        <p role="alert" className="text-[11px] text-rose-600 dark:text-rose-400">
          {error}
        </p>
      )}
    </div>
  );
}

/**
 * Everything the reader has told this app about what repeats, with its undo.
 * Renders nothing when he has said nothing — an empty ledger is not a feature.
 */
export function RecurringInstructions({
  rows,
}: {
  rows: {
    merchantCanonical: string;
    decision: string;
    /** The rhythm HE chose (BILL only). */
    cadence: string | null;
    /** What the instruction is actually doing — decided by the engine, not here. */
    effect: VerdictEffect;
    /** The rhythm actually being projected, when a series exists at all. */
    effectiveCadence: string | null;
  }[];
}) {
  const { busy, error, run } = useVerdictRunner();
  if (rows.length === 0) return null;
  return (
    <section className="rounded-2xl border bg-card p-4 shadow-sm" data-testid="recurring-instructions">
      <h2 className="text-sm font-medium">What you&rsquo;ve told Aimplifi</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        These override what Aimplifi works out on its own. Removing one puts that payee back to
        whatever the charges themselves say.
      </p>
      <ul className="mt-2 divide-y">
        {rows.map((r) => (
          <li
            key={r.merchantCanonical}
            data-testid="recurring-instruction"
            data-merchant={r.merchantCanonical}
            className="flex flex-wrap items-center justify-between gap-2 py-2"
          >
            <div className="min-w-0">
              <div className="truncate text-sm">{r.merchantCanonical}</div>
              {/* One sentence per named effect. An instruction that matches no
                  charges, or one detection has since overtaken, is doing something
                  other than what the reader asked for — and the difference between
                  a lever that works and one he BELIEVES works is that it says so. */}
              <div className="text-xs text-muted-foreground" data-testid="recurring-instruction-effect">
                {r.effect === 'suppressed' ? (
                  <>You marked this as not recurring, so it is left out of Recurring and your forecasts</>
                ) : r.effect === 'projected-as-declared' ? (
                  // Says what is TRUE of every declared series — the rhythm is his
                  // and the amount is his latest charge — and claims nothing about
                  // forecasts. Whether a series reaches the cash surfaces depends on
                  // the account it charges (a card bill is already inside that card's
                  // payment) and this panel cannot see that decision; the earlier
                  // draft asserted "projected" for all of them, which the money
                  // critic falsified in three reachable states.
                  <>
                    You marked this as recurring, {CADENCE_ADVERB[r.cadence ?? ''] ?? 'on a schedule'} —
                    listed above, at the amount of your most recent charge to it
                  </>
                ) : r.effect === 'detected-anyway' ? (
                  <>
                    You marked this as recurring. Aimplifi now sees the pattern in the charges
                    themselves and uses{' '}
                    {CADENCE_ADVERB[r.effectiveCadence ?? ''] ?? 'the rhythm it found'}, so removing
                    this would change nothing
                  </>
                ) : (
                  // "No charges" is about what THIS page counts, and says so: the
                  // reader may be looking straight at a charge that is pending, or
                  // on an account Recurring does not read (critic P2-6).
                  <>
                    You marked this as recurring, but Recurring sees no posted charges under this
                    payee on your everyday or card accounts
                  </>
                )}
              </div>
            </div>
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              data-testid="recurring-instruction-undo"
              aria-label={`Remove what you told Aimplifi about ${r.merchantCanonical}`}
              onClick={() => run(() => clearRecurringVerdict({ merchantCanonical: r.merchantCanonical }))}
            >
              Remove
            </Button>
          </li>
        ))}
      </ul>
      {error && (
        <p role="alert" className="mt-2 text-xs text-rose-600 dark:text-rose-400">
          {error}
        </p>
      )}
    </section>
  );
}
