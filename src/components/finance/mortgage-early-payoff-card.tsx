'use client';

/**
 * Extra-principal what-if on one mortgage (DECISIONS #517).
 * Client slider recomputes the same pure engine — no ad-hoc math in JSX.
 * After the accounts list, never between hit-tested pairs.
 */
import { useMemo, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { COACH_COPY } from '@/lib/engine/fi/coach-copy';
import {
  mortgageEarlyPayoff,
  type MortgageEarlyPayoffPick,
} from '@/lib/engine/debt/mortgage-early-payoff';
import { cents, formatCents } from '@/lib/money';

const EXTRA_MAX_CENTS = 200_000;
const EXTRA_STEP_CENTS = 5_000;

export function MortgageEarlyPayoffCard({ pick }: { pick: MortgageEarlyPayoffPick }) {
  const [extraCents, setExtraCents] = useState(0);
  const result = useMemo(() => {
    if (pick.kind !== 'ready') return null;
    return mortgageEarlyPayoff({
      id: pick.candidate.id,
      name: pick.candidate.name,
      balanceCents: pick.candidate.balanceCents,
      aprBps: pick.candidate.aprBps,
      minimumPaymentCents: pick.candidate.minimumPaymentCents,
      extraMonthlyCents: extraCents,
    });
  }, [pick, extraCents]);

  const sentence =
    result === null
      ? null
      : extraCents > 0
        ? COACH_COPY.mortgageEarlyPayoff(result)
        : COACH_COPY.mortgageEarlyPayoffIdle(result);

  return (
    <Card data-testid="mortgage-early-payoff-card">
      <CardHeader className="pb-2">
        <CardDescription>{COACH_COPY.mortgageEarlyPayoffTitle()}</CardDescription>
        <CardTitle className="text-base" data-testid="mortgage-early-payoff-heading">
          {pick.kind === 'ready' ? pick.candidate.name : COACH_COPY.mortgageEarlyPayoffSubtitle()}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {pick.kind === 'none' && (
          <p className="text-muted-foreground" data-testid="mortgage-early-payoff-empty">
            {COACH_COPY.mortgageEarlyPayoffEmpty()}
          </p>
        )}
        {pick.kind === 'paid-off' && (
          <p className="text-muted-foreground" data-testid="mortgage-early-payoff-paid-off">
            {COACH_COPY.mortgageEarlyPayoffPaidOff(pick.candidate.name)}
          </p>
        )}
        {pick.kind === 'incomplete' && (
          <p className="text-muted-foreground" data-testid="mortgage-early-payoff-incomplete">
            {COACH_COPY.mortgageEarlyPayoffIncomplete(pick.candidate.name, pick.missing)}
          </p>
        )}
        {pick.kind === 'ready' && result && (
          <>
            <p className="text-xs text-muted-foreground" data-testid="mortgage-early-payoff-context">
              {COACH_COPY.mortgageEarlyPayoffContext()}
            </p>
            <div className="space-y-1">
              <label htmlFor="mortgage-extra-slider" className="flex justify-between text-sm">
                <span>Extra per month</span>
                <span className="font-semibold tabular-nums" data-testid="mortgage-early-payoff-extra">
                  {formatCents(cents(extraCents))}
                </span>
              </label>
              <input
                id="mortgage-extra-slider"
                type="range"
                min={0}
                max={EXTRA_MAX_CENTS}
                step={EXTRA_STEP_CENTS}
                value={extraCents}
                aria-valuetext={`${formatCents(cents(extraCents))} extra principal per month`}
                onChange={(e) => setExtraCents(Number(e.target.value))}
                className="w-full accent-brand-500"
                data-testid="mortgage-early-payoff-slider"
              />
            </div>
            <p aria-live="polite" data-testid="mortgage-early-payoff-sentence">
              {sentence}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
