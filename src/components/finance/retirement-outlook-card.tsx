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
import { buildRetirementInputs, projectRetirement } from '@/lib/engine/investments/retirement';
import {
  type WhatIfPlan,
  endRange,
  retireRange,
  setEnd,
  setInflationPercent,
  setRetirement,
} from '@/lib/engine/investments/retirement-whatif';
import type { RetirementOutlook } from '@/server/investments';

const GAIN_UP = 'text-emerald-600 dark:text-emerald-400';
const AMBER = 'text-amber-700 dark:text-amber-400'; // darker amber clears AA contrast for small text
const ACCUM_BAR = '#10b981'; // emerald — saving years
const DRAW_BAR = '#3b82f6'; //  blue — retirement draw-down years

const money = (n: number): string => formatCents(cents(Math.round(n)));
const pctFromBps = (bps: number): string => {
  const v = bps / 100;
  return `${Number.isInteger(v) ? v : v.toFixed(2)}%`;
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
  // When the nominal return is at/below inflation, say "no real growth assumed" rather than
  // show a subtraction that implies a negative rate (the engine floors the real return at 0).
  // W.13 — whose expected return this is. `User.expectedReturnBps` is non-nullable with the
  // app's own 700 as its default and the /settings field is required, so calling it "your
  // expected return" claimed a decision from every reader who has never opened that page. Same
  // clause, same rate, one honest possessive; the inflation half carries no possessive here
  // because the reader is editing it in this very card.
  const ret = inputs.returnIsDefault
    ? `our default ${pctFromBps(base.nominalReturnBps)} expected return`
    : `your ${pctFromBps(base.nominalReturnBps)} expected return`;
  const returnClause =
    base.nominalReturnBps <= plan.inflationBps
      ? `${ret} (at or below ~${pctFromBps(plan.inflationBps)} inflation, so no real growth is assumed)`
      : `${ret} less ~${pctFromBps(plan.inflationBps)} inflation`;

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
        <p className="text-sm" data-testid="retirement-outcome">
          Projected balance at age {plan.retirementAge}:{' '}
          <span className="font-medium tabular-nums" data-testid="retirement-balance-at-retirement">
            {money(p.balanceAtRetirementCents)}
          </span>
          .{' '}
          {sustained
            ? `On these assumptions your savings last through age ${plan.endAge}.`
            : `On these assumptions your savings would run low around age ${depletion}.`}
        </p>

        {/* Balance over time: saving years (green) then draw-down years (blue). */}
        <div
          className="flex h-16 items-end gap-px"
          role="img"
          aria-label={`Projected portfolio balance from age ${currentAge} to ${plan.endAge}, peaking near ${money(peak)}.`}
        >
          {p.yearlyBalances.map((y) => (
            <div
              key={y.age}
              className="flex-1 rounded-sm"
              style={{
                height: `${Math.max(2, (y.balanceCents / peak) * 100)}%`,
                background: y.age < plan.retirementAge ? ACCUM_BAR : DRAW_BAR,
              }}
              aria-hidden
            />
          ))}
        </div>

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

        <p className="text-xs text-muted-foreground">
          Assumes you&rsquo;re {currentAge} today, retiring at {plan.retirementAge} and planning through{' '}
          {plan.endAge}; saving {money(base.monthlyContributionCents)}/mo until then; {returnClause}; and
          today&rsquo;s {money(base.annualRetirementSpendingCents)}/yr of spending — all in
          today&rsquo;s dollars.
        </p>
      </CardContent>
    </Card>
  );
}
