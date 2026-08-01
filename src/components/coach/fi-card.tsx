'use client';

/**
 * FI engine card with the interactive savings-rate slider — drag it and watch
 * the FI date move. All math is the SAME pure engine the tests pin
 * (monthsToFI imported client-side); nothing is recomputed ad hoc.
 */
import { useMemo, useState } from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { FROZEN_COACH_TESTID } from '@/lib/engine/account/feed-dropped-view';
import { COACH_COPY } from '@/lib/engine/fi/coach-copy';
import { monthsToFI } from '@/lib/engine/fi/fi';
import { fiSliderInitialBps, fiSliderMaxBps } from '@/lib/engine/fi/fi-slider-bounds';
import { type Cents, cents, formatCents } from '@/lib/money';

export function FICard({
  fiNumberCents,
  annualExpensesCents,
  portfolioCents,
  monthlyIncomeCents,
  monthlySavingsCents,
  monthsToFINow,
  swrBps,
  expectedReturnBps,
  projectionReturnBps,
  inflationBps,
  inflationIsDefault,
  realReturnFloored,
  coastIsCoast,
  coastRequiredMonthlyCents,
  coastTargetYears,
  coastTargetYearsIsAppDefault,
  latestMonthRateBps,
  latestMonthLabel,
  currencyNote,
  frozenPortfolioNote,
}: {
  fiNumberCents: Cents;
  annualExpensesCents: Cents;
  /**
   * TASKS L.18 — set when an INVESTMENT account the bank stopped sharing is inside
   * `portfolioCents`. Rendered beside years-to-FI and NOT under the FI number, because the FI
   * number is `annualExpenses ÷ the withdrawal rate` and touches no balance at all: a note there
   * would qualify a figure this account does not feed. The projections below it, the Coast line and
   * the slider all start from the portfolio, so they are what the sentence is about.
   */
  frozenPortfolioNote?: string | null;
  /** Latest FULL month's savings rate (can differ from the 6-mo average the slider uses). */
  latestMonthRateBps?: number | null;
  latestMonthLabel?: string;
  /** Inline currency-exclusion basis note (#135 residual 25) when the user has withheld
   *  non-USD accounts; null/undefined = all-USD → renders nothing (byte-identical). */
  currencyNote?: string | null;
  portfolioCents: Cents;
  monthlyIncomeCents: Cents;
  monthlySavingsCents: Cents;
  monthsToFINow: number | null;
  swrBps: number;
  /** The reader's NOMINAL dial. Named in the basis + volatility copy as one operand; it is
   *  NOT the rate anything on this card compounds at (W.2). */
  expectedReturnBps: number;
  /**
   * W.2 — the real (after-inflation) rate every projection on this card uses, including the
   * slider below. Required and passed in rather than derived here: the server already
   * compounded `monthsToFI`/`coastFI` at it, and a component that re-derives the rate is a
   * second definition of the basis that can drift from the one the printed date came from.
   */
  projectionReturnBps: number;
  inflationBps: number;
  /** True when `inflationBps` fell back to `RETIREMENT_ASSUMPTIONS` because the reader never
   *  set one — so the basis copy may not call it "yours". Required, not optional: a caller
   *  that forgets it would silently claim a setting the reader does not have. */
  inflationIsDefault: boolean;
  /** True when `projectionReturnBps` is the 0 floor rather than the subtraction; selects the
   *  basis branch that may not show its working. */
  realReturnFloored: boolean;
  coastIsCoast: boolean;
  coastRequiredMonthlyCents: Cents | null;
  coastTargetYears: number;
  /** W.9 — whether the app picked `coastTargetYears` rather than the reader. */
  coastTargetYearsIsAppDefault: boolean;
}) {
  const currentRateBps =
    monthlyIncomeCents > 0 ? Math.round((monthlySavingsCents / monthlyIncomeCents) * 10000) : 0;
  // W.11 — max tracks the current pace so the thumb can sit on it. A hard 7000 ceiling
  // clamped an 85% saver to 70% on first paint and fired the "Lowering…" caption before
  // anyone dragged; both bounds come from one helper so they cannot drift apart.
  const sliderMaxBps = fiSliderMaxBps(currentRateBps);
  const [sliderBps, setSliderBps] = useState(fiSliderInitialBps(currentRateBps));

  const sliderMonths = useMemo(() => {
    const savings = cents(Math.round((monthlyIncomeCents * sliderBps) / 10000));
    // W.2 — the REAL rate, the same one the server's `monthsToFI` used for `monthsToFINow`.
    // The slider's whole promise is "same assumptions, different savings rate"; compounding it
    // at the nominal dial would make dragging to the current pace print a different date from
    // the one six inches above it.
    return monthsToFI(portfolioCents, savings, projectionReturnBps, fiNumberCents);
  }, [sliderBps, monthlyIncomeCents, portfolioCents, projectionReturnBps, fiNumberCents]);

  const yearsOf = (m: number | null) => (m === null ? null : Math.floor(m / 12));

  return (
    <Card data-testid="fi-card">
      <CardHeader className="pb-2">
        <CardDescription>Financial independence</CardDescription>
        <CardTitle as="div" className="text-2xl tabular-nums" data-testid="fi-number">
          {formatCents(fiNumberCents)}
        </CardTitle>
        <p className="text-sm text-muted-foreground" data-testid="fi-basis">
          {COACH_COPY.fiNumber(fiNumberCents, swrBps, annualExpensesCents)}
        </p>
        {currencyNote ? (
          <p className="text-xs text-muted-foreground" data-testid="fi-currency-note">
            {currencyNote}
          </p>
        ) : null}
        <p className="text-xs text-muted-foreground" data-testid="your-enough">
          {COACH_COPY.yourEnough()}
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm" data-testid="years-to-fi">
          {/* FOUR states, not two. `monthsToFI` returns null both for "not saving" and for
              "saving, but past the engine's 1200-month cap", and this line used to assert the
              first as fact for both — so a reader saving $500/month at a low real rate was
              told their contributions aren't outpacing spending. W.2 lowered the rate and
              widened that set, which is how both critics found it. The coasting case is
              separated too: "a projection date wouldn't be honest" printed directly above a
              Coast line that hands over a date is one card contradicting itself. */}
          {COACH_COPY.fiHeadline({
            monthsToFI: monthsToFINow,
            monthlySavingsCents,
            coastIsCoast,
            projectionReturnBps,
          })}
        </p>
        {/* W.2 — where the rate above came from, stated once for the whole card rather than
            re-asserted by each projection. Rendered even in the `notOnTrack` branch: the Coast
            line below still prints a date on this basis, and the slider can leave the branch
            without the reader learning anything new about the assumptions. */}
        <p className="text-xs text-muted-foreground" data-testid="fi-projection-basis">
          {COACH_COPY.fiProjectionBasis(
            projectionReturnBps,
            expectedReturnBps,
            inflationBps,
            realReturnFloored,
            inflationIsDefault,
          )}
        </p>
        {frozenPortfolioNote ? (
          <p className="text-xs text-amber-500" data-testid={FROZEN_COACH_TESTID}>
            {frozenPortfolioNote}
          </p>
        ) : null}
        {monthsToFINow !== null && (
          <p className="text-sm text-emerald-600 dark:text-emerald-400" data-testid="freedom-dividend">
            {COACH_COPY.freedomDividend(Math.floor(monthsToFINow / 12), projectionReturnBps)}
          </p>
        )}
        <details className="text-xs text-muted-foreground" data-testid="volatility-note">
          <summary className="flex min-h-11 cursor-pointer select-none items-center">
            Why these return assumptions?
          </summary>
          <p className="mt-1">
            {COACH_COPY.volatilityPrice(expectedReturnBps, projectionReturnBps)}
          </p>
        </details>

        <p className="text-sm text-muted-foreground" data-testid="coast-fi">
          {coastIsCoast
            ? COACH_COPY.coastFI(
                coastTargetYears,
                projectionReturnBps,
                coastTargetYearsIsAppDefault,
              )
            : coastRequiredMonthlyCents !== null
              ? COACH_COPY.notCoastFI(
                  coastRequiredMonthlyCents,
                  coastTargetYears,
                  projectionReturnBps,
                  coastTargetYearsIsAppDefault,
                )
              : null}
        </p>

        <div className="space-y-2 rounded-lg border p-3">
          <label htmlFor="fi-slider" className="flex justify-between text-sm">
            <span>What if I saved…</span>
            <span className="font-semibold tabular-nums" data-testid="slider-rate">
              {(sliderBps / 100).toFixed(0)}%
            </span>
          </label>
          <p className="text-xs text-muted-foreground">
            {COACH_COPY.sliderContext(currentRateBps, latestMonthRateBps ?? null, latestMonthLabel)}
          </p>
          <input
            id="fi-slider"
            type="range"
            min={0}
            max={sliderMaxBps}
            step={100}
            value={sliderBps}
            aria-valuetext={`${(sliderBps / 100).toFixed(0)}% savings rate`}
            onChange={(e) => setSliderBps(Number(e.target.value))}
            className="w-full accent-emerald-500"
            data-testid="fi-slider"
          />
          <p className="text-sm" aria-live="polite" data-testid="slider-result">
            {sliderMonths !== null && yearsOf(sliderMonths) !== null
              ? COACH_COPY.sliderCaption(
                  currentRateBps,
                  sliderBps,
                  yearsOf(monthsToFINow ?? sliderMonths) ?? 0,
                  yearsOf(sliderMonths)!,
                )
              : COACH_COPY.notOnTrack()}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
