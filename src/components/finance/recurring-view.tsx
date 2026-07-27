/**
 * Recurring & subscriptions (DECISIONS #71). Server-rendered: a headline monthly
 * total, then subscriptions / bills / recurring income / no-longer-charging,
 * each row showing what you pay, on what cadence, when it's next due, with price
 * increases and possibly-unused memberships surfaced as gentle flags (coach
 * guardrails: a question, never a scold).
 */
import { CalendarClock, Repeat, TrendingUp } from 'lucide-react';
import { CurrencyExclusionBanner } from '@/components/finance/currency-exclusion-banner';
import { formatISODate, isoDate } from '@/lib/dates';
import { cents, formatCents } from '@/lib/money';
import { CATEGORY_BY_ID } from '@/lib/engine/categorize/categories';
import type { Cadence } from '@/lib/engine/recurring/detect';
import type { WithheldAccountSummary } from '@/lib/providers/currency';
import type { RecurringData } from '@/server/recurring';
import { priceChangeBadge, type RecurringItem } from '@/lib/engine/recurring/summary';
import { renewalsWithin } from '@/lib/engine/recurring/renewals';

const CADENCE_SUFFIX: Record<Cadence, string> = {
  WEEKLY: '/wk',
  BIWEEKLY: '/2wk',
  MONTHLY: '/mo',
  QUARTERLY: '/3mo',
  SEMIANNUAL: '/6mo',
  ANNUAL: '/yr',
  IRREGULAR: '',
};

