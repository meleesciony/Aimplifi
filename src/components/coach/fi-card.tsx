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
import { COACH_COPY } from '@/lib/engine/fi/coach-copy';
import { monthsToFI } from '@/lib/engine/fi/fi';
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
  coastIsCoast,
  coastRequiredMonthlyCents,
  coastTargetYears,
  latestMonthRateBps,
  latestMonthLabel,
}: {
  fiNumberCents: Cents;
  annualExpensesCents: Cents;
  /** Latest FULL month's savings rate (can differ from the 6-mo average the slider uses). */
  latestMonthRateBps?: number | null;
  latestMonthLabel?: string;
  portfolioCents: Cents;
  monthlyIncomeCents: Cents;
  monthlySavingsCents: Cents;
  monthsToFINow: number | null;
  swrBps: number;
  expectedReturnBps: number;
  coastIsCoast: boolean;
  coastRequiredMonthlyCents: Cents | null;
  coastTargetYears: number;
}) {
  const currentRateBps =
    monthlyIncomeCents > 0 ? Math.round((monthlySavingsCents / monthlyIncomeCents) * 10000) : 0;
  const [sliderBps, setSliderBps] = useState(Math.min(7000, Math.max(0, currentRateBps)));

  const sliderMonths = useMemo(() => {
    const savings = cents(Math.round((monthlyIncomeCents * sliderBps) / 10000));
    return monthsToFI(portfolioCents, savings, expectedReturnBps, fiNumberCents);
  }, [sliderBps, monthlyIncomeCents, portfolioCents, expectedReturnBps, fiNumberCents]);

  const yearsOf = (m: number | null) => (m === null ? null : Math.floor(m / 12));

  return (
    <Card data-testid="fi-card">
      <CardHeader className="pb-2">
        <CardDescription>Financial independence</CardDescription>
        <CardTitle className="text-2xl tabular-nums" data-testid="fi-number">
          {formatCents(fiNumberCents)}
        </CardTitle>
        <p className="text-sm text-muted-foreground" data-testid="fi-basis">
          {COACH_COPY.fiNumber(fiNumberCents, swrBps, annualExpensesCents)}
        </p>
        <p className="text-xs text-muted-foreground" data-testid="your-enough">
          {COACH_COPY.yourEnough()}
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm" data-testid="years-to-fi">
          {monthsToFINow !== null
            ? COACH_COPY.yearsToFI(Math.floor(monthsToFINow / 12), monthsToFINow % 12, expectedReturnBps)
            : COACH_COPY.notOnTrack()}
        </p>
        {monthsToFINow !== null && (
          <p className="text-sm text-emerald-600 dark:text-emerald-400" data-testid="freedom-dividend">
            {COACH_COPY.freedomDividend(Math.floor(monthsToFINow / 12))}
          </p>
        )}
        <details className="text-xs text-muted-foreground" data-testid="volatility-note">
          <summary className="cursor-pointer select-none">Why these return assumptions?</summary>
          <p className="mt-1">{COACH_COPY.volatilityPrice(expectedReturnBps)}</p>
        </details>

        <p className="text-sm text-muted-foreground" data-testid="coast-fi">
          {coastIsCoast
            ? COACH_COPY.coastFI(coastTargetYears, expectedReturnBps)
            : coastRequiredMonthlyCents !== null
              ? COACH_COPY.notCoastFI(coastRequiredMonthlyCents, coastTargetYears, expectedReturnBps)
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
            max={7000}
            step={100}
            value={sliderBps}
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
