/**
 * Spending Trends view (DECISIONS #74). Surfaces what changed and what to look
 * at: an in-progress pace projection, completed-month category movers, the
 * biggest purchases, and new merchants. Every number comes from the pure
 * engine; this is a thin render. Copy follows the coaching guardrails
 * (educational, no shame, assumptions stated inline).
 */
import Link from 'next/link';
import { ArrowDownRight, ArrowUpRight, Gauge, Receipt, Sparkles, Store } from 'lucide-react';
import { formatISODate, formatMonth, isoDate } from '@/lib/dates';
import { cents, formatCents } from '@/lib/money';
import { COACH_COPY } from '@/lib/engine/fi/coach-copy';
import type { CategoryMover, SpendingTrends } from '@/lib/engine/trends/trends';

const money = (n: number, signed = false) =>
  formatCents(cents(n), signed ? { signDisplay: 'always' } : undefined);
const pct = (p: number) => `${p > 0 ? '+' : ''}${Math.round(p * 100)}%`;
const shortMonth = (ym: string) => formatMonth(ym, 'short');

function baselineLabel(months: string[]): string {
  if (months.length === 0) return 'earlier months';
  if (months.length === 1) return shortMonth(months[0]);
  // months are most-recent-first; read them oldest→newest for the range label
  const oldest = shortMonth(months[months.length - 1]);
  const newest = shortMonth(months[0]);
  return `${oldest}–${newest}`;
}

function MoverRow({ m, isDial = false }: { m: CategoryMover; isDial?: boolean }) {
  const tone =
    m.direction === 'down'
      ? 'text-emerald-600 dark:text-emerald-400'
      : m.direction === 'new'
        ? 'text-sky-600 dark:text-sky-400'
        : 'text-rose-600 dark:text-rose-400';
  const Icon = m.direction === 'down' ? ArrowDownRight : m.direction === 'new' ? Sparkles : ArrowUpRight;
  return (
    <li className="flex items-center justify-between gap-3 py-2">
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm font-medium">{m.name}</span>
          {isDial && <Gauge className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />}
        </div>
        <div className="truncate text-xs text-muted-foreground">
          {m.direction === 'new'
            ? `new this period · ${money(m.currentCents)}`
            : `${money(m.currentCents)} vs ${money(m.baselineCents)} usual`}
        </div>
        {isDial && (
          <div className="text-xs text-emerald-600 dark:text-emerald-400" data-testid="dial-tag">
            {COACH_COPY.dialTag(m.name)}
          </div>
        )}
      </div>
      <div className={`flex shrink-0 items-center gap-1 text-sm font-medium tabular-nums ${tone}`}>
        <Icon className="size-4" aria-hidden />
        <span>
          {m.direction === 'new' ? 'New' : money(m.deltaCents, true)}
          {m.pctChange !== null && m.direction !== 'new' ? (
            <span className="ml-1 text-xs font-normal">({pct(m.pctChange)})</span>
          ) : null}
        </span>
      </div>
    </li>
  );
}

export function TrendsView({ trends, dials = [] }: { trends: SpendingTrends; dials?: string[] }) {
  const { pace, movers, largest, newMerchants, comparedYm, baselineMonths } = trends;
  const paceUp = pace ? pace.deltaVsPriorCents > 0 : false;
  // money dials are user-configured category labels; tag a mover when its category is one
  const dialSet = new Set(dials.map((d) => d.toLowerCase()));

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-baseline justify-between">
        <h1 className="text-lg font-semibold">Spending trends</h1>
        <Link href="/reports" className="text-xs text-muted-foreground hover:text-foreground hover:underline">
          See full reports →
        </Link>
      </div>

      {/* Pace — the in-progress month projected forward */}
      {pace && (
        <section
          className="rounded-2xl border bg-card p-5 shadow-sm"
          data-testid="trends-pace"
          aria-label="Spending pace this month"
        >
          <h2 className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <Gauge className="size-3.5" aria-hidden /> Pace · {shortMonth(pace.ym)}
          </h2>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-3xl font-semibold tabular-nums">{money(pace.projectedCents)}</span>
            <span className="text-sm text-muted-foreground">projected by month end</span>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {money(pace.spentSoFarCents)} spent in the first {pace.daysElapsed} day
            {pace.daysElapsed === 1 ? '' : 's'} ·{' '}
            <span className={paceUp ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}>
              {money(Math.abs(pace.deltaVsPriorCents))} {paceUp ? 'more' : 'less'}
            </span>{' '}
            than last month ({money(pace.priorMonthCents)})
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            Assumes spending continues at the current daily rate — a projection, not a prediction.
          </p>
        </section>
      )}

      {/* Category movers — last completed month vs a 3-month baseline */}
      <section className="rounded-2xl border bg-card p-5 shadow-sm" data-testid="trends-movers">
        <div className="mb-1 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold">What changed</h2>
          {comparedYm && (
            <span className="text-xs text-muted-foreground">
              {shortMonth(comparedYm)} vs {baselineLabel(baselineMonths)} average
            </span>
          )}
        </div>
        {movers.length === 0 ? (
          <p className="py-5 text-center text-sm text-muted-foreground">
            {comparedYm
              ? 'No notable category changes — your spending held steady.'
              : 'Not enough history yet to compare months.'}
          </p>
        ) : (
          <ul className="divide-y">
            {movers.map((m) => (
              <MoverRow key={m.categoryId} m={m} isDial={dialSet.has(m.name.toLowerCase())} />
            ))}
          </ul>
        )}
      </section>

      {/* Largest purchases this month */}
      <section className="rounded-2xl border bg-card p-5 shadow-sm" data-testid="trends-largest">
        <div className="mb-1 flex items-center gap-2">
          <Receipt className="size-3.5 text-muted-foreground" aria-hidden />
          <h2 className="text-sm font-semibold">Biggest purchases this month</h2>
        </div>
        {largest.length === 0 ? (
          <p className="py-5 text-center text-sm text-muted-foreground">No purchases yet this month.</p>
        ) : (
          <ul className="divide-y">
            {largest.map((l, i) => (
              <li key={`${l.date}-${l.merchant}-${i}`} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{l.merchant}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {l.categoryName} · {formatISODate(isoDate(l.date), 'short')}
                  </div>
                </div>
                <span className="shrink-0 text-sm font-medium tabular-nums">{money(l.amountCents)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* New merchants */}
      {newMerchants.length > 0 && (
        <section className="rounded-2xl border bg-card p-5 shadow-sm" data-testid="trends-new-merchants">
          <div className="mb-1 flex items-center gap-2">
            <Store className="size-3.5 text-muted-foreground" aria-hidden />
            <h2 className="text-sm font-semibold">New this month</h2>
          </div>
          <ul className="divide-y">
            {newMerchants.map((n) => (
              <li key={n.merchant} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{n.merchant}</div>
                  <div className="truncate text-xs text-muted-foreground">{n.categoryName}</div>
                </div>
                <span className="shrink-0 text-sm font-medium tabular-nums">{money(n.amountCents)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
