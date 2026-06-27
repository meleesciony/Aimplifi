/**
 * Investments / portfolio view (DECISIONS #78). Read-only render of getInvestments():
 * total market value + unrealized gain, an allocation bar, and per-account holdings.
 * Every figure comes from the pure investments engine; this is a thin display that
 * matches the app's existing card system. The account balance — not the holdings sum —
 * remains authoritative for net worth (stated inline).
 */
import Link from 'next/link';
import { CalendarClock, PieChart, TrendingDown, TrendingUp, Wallet } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cents, formatCents } from '@/lib/money';
import type { InvestmentsView as InvestmentsData, RetirementOutlook } from '@/server/investments';

const GAIN_UP = 'text-emerald-600 dark:text-emerald-400';
const GAIN_DOWN = 'text-rose-600 dark:text-rose-400';
const ALLOC_COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#a855f7', '#ec4899', '#14b8a6', '#64748b'];
const ACCUM_BAR = '#10b981'; // emerald — saving years
const DRAW_BAR = '#3b82f6'; //  blue — retirement draw-down years

const tone = (n: number) => (n >= 0 ? GAIN_UP : GAIN_DOWN);
const pctLabel = (pct: number | null): string =>
  pct === null ? '' : `${pct >= 0 ? '+' : ''}${(pct * 100).toFixed(1)}%`;
const money = (n: number, signed = false) =>
  formatCents(cents(Math.round(n)), signed ? { signDisplay: 'always' } : undefined);
const pctFromBps = (bps: number): string => {
  const v = bps / 100;
  return `${Number.isInteger(v) ? v : v.toFixed(2)}%`;
};

const AMBER = 'text-amber-700 dark:text-amber-400'; // darker amber clears AA contrast for small text

function RetirementOutlookCard({ outlook }: { outlook: RetirementOutlook }) {
  const { projection: p, inputs } = outlook;
  const sustained = p.outcome === 'sustained';
  const headline = sustained
    ? `Projected to last through age ${inputs.endAge}`
    : `Funds run low around age ${Math.floor(p.depletionAge ?? inputs.endAge)}`;
  const overSustainable = inputs.annualRetirementSpendingCents > p.sustainableAnnualWithdrawalCents;
  const peak = Math.max(...p.yearlyBalances.map((y) => y.balanceCents), 1);
  // The engine floors the real return at 0; when the nominal return is at/below inflation,
  // say "no real growth assumed" rather than show a subtraction that implies a negative rate.
  const returnClause =
    inputs.nominalReturnBps <= inputs.inflationBps
      ? `your ${pctFromBps(inputs.nominalReturnBps)} expected return (below ~${pctFromBps(inputs.inflationBps)} inflation, so no real growth is assumed)`
      : `your ${pctFromBps(inputs.nominalReturnBps)} expected return less ~${pctFromBps(inputs.inflationBps)} inflation`;

  return (
    <Card data-testid="retirement-outlook">
      <CardHeader className="pb-2">
        <CardDescription className="flex items-center gap-1.5">
          <CalendarClock className="size-3.5" aria-hidden /> Retirement outlook
        </CardDescription>
        <CardTitle className={`text-xl ${sustained ? GAIN_UP : AMBER}`} data-testid="retirement-headline">
          {headline}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm" data-testid="retirement-outcome">
          Projected balance at age {inputs.retirementAge}:{' '}
          <span className="font-medium tabular-nums" data-testid="retirement-balance-at-retirement">
            {money(p.balanceAtRetirementCents)}
          </span>
          .{' '}
          {sustained
            ? `On these assumptions your savings last through age ${inputs.endAge}.`
            : `On these assumptions your savings would run low around age ${Math.floor(p.depletionAge ?? inputs.endAge)}.`}
        </p>

        {/* Balance over time: saving years (green) then draw-down years (blue). */}
        <div
          className="flex h-16 items-end gap-px"
          role="img"
          aria-label={`Projected portfolio balance from age ${inputs.currentAge} to ${inputs.endAge}, peaking near ${money(peak)}.`}
        >
          {p.yearlyBalances.map((y) => (
            <div
              key={y.age}
              className="flex-1 rounded-sm"
              style={{
                height: `${Math.max(2, (y.balanceCents / peak) * 100)}%`,
                background: y.age < inputs.retirementAge ? ACCUM_BAR : DRAW_BAR,
              }}
              aria-hidden
            />
          ))}
        </div>

        <p className={`text-xs ${overSustainable ? AMBER : GAIN_UP}`}>
          {overSustainable
            ? `Your planned spending (${money(inputs.annualRetirementSpendingCents)}/yr) is above a sustainable ${pctFromBps(inputs.swrBps)} withdrawal (about ${money(p.sustainableAnnualWithdrawalCents)}/yr) — that is why the balance draws down.`
            : `Your planned spending (${money(inputs.annualRetirementSpendingCents)}/yr) is within a sustainable ${pctFromBps(inputs.swrBps)} withdrawal (about ${money(p.sustainableAnnualWithdrawalCents)}/yr).`}
        </p>

        <p className="text-xs text-muted-foreground">
          Assumes you&rsquo;re {inputs.currentAge} today, retiring at {inputs.retirementAge} and planning through{' '}
          {inputs.endAge}; saving {money(inputs.monthlyContributionCents)}/mo until then; {returnClause}; and
          today&rsquo;s {money(inputs.annualRetirementSpendingCents)}/yr of spending — all in today&rsquo;s dollars.
          Adjust your return, withdrawal rate, and spending in Settings and your data.
        </p>
      </CardContent>
    </Card>
  );
}