function Row({
  item,
  accountNames,
  categoryNames,
}: {
  item: RecurringItem;
  accountNames: Record<string, string>;
  categoryNames: Record<string, string>;
}) {
  const mag = Math.abs(item.lastAmountCents);
  // Prefer the server-resolved name (covers custom categories, #111); fall back to
  // the static map, then a friendly placeholder — never a raw cuid (critic F8).
  const catName = categoryNames[item.categoryId] ?? CATEGORY_BY_ID.get(item.categoryId)?.name ?? 'Uncategorized';
  // Color by whether the change helps the user: a rising bill is bad (rose), but a
  // rising paycheck is good (emerald). Pure helper so this is unit-locked (REC-2).
  const change = priceChangeBadge(item);
  return (
    <li
      data-testid="recurring-row"
      data-merchant={item.merchantCanonical}
      className="flex items-center justify-between gap-3 px-4 py-2.5"
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="truncate font-medium">{item.merchantCanonical}</span>
          {change && (
            <span
              data-testid="price-change-badge"
              className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-medium ${
                change.tone === 'favorable'
                  ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                  : 'border-rose-500/40 bg-rose-500/10 text-rose-600 dark:text-rose-400'
              }`}
            >
              {change.increased ? '↑' : '↓'} was {formatCents(cents(change.previousMagnitudeCents))}
            </span>
          )}
          {item.possiblyUnused && (
            <span className="shrink-0 rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">
              Worth a look?
            </span>
          )}
        </div>
        <div className="truncate text-xs text-muted-foreground">
          {catName} · {accountNames[item.accountId] ?? '—'}
        </div>
      </div>
      {/* The next-charge date is the row's key fact — it lives in the fixed right
          column so the truncating left subtitle can never swallow it (it did at
          380px: "next ~ Mon, Ju…"). */}
      <div className="shrink-0 text-right">
        <div className="tabular-nums">
          <span className="font-medium">{formatCents(cents(mag))}</span>
          <span className="text-xs text-muted-foreground">{CADENCE_SUFFIX[item.cadence]}</span>
        </div>
        <div className="text-xs text-muted-foreground">
          {item.active ? (
            <>next ~ {formatISODate(isoDate(item.nextExpectedAt))}</>
          ) : (
            <>last seen {formatISODate(isoDate(item.lastSeenAt))}</>
          )}
        </div>
      </div>
    </li>
  );
}

function Section({
  title,
  hint,
  items,
  accountNames,
  categoryNames,
  testid,
  muted,
}: {
  title: string;
  hint?: string;
  items: RecurringItem[];
  accountNames: Record<string, string>;
  categoryNames: Record<string, string>;
  testid?: string;
  muted?: boolean;
}) {
  if (items.length === 0) return null;
  return (
    <section className="overflow-hidden rounded-2xl border bg-card shadow-sm">
      <div className="flex items-baseline justify-between px-4 pt-4">
        <h2 className={`text-sm font-semibold ${muted ? 'text-muted-foreground' : ''}`}>{title}</h2>
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      </div>
      {/* NOTE: the muted section must NOT dim its rows (the old `opacity-70` here
          multiplied text-muted-foreground below the WCAG AA 4.5:1 contrast floor —
          latent until #251 put the first inactive row on the demo). The quieter
          look comes from the muted TITLE only; row text keeps full contrast. */}
      <ul className="mt-2 divide-y" data-testid={testid}>
        {items.map((i) => (
          <Row
            key={`${i.merchantCanonical}:${i.accountId}`}
            item={i}
            accountNames={accountNames}
            categoryNames={categoryNames}
          />
        ))}
      </ul>
    </section>
  );
}

export function RecurringView({
  data,
  withheld,
}: {
  data: RecurringData;
  withheld: WithheldAccountSummary;
}) {
  const s = data.summary;
  const hasAny = s.items.length > 0;
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <h1 className="sr-only">Recurring &amp; subscriptions</h1>
      {/* currency-guard disclosure (#135 residual): withheld non-USD accounts must not
          vanish silently. Renders nothing for all-USD users (the overwhelming case). */}
      <CurrencyExclusionBanner summary={withheld} />
      {/* Hero: total monthly recurring */}
      <section
        data-testid="recurring-hero"
        className="rounded-2xl border bg-gradient-to-br from-card to-accent/30 p-6 text-center shadow-sm"
      >
        <p className="flex items-center justify-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          <Repeat className="size-3.5" aria-hidden /> Monthly recurring
        </p>
        <p
          data-testid="recurring-monthly-total"
          className="mt-1 text-5xl font-bold tabular-nums tracking-tight"
        >
          {formatCents(cents(s.monthlyRecurringSpendCents))}
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          {plural(s.activeSubscriptionCount, 'subscription')} · {plural(s.bills.length, 'bill')} · ≈{' '}
          {formatCents(cents(s.monthlyRecurringSpendCents * 12))}/yr
        </p>
        {/* L.24 copy critic P3-4: this headline silently normalizes anything longer
            than monthly into a per-month share (PER_MONTH), which was reachable
            only for a yearly bill before L.24 added two more cadences. A reader
            comparing this figure with what actually leaves their account each
            month deserves to know which rows are averages rather than charges. */}
        {s.items.some(
          (i) => i.active && (i.cadence === 'QUARTERLY' || i.cadence === 'SEMIANNUAL' || i.cadence === 'ANNUAL'),
        ) && (
          <p className="mt-2 text-xs text-muted-foreground" data-testid="recurring-smoothing-note">
            Bills that arrive less often than monthly (marked /3mo, /6mo or /yr) are counted here
            at their monthly share, not on the month they actually charge.
          </p>
        )}
        {s.priceIncreases.length > 0 && (
          <p className="mt-3 inline-flex items-center gap-1 rounded-full border border-rose-500/40 bg-rose-500/10 px-2.5 py-1 text-xs font-medium text-rose-600 dark:text-rose-400">
            <TrendingUp className="size-3.5" aria-hidden />
            {plural(s.priceIncreases.length, 'price increase')} since these started
          </p>
        )}
      </section>

      {/* Coming up (#246): the forward renewal schedule — expected charges over the
          next 7/30/90 days, expanded from each active series' usual timing. Every
          amount is the series' most recent real charge copied verbatim; the copy
          below labels the whole section an estimate (assumptions stated inline per
          the coaching guardrails — these are expectations, not bills). */}
      {data.renewals.occurrences.length > 0 && (
        <section
          data-testid="coming-up"
          className="overflow-hidden rounded-2xl border bg-card shadow-sm"
        >
          <div className="flex items-baseline justify-between px-4 pt-4">
            <h2 className="flex items-center gap-1.5 text-sm font-semibold">
              <CalendarClock className="size-3.5" aria-hidden /> Coming up
            </h2>
            <span className="text-xs text-muted-foreground">expected charges</span>
          </div>
          <div className="mt-3 grid grid-cols-3 divide-x border-t">
            {data.renewals.horizons.map((h) => (
              <div key={h.days} data-testid={`coming-up-${h.days}d`} className="min-w-0 px-3 py-2.5 text-center">
                <div className="text-xs text-muted-foreground">next {h.days} days</div>
                <div className="break-words font-semibold tabular-nums">{formatCents(cents(h.totalCents))}</div>
                <div className="text-[10px] text-muted-foreground">{plural(h.count, 'charge')}</div>
              </div>
            ))}
          </div>
          <ul className="divide-y border-t" data-testid="coming-up-list">
            {renewalsWithin(data.renewals.occurrences, 30).map((o) => (
                <li
                  key={`${o.date}:${o.merchantCanonical}:${o.accountId}`}
                  data-testid="coming-up-row"
                  data-merchant={o.merchantCanonical}
                  className="flex items-center justify-between gap-3 px-4 py-2"
                >
                  <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                    <span className="truncate font-medium">{o.merchantCanonical}</span>
                    {o.increasedFromCents !== null && (
                      <span className="shrink-0 rounded border border-rose-500/40 bg-rose-500/10 px-1.5 py-0.5 text-[10px] font-medium text-rose-600 dark:text-rose-400">
                        ↑ was {formatCents(cents(o.increasedFromCents))}
                      </span>
                    )}
                  </div>
                  <div className="shrink-0 text-right">
                    <span className="font-medium tabular-nums">{formatCents(cents(o.amountCents))}</span>
                    <div className="text-xs text-muted-foreground">
                      {o.daysOut === 0 ? 'expected today' : <>~ {formatISODate(isoDate(o.date))}</>}
                    </div>
                  </div>
                </li>
              ))}
          </ul>
          <p className="px-4 pb-3 pt-2 text-xs text-muted-foreground">
            Expected from each one&apos;s usual timing and most recent amount — estimates, not
            bills. The list shows the next 30 days.
          </p>
        </section>
      )}

      {!hasAny ? (
        <p className="rounded-2xl border border-dashed bg-card p-8 text-center text-sm text-muted-foreground shadow-sm">
          No recurring charges detected yet. Subscriptions and bills appear here once they&apos;ve
          billed three times at a steady price — which for a quarterly bill is about six months,
          and for a yearly one about two years.
        </p>
      ) : (
        <>
          <Section
            title="Subscriptions"
            hint={`${formatCents(cents(s.subscriptions.reduce((a, i) => a + i.monthlyEquivalentCents, 0)))}/mo`}
            items={s.subscriptions}
            accountNames={data.accountNames}
            categoryNames={data.categoryNames}
            testid="recurring-list"
          />
          <Section
            title="Bills & obligations"
            hint={`${formatCents(cents(s.bills.reduce((a, i) => a + i.monthlyEquivalentCents, 0)))}/mo`}
            items={s.bills}
            accountNames={data.accountNames}
            categoryNames={data.categoryNames}
          />
          <Section
            title="Recurring income"
            hint={s.monthlyIncomeCents > 0 ? `${formatCents(cents(s.monthlyIncomeCents))}/mo` : undefined}
            items={s.income}
            accountNames={data.accountNames}
            categoryNames={data.categoryNames}
          />
          <Section
            title="No longer charging"
            hint="appears to have stopped"
            items={s.inactive}
            accountNames={data.accountNames}
            categoryNames={data.categoryNames}
            muted
          />
        </>
      )}

      <p className="px-1 text-xs text-muted-foreground">
        Detected from your transaction history — cadence, price changes, and what&apos;s next are
        estimates. Always confirm before canceling anything.
      </p>
    </div>
  );
}
