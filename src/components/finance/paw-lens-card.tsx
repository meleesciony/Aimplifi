'use client';

/**
 * Expected-net-worth lens (DECISIONS #518). Client age slider recomputes
 * the same pure engine — no ad-hoc math in JSX. After the accounts list
 * or dashboard net-worth card, never between a hit-tested pair.
 */
import { useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { COACH_COPY } from '@/lib/engine/fi/coach-copy';
import {
  PAW_AGE_MAX,
  annualIncomeFromMonthly,
  pawLens,
} from '@/lib/engine/networth/paw-lens';

export function PawLensCard({
  netWorthCents,
  monthlyIncomeCents,
  incomeWindowMonths,
}: {
  netWorthCents: number;
  monthlyIncomeCents: number;
  incomeWindowMonths: number;
}) {
  const [ageYears, setAgeYears] = useState(0);
  const annualIncomeCents = annualIncomeFromMonthly(monthlyIncomeCents);
  const result = useMemo(
    () =>
      pawLens({
        ageYears,
        annualIncomeCents,
        netWorthCents,
        incomeWindowMonths,
      }),
    [ageYears, annualIncomeCents, netWorthCents, incomeWindowMonths],
  );

  const sentence = result.noIncome
    ? COACH_COPY.pawLensEmpty(incomeWindowMonths)
    : ageYears > 0
      ? COACH_COPY.pawLens(result)
      : COACH_COPY.pawLensIdle(result);

  return (
    <Card data-testid="paw-lens-card">
      <CardHeader className="pb-2">
        <CardDescription>{COACH_COPY.pawLensTitle()}</CardDescription>
        <CardTitle className="text-base" data-testid="paw-lens-heading">
          {COACH_COPY.pawLensSubtitle()}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {result.noIncome && (
          <p className="text-muted-foreground" data-testid="paw-lens-empty">
            {sentence}
          </p>
        )}
        {!result.noIncome && (
          <>
            <p
              className="text-muted-foreground"
              data-testid={ageYears > 0 ? 'paw-lens-sentence' : 'paw-lens-idle'}
            >
              {sentence}
            </p>
            <div className="space-y-1">
              <label htmlFor="paw-lens-age-slider" className="flex justify-between text-sm">
                <span>Age</span>
                <span className="font-semibold tabular-nums" data-testid="paw-lens-age">
                  {ageYears === 0 ? 'Not set' : `${ageYears}`}
                </span>
              </label>
              <input
                id="paw-lens-age-slider"
                type="range"
                min={0}
                max={PAW_AGE_MAX}
                step={1}
                value={ageYears}
                aria-valuetext={ageYears === 0 ? 'Not set' : `${ageYears} years`}
                onChange={(e) => setAgeYears(Number(e.target.value))}
                className="w-full"
                data-testid="paw-lens-slider"
              />
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
