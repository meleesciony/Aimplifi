/**
 * Investments / portfolio view (DECISIONS #78). Read-only render of getInvestments():
 * total market value + unrealized gain, an allocation bar, and per-account holdings.
 * Every figure comes from the pure investments engine; this is a thin display that
 * matches the app's existing card system. The account balance — not the holdings sum —
 * remains authoritative for net worth (stated inline). The retirement outlook + what-if
 * explorer is its own client island (retirement-outlook-card.tsx).
 */
import Link from 'next/link';
import { PieChart, TrendingDown, TrendingUp, Wallet } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cents, formatCents } from '@/lib/money';
import { holdingProvenance, isPerShareApproximate } from '@/lib/engine/investments/portfolio';
import { resolveInvestmentScope } from '@/lib/engine/investments/scope';
import { CurrencyExclusionBanner } from '@/components/finance/currency-exclusion-banner';
import { RetirementOutlookCard } from '@/components/finance/retirement-outlook-card';
import type { WithheldAccountSummary } from '@/lib/providers/currency';
import type { InvestmentsView as InvestmentsData, RetirementOutlook } from '@/server/investments';

const GAIN_UP = 'text-emerald-600 dark:text-emerald-400';
const GAIN_DOWN = 'text-rose-600 dark:text-rose-400';
const ALLOC_COLORS = ['#10b981', '#3b82f6', '#f59e0b', '#a855f7', '#ec4899', '#14b8a6', '#64748b'];

const tone = (n: number) => (n >= 0 ? GAIN_UP : GAIN_DOWN);
const pctLabel = (pct: number | null): string =>
  pct === null ? '' : `${pct >= 0 ? '+' : ''}${(pct * 100).toFixed(1)}%`;
const money = (n: number, signed = false) =>
  formatCents(cents(Math.round(n)), signed ? { signDisplay: 'always' } : undefined);

export function InvestmentsView({
  data,
  outlook,
  withheld,
  scopedAccountId,
}: {
  data: InvestmentsData;
  outlook: RetirementOutlook;
  withheld: WithheldAccountSummary;
  /** Optional ?account=<id> deep-link (DECISIONS #160): narrow the per-account holdings
   *  list to one account. Inert with ≤1 account, so the demo renders byte-identically. */
  scopedAccountId?: string;
}) {
  const { overall, accounts } = data;
  const hasHoldings = overall.positions.length > 0;
  // Which per-account cards to show (the portfolio-wide summary card below stays whole-portfolio).
  const scope = resolveInvestmentScope(accounts, scopedAccountId);

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="flex items-baseline justify-between">
        <h1 className="text-lg font-semibold">Investments</h1>
        <Link href="/accounts" className="text-xs text-muted-foreground hover:text-foreground hover:underline">
          Accounts →
        </Link>
      </div>

      {/* Non-USD accounts are withheld from every figure on this page (the #135 guard filters
          them out of getInvestments) — the vanish must not be silent here either (STATUS #23). */}
      <CurrencyExclusionBanner summary={withheld} />

      {outlook.hasData ? <RetirementOutlookCard outlook={outlook} /> : null}

      {!hasHoldings ? (
        <Card data-testid="investments-empty">
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            {withheld.count > 0
              ? // "No investment holdings yet" would be false for a user whose only holdings sit in a
                // withheld non-USD account (the /accounts empty-state contradiction, same fix shape).
                // Zero-withheld users get the original copy byte-identical.
                'No U.S.-dollar investment holdings yet. Add holdings to a U.S.-dollar investment account to see market value, gain, and allocation here.'
              : 'No investment holdings yet. Add holdings to an investment account to see market value, gain, and allocation here.'}
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

          {/* When a ?account deep-link narrows the list to one account (#160), say so and
              offer a one-tap way back to the whole portfolio. Never shown with ≤1 account. */}
          {scope.showAllAccounts ? (
            <div
              className="flex items-center justify-between gap-2 text-xs text-muted-foreground"
              data-testid="investments-scope"
            >
              <span>
                Showing <span className="font-medium text-foreground">{scope.scopedName}</span> holdings
              </span>
              <Link href="/investments" className="hover:text-foreground hover:underline">
                Show all accounts →
              </Link>
            </div>
          ) : null}

          {scope.accounts
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
                      // Provenance badge (DECISIONS #180): only synced feed positions carry one;
                      // manual holdings (the whole demo) render no badge → demo byte-identical.
                      const prov = holdingProvenance(p.source);
                      return (
                        <li key={p.symbol} className="flex items-center justify-between gap-3 px-4 py-2" data-testid="holding-row">
                          <div className="min-w-0">
                            <div className="flex items-baseline gap-2">
                              <span className="font-medium">{p.symbol}</span>
                              {prov ? (
                                <Badge variant="outline" className="shrink-0 text-[10px]" title={prov.title} data-testid="holding-provenance">
                                  {prov.label}
                                </Badge>
                              ) : null}
                              {p.name ? <span className="truncate text-xs text-muted-foreground">{p.name}</span> : null}
                            </div>
                            <div className="text-xs tabular-nums text-muted-foreground">
                              {/* "≈" when the per-share price can't reconstruct the authoritative
                                  total (a sub-cent / fractional lot), so the row never looks
                                  self-contradictory next to its exact total (DECISIONS #129). */}
                              {p.quantity} @ {isPerShareApproximate(p) ? '≈' : ''}{money(p.priceCents)}
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
