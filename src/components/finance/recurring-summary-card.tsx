import Link from 'next/link';
import { Repeat, TrendingUp } from 'lucide-react';
import { formatISODate, isoDate } from '@/lib/dates';
import { cents, formatCents } from '@/lib/money';
import type { RecurringSummary } from '@/lib/engine/recurring/summary';

/**
 * Dashboard entry point for Recurring & subscriptions (DECISIONS #71): the
 * monthly recurring total, the next charge coming up, and a nudge if any prices
 * rose. Whole-card link to the full view.
 */
export function RecurringSummaryCard({ summary }: { summary: RecurringSummary }) {
  const noRecurring = summary.subscriptions.length === 0 && summary.bills.length === 0;
  const next = [...summary.subscriptions, ...summary.bills].sort((a, b) =>
    a.nextExpectedAt < b.nextExpectedAt ? -1 : a.nextExpectedAt > b.nextExpectedAt ? 1 : 0,
  )[0];

  return (
    <Link
      href="/recurring"
      data-testid="dashboard-recurring"
      className="block rounded-2xl border bg-card p-4 shadow-sm transition hover:border-foreground/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <Repeat className="size-3.5" aria-hidden /> Recurring &amp; subscriptions
        </div>
        {!noRecurring && summary.priceIncreases.length > 0 && (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-rose-600 dark:text-rose-400">
            <TrendingUp className="size-3.5" aria-hidden /> {summary.priceIncreases.length} ↑
          </span>
        )}
      </div>
      {noRecurring ? (
        <p className="mt-1.5 text-sm text-muted-foreground" data-testid="dashboard-recurring-empty">
          No recurring charges detected yet — they show up once a subscription or bill has posted a
          couple of times.
        </p>
      ) : (
        <>
          <p className="mt-1.5 text-2xl font-bold tabular-nums" data-testid="dashboard-recurring-total">
            {formatCents(cents(summary.monthlyRecurringSpendCents))}
            <span className="ml-1 text-sm font-normal text-muted-foreground">/mo</span>
          </p>
          {/* #166: the headline total is subscriptions + bills — say so. "8
              subscriptions" alone misattributed rent/loans to subscriptions. */}
          <p className="mt-0.5 text-xs text-muted-foreground">
            {summary.activeSubscriptionCount} subscription{summary.activeSubscriptionCount === 1 ? '' : 's'}
            {summary.bills.length > 0 && (
              <> + {summary.bills.length} bill{summary.bills.length === 1 ? '' : 's'}</>
            )}
            {next && (
              <>
                {' '}
                · next: {next.merchantCanonical} {formatISODate(isoDate(next.nextExpectedAt))}
              </>
            )}
          </p>
        </>
      )}
    </Link>
  );
}