export function InvestmentsView({ data, outlook }: { data: InvestmentsData; outlook: RetirementOutlook }) {
  const { overall, accounts } = data;
  const hasHoldings = overall.positions.length > 0;

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-baseline justify-between">
        <h1 className="text-lg font-semibold">Investments</h1>
        <Link href="/accounts" className="text-xs text-muted-foreground hover:text-foreground hover:underline">
          Accounts →
        </Link>
      </div>

      {outlook.hasData ? <RetirementOutlookCard outlook={outlook} /> : null}

      {!hasHoldings ? (
        <Card data-testid="investments-empty">
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No investment holdings yet. Add holdings to an investment account to see market value, gain,
            and allocation here.
          </CardContent>
        </Card>
      ) : (
        <>
          <Card data-testid="investments-summary">
            <CardHeader className="pb-2">
              <CardDescription>Portfolio value</CardDescription>
              <CardTitle className="text-2xl tabular-nums sm:text-3xl" data-testid="investments-total-value">
                {money(overall.totalMarketValueCents)}
              </CardTitle>
              <p className={`text-xs ${tone(overall.totalUnrealizedGainCents)}`} data-testid="investments-total-gain">
                {money(overall.totalUnrealizedGainCents, true)}
                {overall.totalGainPct !== null ? ` (${pctLabel(overall.totalGainPct)})` : ''} total return
              </p>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="text-xs text-muted-foreground">Cost basis {money(overall.totalCostBasisCents)}</div>
              <div>
                <div className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <PieChart className="size-3.5" aria-hidden /> Allocation
                </div>
                <div className="mt-1.5 flex h-2.5 w-full overflow-hidden rounded-full bg-muted" data-testid="investments-allocation">
                  {overall.positions.map((p, i) => (
                    <div
                      key={p.symbol}
                      style={{ width: `${Math.max(0, p.weight * 100)}%`, background: ALLOC_COLORS[i % ALLOC_COLORS.length] }}
                      aria-hidden
                    />
                  ))}
                </div>
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  {overall.positions.map((p, i) => (
                    <span key={p.symbol} className="inline-flex items-center gap-1">
                      <span className="size-2 rounded-full" style={{ background: ALLOC_COLORS[i % ALLOC_COLORS.length] }} aria-hidden />
                      {p.symbol} {Math.round(p.weight * 100)}%
                    </span>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>

          {accounts
            .filter((a) => a.portfolio.positions.length > 0)
            .map((a) => (
              <Card key={a.accountId} data-testid="investments-account">
                <CardHeader className="flex-row items-center justify-between pb-2">
                  <div className="flex items-center gap-2">
                    <Wallet className="size-4 text-muted-foreground" aria-hidden />
                    <CardTitle className="text-base">{a.accountName}</CardTitle>
                  </div>
                  <span className="tabular-nums text-sm">{money(a.portfolio.totalMarketValueCents)}</span>
                </CardHeader>
                <CardContent className="px-0 pb-2">
                  <ul className="divide-y">
                    {a.portfolio.positions.map((p) => {
                      const Icon = p.unrealizedGainCents >= 0 ? TrendingUp : TrendingDown;
                      return (
                        <li key={p.symbol} className="flex items-center justify-between gap-3 px-4 py-2" data-testid="holding-row">
                          <div className="min-w-0">
                            <div className="flex items-baseline gap-2">
                              <span className="font-medium">{p.symbol}</span>
                              {p.name ? <span className="truncate text-xs text-muted-foreground">{p.name}</span> : null}
                            </div>
                            <div className="text-xs tabular-nums text-muted-foreground">
                              {p.quantity} @ {money(p.priceCents)}
                            </div>
                          </div>
                          <div className="shrink-0 text-right">
                            <div className="tabular-nums">{money(p.marketValueCents)}</div>
                            <div className={`flex items-center justify-end gap-1 text-xs tabular-nums ${tone(p.unrealizedGainCents)}`}>
                              <Icon className="size-3.5" aria-hidden />
                              {money(p.unrealizedGainCents, true)}
                              {p.gainPct !== null ? ` (${pctLabel(p.gainPct)})` : ''}
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </CardContent>
              </Card>
            ))}

          <p className="text-xs text-muted-foreground">
            Market value and gain are computed from your holdings. Your account balance stays the source of
            truth for net worth — holdings are an optional breakdown for performance and allocation.
          </p>
        </>
      )}
    </div>
  );
}
