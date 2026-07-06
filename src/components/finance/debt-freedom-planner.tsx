'use client';

/**
 * Debt Freedom planner (Wave 3, DECISIONS #97). Interactive — strategy toggle +
 * extra-$/mo slider — recomputing the SAME pure engine client-side (like FICard
 * with monthsToFI), so nothing is recomputed ad hoc. Conflict A: avalanche is
 * the default (least interest); snowball is one tap away and both outcomes are
 * shown side by side so the user chooses momentum vs math with eyes open. All
 * prose comes from COACH_COPY (guardrail-scanned); no money math in the JSX
 * beyond formatting.
 */
import { useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { COACH_COPY } from '@/lib/engine/fi/coach-copy';
import { planDebtPayoff, type DebtInput, type DebtStrategy } from '@/lib/engine/debt/payoff';
import { addMonthsClamped, formatMonth, isoDate } from '@/lib/dates';
import { cents, formatCents } from '@/lib/money';

const EXTRA_MAX_CENTS = 200_000; // $2,000/mo
const EXTRA_STEP_CENTS = 5_000; // $50

export function DebtFreedomPlanner({ debts, today }: { debts: DebtInput[]; today: string }) {
  const [strategy, setStrategy] = useState<DebtStrategy>('avalanche'); // Conflict A default
  const [extraCents, setExtraCents] = useState(0);

  const active = useMemo(
    () => planDebtPayoff({ debts, strategy, extraMonthlyCents: extraCents }),
    [debts, strategy, extraCents],
  );
  const avalanche = useMemo(
    () => planDebtPayoff({ debts, strategy: 'avalanche', extraMonthlyCents: extraCents }),
    [debts, extraCents],
  );
  const snowball = useMemo(
    () => planDebtPayoff({ debts, strategy: 'snowball', extraMonthlyCents: extraCents }),
    [debts, extraCents],
  );

  const monthLabel = (months: number | null) =>
    months === null ? null : formatMonth(addMonthsClamped(isoDate(today), months).slice(0, 7));

  const heroDate = monthLabel(active.monthsToDebtFree);
  const interestSavedCents = Math.max(0, snowball.totalInterestCents - avalanche.totalInterestCents);
  const showTradeoff = snowball.firstPayoffMonth !== null && interestSavedCents > 0;

  return (
    <Card data-testid="debt-planner">
      <CardHeader className="pb-2">
        <CardDescription>Debt freedom</CardDescription>
        <CardTitle className="text-xl" data-testid="debt-free-hero">
          {heroDate ? `Debt-free by ${heroDate}` : 'Add a little extra to reach debt-free'}
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          {heroDate ? COACH_COPY.debtFreeHero(heroDate) : COACH_COPY.debtNotClearing()}
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Strategy toggle — values choice (Conflict A) */}
        <div>
          <div className="inline-flex rounded-lg border p-0.5" role="group" aria-label="Payoff strategy">
            <Button
              type="button"
              size="sm"
              variant={strategy === 'avalanche' ? 'default' : 'ghost'}
              aria-pressed={strategy === 'avalanche'}
              onClick={() => setStrategy('avalanche')}
              data-testid="strategy-avalanche"
            >
              Least interest
            </Button>
            <Button
              type="button"
              size="sm"
              variant={strategy === 'snowball' ? 'default' : 'ghost'}
              aria-pressed={strategy === 'snowball'}
              onClick={() => setStrategy('snowball')}
              data-testid="strategy-snowball"
            >
              Quick wins
            </Button>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            {strategy === 'avalanche' ? COACH_COPY.debtStrategyAvalanche() : COACH_COPY.debtStrategySnowball()}
          </p>
        </div>

        {/* Extra-per-month slider */}
        <div className="space-y-1">
          <label htmlFor="debt-extra" className="flex justify-between text-sm">
            <span>Extra per month</span>
            <span className="font-semibold tabular-nums" data-testid="debt-extra-amount">
              {formatCents(cents(extraCents))}
            </span>
          </label>
          <input
            id="debt-extra"
            type="range"
            min={0}
            max={EXTRA_MAX_CENTS}
            step={EXTRA_STEP_CENTS}
            value={extraCents}
            aria-valuetext={`${formatCents(cents(extraCents))} per month`}
            onChange={(e) => setExtraCents(Number(e.target.value))}
            className="w-full accent-emerald-500"
            data-testid="debt-extra-slider"
          />
        </div>

        {/* Per-debt payoff order */}
        <ul className="space-y-1 text-sm" data-testid="debt-order">
          {active.perDebt.map((d) => {
            const when = monthLabel(d.payoffMonth);
            return (
              <li key={d.id} className="flex items-baseline justify-between gap-2">
                <span className="min-w-0 truncate font-medium">{d.name}</span>
                {/* Two-line right column: the single-line "cleared by … · $… interest"
                    starved the debt name to ~6 chars at 380px ("Platinu…"). */}
                <span className="shrink-0 text-right tabular-nums text-muted-foreground">
                  <span className="block">{when ? `cleared by ${when}` : 'not on this plan'}</span>
                  <span className="block text-xs">{formatCents(cents(d.interestCents))} interest</span>
                </span>
              </li>
            );
          })}
        </ul>

        <p className="text-sm tabular-nums">
          Total interest on this plan:{' '}
          <span className="font-semibold">{formatCents(cents(active.totalInterestCents))}</span>
        </p>

        {showTradeoff && (
          <p className="text-xs text-muted-foreground" data-testid="debt-tradeoff">
            {COACH_COPY.debtTradeoff(snowball.firstPayoffMonth!, formatCents(cents(interestSavedCents)))}
          </p>
        )}

        <p className="rounded-lg bg-muted/50 p-2 text-xs text-muted-foreground" data-testid="debt-starter-buffer">
          {COACH_COPY.debtStarterBuffer()}
        </p>
      </CardContent>
    </Card>
  );
}
