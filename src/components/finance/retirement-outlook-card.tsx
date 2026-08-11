'use client';

/**
 * Retirement outlook + interactive what-if (DECISIONS #122, #123). The server grounds
 * the FINANCIAL facts (portfolio, savings, spending, return, SWR — from /coach) and the
 * user's saved planning assumptions; this client island lets the user explore different
 * ages / inflation and recomputes the SAME pure `projectRetirement` engine live. Only the
 * planning ASSUMPTIONS vary client-side — never a financial fact — and the recompute runs
 * through the same `buildRetirementInputs` builder the server uses, so the explorer at the
 * saved values is byte-identical to the server projection (it cannot drift or fabricate).
 *
 * The invariant-maintaining lever logic lives in the pure, unit-tested `retirement-whatif`
 * module (clamp + coordinated bumping), so this component stays a thin display. Saving a
 * new default happens in Settings (where every other dial persists); the what-if here is
 * exploratory and never writes — so it can't perturb the shared demo/golden data.
 */
import { useState } from 'react';
import Link from 'next/link';
import { CalendarClock, RotateCcw } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cents, formatCents } from '@/lib/money';
import {
  buildRetirementInputs,
  projectRetirement,
  retirementAssumptionsSentence,
  retirementCurrentPortfolioRefusal,
  retirementYearRefusal,
} from '@/lib/engine/investments/retirement';
import {
  type WhatIfPlan,
  endRange,
  retireRange,
  setEnd,
  setInflationPercent,
  setRetirement,
} from '@/lib/engine/investments/retirement-whatif';
import { BreakdownPanel } from '@/components/finance/breakdown-panel';
import type { RetirementOutlook } from '@/server/investments';
import { CHART_POSITIVE, CHART_COMPARE } from '@/lib/ui/chart-colors';

const GAIN_UP = 'text-emerald-600 dark:text-emerald-400';
const AMBER = 'text-amber-700 dark:text-amber-400'; // darker amber clears AA contrast for small text
const ACCUM_BAR = CHART_POSITIVE; // emerald — saving years
const DRAW_BAR = CHART_COMPARE; //  blue — retirement draw-down years

const money = (n: number): string => formatCents(cents(Math.round(n)));
/** The card's own basis-percent renderer, kept for the SWR sentence (the engine
 *  composer covers the RETIREMENT assumptions; the withdrawal rate sentence is
 *  not part of that composer). Matches pctFromBps's byte-identical output. */
const pctFromBps = (bps: number): string => {
  const v = bps / 100;
  return Number.isInteger(v) ? `${v}` : v.toFixed(2);
};

const inputClass =
  'h-8 w-full rounded-md border border-input bg-background px-2 text-sm tabular-nums text-foreground';

