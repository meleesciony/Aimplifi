/**
 * Recurring & subscriptions (DECISIONS #71). Server-rendered: a headline monthly
 * total, then subscriptions / bills / recurring income / no-longer-charging,
 * each row showing what you pay, on what cadence, when it's next due, with price
 * increases and possibly-unused memberships surfaced as gentle flags (coach
 * guardrails: a question, never a scold).
 */
import { Repeat, TrendingUp } from 'lucide-react';
import { CurrencyExclusionBanner } from '@/components/finance/currency-exclusion-banner';
import { formatISODate, isoDate } from '@/lib/dates';
import { cents, formatCents } from '@/lib/money';
import { CATEGORY_BY_ID } from '@/lib/engine/categorize/categories';
import type { Cadence } from '@/lib/engine/recurring/detect';
import type { WithheldAccountSummary } from '@/lib/providers/currency';
import type { RecurringData } from '@/server/recurring';
import { priceChangeBadge, type RecurringItem } from '@/lib/engine/recurring/summary';

const CADENCE_SUFFIX: Record<Cadence, string> = {
  WEEKLY: '/wk',
  BIWEEKLY: '/2wk',
  MONTHLY: '/mo',
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
          {item.active ? (
            <> · next ~ {formatISODate(isoDate(item.nextExpectedAt))}</>
          ) : (
            <> · last seen {formatISODate(isoDate(item.lastSeenAt))}</>
          )}
        </div>
      </div>
      <div className="shrink-0 text-right tabular-nums">
        <span className="font-medium">{formatCents(cents(mag))}</span>
        <span className="text-xs text-muted-foreground">{CADENCE_SUFFIX[item.cadence]}</span>
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
      <ul className={`mt-2 divide-y ${muted ? 'opacity-70' : ''}`} data-testid={testid}>
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
        {s.priceIncreases.length > 0 && (
          <p className="mt-3 inline-flex items-center gap-1 rounded-full border border-rose-500/40 bg-rose-500/10 px-2.5 py-1 text-xs font-medium text-rose-600 dark:text-rose-400">
            <TrendingUp className="size-3.5" aria-hidden />
            {plural(s.priceIncreases.length, 'price increase')} since these started
          </p>
        )}
      </section>

      {!hasAny ? (
        <p className="rounded-2xl border border-dashed bg-card p-8 text-center text-sm text-muted-foreground shadow-sm">
          No recurring charges detected yet. Subscriptions and bills appear here once they&apos;ve
          billed a couple of times.
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