export function RetirementOutlookCard({ outlook }: { outlook: RetirementOutlook }) {
  const { inputs } = outlook;
  // Fixed financial facts (server-grounded). The what-if varies only the planning levers.
  const base = {
    currentPortfolioCents: inputs.currentPortfolioCents,
    monthlyContributionCents: inputs.monthlyContributionCents,
    annualRetirementSpendingCents: inputs.annualRetirementSpendingCents,
    nominalReturnBps: inputs.nominalReturnBps,
    swrBps: inputs.swrBps,
  };
  const currentAge = inputs.currentAge; // set in Settings; the floor for the retirement age
  const saved: WhatIfPlan = {
    retirementAge: inputs.retirementAge,
    endAge: inputs.endAge,
    inflationBps: inputs.inflationBps,
  };

  const [plan, setPlan] = useState<WhatIfPlan>(saved);
  const dirty =
    plan.retirementAge !== saved.retirementAge ||
    plan.endAge !== saved.endAge ||
    plan.inflationBps !== saved.inflationBps;

  // The projection — same builder + engine the server uses, on the live planning levers.
  // The reducers guarantee a valid plan, so this never throws and matches the inputs shown.
  const p = projectRetirement(buildRetirementInputs(base, { currentAge, ...plan }));

  const sustained = p.outcome === 'sustained';
  const depletion = Math.floor(p.depletionAge ?? plan.endAge);
  const headline = sustained
    ? `Projected to last through age ${plan.endAge}`
    : `Funds run low around age ${depletion}`;
  const overSustainable = base.annualRetirementSpendingCents > p.sustainableAnnualWithdrawalCents;
  const peak = Math.max(...p.yearlyBalances.map((y) => y.balanceCents), 1);

  // The one assumption sentence behind the whole projection — composed in the
  // ENGINE (O.20d) so this footnote and every bar's refusal panel state the
  // same sentence; two surfaces asserting different assumptions would be a
  // drift no test could see. The W.13 possessive and the no-real-growth clause
  // are inside the composer, with the card's original wording byte-identical.
  const assumptionInput = {
    currentAge,
    retirementAge: plan.retirementAge,
    endAge: plan.endAge,
    monthlyContributionCents: cents(base.monthlyContributionCents),
    nominalReturnBps: base.nominalReturnBps,
    inflationBps: plan.inflationBps,
    returnIsDefault: inputs.returnIsDefault,
    annualRetirementSpendingCents: cents(base.annualRetirementSpendingCents),
  } satisfies Parameters<typeof retirementAssumptionsSentence>[0];

  // O.20d: the year bars are real controls; the panel behind one is a REFUSAL
  // — a projection has no rows, and the panel says so instead of inventing any.
  const [selectedAge, setSelectedAge] = useState<number | null>(null);
  const selectedYear = selectedAge !== null ? p.yearlyBalances.find((y) => y.age === selectedAge) ?? null : null;

  const rRange = retireRange(currentAge);
  const eRange = endRange(plan.retirementAge);

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
        {outlook.frozenPortfolioNote && (
          <p className="text-xs text-muted-foreground" data-testid="retirement-frozen-note">
            {outlook.frozenPortfolioNote}
          </p>
        )}
        <p className="text-sm" data-testid="retirement-outcome">
          {/* Re-review F5: retiring AT your current age is reachable in one
              keystroke (`retireRange(currentAge).min === currentAge`) and in
              saved settings, and then `accumMonths === 0`, so this figure IS
              the starting portfolio. Calling it "projected" is the same defect
              P1-1 fixed on the bar, left standing on the louder surface — and
              the bar's own panel two rows down says "not a projection". */}
          {plan.retirementAge === currentAge
            ? 'Your portfolio today: '
            : `Projected balance at age ${plan.retirementAge}: `}
          <span className="font-medium tabular-nums" data-testid="retirement-balance-at-retirement">
            {money(p.balanceAtRetirementCents)}
          </span>
          .{' '}
          {sustained
            ? `On these assumptions your savings last through age ${plan.endAge}.`
            : `On these assumptions your savings would run low around age ${depletion}.`}
        </p>

        {/* Balance over time: saving years (green) then draw-down years (blue).
            Every bar is a control (O.20d): it opens the refusal panel that says
            what a projection bar is made of — nothing transactional. */}
        <div
          className="flex h-16 items-end gap-px"
          role="group"
          aria-label={`Projected portfolio balance from age ${currentAge} to ${plan.endAge}, starting at your current portfolio, peaking near ${money(peak)} — select a year to see what its bar is made of.`}
        >
          {p.yearlyBalances.map((y) => {
            const isOpen = selectedAge === y.age;
            // The FIRST bar (age === currentAge) is the live portfolio, not a
            // projection — its label and its panel must not claim otherwise
            // (critic P1-1: "$142,000.00 at age 40 is a projection" is exactly
            // wrong for the bar the holdings actually make up).
            const isCurrent = y.age === currentAge;
            const offered = isCurrent
              ? 'It is your current portfolio — see what the projection assumes'
              : 'It is a projection — see what it assumes';
            return (
              <button
                key={y.age}
                type="button"
                data-testid={`retirement-bar-${y.age}`}
                data-open={isOpen ? 'true' : 'false'}
                aria-label={`Age ${y.age}: ${isCurrent ? 'current' : 'projected'} balance ${money(y.balanceCents)}. ${isOpen ? 'Hide' : offered}`}
                aria-expanded={isOpen}
                onClick={() => setSelectedAge(isOpen ? null : y.age)}
                className="flex w-full cursor-pointer items-end focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                style={{ height: '64px' }}
              >
                <span
                  className={`block w-full rounded-sm ${isOpen ? '' : 'opacity-80'}`}
                  style={{
                    height: `${Math.max(2, (y.balanceCents / peak) * 100)}%`,
                    background: y.age < plan.retirementAge ? ACCUM_BAR : DRAW_BAR,
                  }}
                  aria-hidden
                />
              </button>
            );
          })}
        </div>

        {selectedYear &&
          (() => {
            const isCurrent = selectedYear.age === currentAge;
            const refusal = isCurrent
              ? retirementCurrentPortfolioRefusal(cents(selectedYear.balanceCents), assumptionInput, {
                  // The UNCLAMPED sum, so a floored $0.00 is never described as
                  // the balance of the reader's accounts (re-review F2), and the
                  // frozen-feed flag the card already renders above, so this
                  // panel cannot say "today" while the note above says the feed
                  // stopped (re-review F1).
                  rawSumCents: inputs.rawPortfolioCents,
                  hasFrozenFeed: outlook.frozenPortfolioNote != null,
                })
              : retirementYearRefusal(selectedYear.age, cents(selectedYear.balanceCents), assumptionInput);
            return (
              <BreakdownPanel
                // Remount on selection so `defaultOpen` re-applies: tapping the
                // bar IS the open gesture.
                key={selectedYear.age}
                subject={{
                  id: `${selectedYear.age}`,
                  name: isCurrent ? `Current portfolio at age ${selectedYear.age}` : `Projection at age ${selectedYear.age}`,
                  headlineCents: cents(selectedYear.balanceCents),
                  rows: [],
                  sumCents: cents(0),
                  reconciles: false,
                  clampedByNetRefund: false,
                }}
                emptyToggleLabel={
                  isCurrent
                    ? "It’s your current portfolio — see what the projection assumes"
                    : "It’s a projection — see what it assumes"
                }
                emptyCopy={refusal.emptyCopy}
                netRefundCopy=""
                basis={refusal.basis}
                // Re-review F4: without this the panel region is announced
                // "Transactions in Projection at age 65" over copy saying there
                // are none — the same lie `rowNoun` was added in this slice to
                // stop, on the one O.20d caller that skipped it. A retirement
                // bar's constituents would be holdings, never transactions.
                rowNoun="holding"
                testIdPrefix="retirement-bar"
                defaultOpen
                onToggle={(o) => {
                  if (!o) setSelectedAge(null); // inner Hide clears the bar (critic P2-1)
                }}
              />
            );
          })()}

        <p className={`text-xs ${overSustainable ? AMBER : GAIN_UP}`}>
          {overSustainable
            ? `Your current spending (${money(base.annualRetirementSpendingCents)}/yr) is above a sustainable ${pctFromBps(base.swrBps)} withdrawal (about ${money(p.sustainableAnnualWithdrawalCents)}/yr) — that is why the balance draws down.`
            : `Your current spending (${money(base.annualRetirementSpendingCents)}/yr) is within a sustainable ${pctFromBps(base.swrBps)} withdrawal (about ${money(p.sustainableAnnualWithdrawalCents)}/yr).`}
        </p>

        {/* Interactive what-if — explore different ages / inflation; recomputes instantly. */}
        <div className="space-y-2 rounded-md border border-input p-3" data-testid="retirement-whatif">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Try a different plan
            </span>
            {dirty ? (
              <button
                type="button"
                onClick={() => setPlan(saved)}
                data-testid="retirement-whatif-reset"
                className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
              >
                <RotateCcw className="size-3" aria-hidden /> Reset
              </button>
            ) : null}
          </div>
          <div className="grid grid-cols-3 gap-2">
            <label className="space-y-1 text-xs">
              <span className="text-muted-foreground">Retire at</span>
              <input
                type="number"
                inputMode="numeric"
                min={rRange.min}
                max={rRange.max}
                value={plan.retirementAge}
                onChange={(e) => setPlan((q) => setRetirement(q, currentAge, Number(e.target.value)))}
                data-testid="whatif-retirement-age"
                aria-label="Retirement age"
                className={inputClass}
              />
            </label>
            <label className="space-y-1 text-xs">
              <span className="text-muted-foreground">Plan to</span>
              <input
                type="number"
                inputMode="numeric"
                min={eRange.min}
                max={eRange.max}
                value={plan.endAge}
                onChange={(e) => setPlan((q) => setEnd(q, Number(e.target.value)))}
                data-testid="whatif-end-age"
                aria-label="Plan-through age"
                className={inputClass}
              />
            </label>
            <label className="space-y-1 text-xs">
              <span className="text-muted-foreground">Inflation %</span>
              <input
                type="number"
                inputMode="decimal"
                min={0}
                max={10}
                step={0.5}
                value={plan.inflationBps / 100}
                onChange={(e) => setPlan((q) => setInflationPercent(q, e.target.value))}
                data-testid="whatif-inflation"
                aria-label="Annual inflation percent"
                className={inputClass}
              />
            </label>
          </div>
          <p className="text-xs text-muted-foreground" data-testid="retirement-whatif-note">
            {dirty ? (
              <>
                Previewing a what-if — your saved plan is unchanged.{' '}
                <Link href="/settings" className="underline hover:text-foreground">
                  Make it your default
                </Link>
                .
              </>
            ) : (
              <>
                Adjust the ages or inflation to preview instantly. Save a new default in{' '}
                <Link href="/settings" className="underline hover:text-foreground">
                  Settings
                </Link>
                .
              </>
            )}
          </p>
        </div>

        <p className="text-xs text-muted-foreground" data-testid="retirement-assumptions">
          {retirementAssumptionsSentence(assumptionInput)}
        </p>
      </CardContent>
    </Card>
  );
}
