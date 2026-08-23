// @vitest-environment jsdom
/**
 * C14 "past enough" (docs/COACH_PRINCIPLES_PLAN.md, Coast-FI second framing) —
 * render decision locked.
 *
 * The line is the values choice that only opens when the engine says today's
 * portfolio reaches the FI number without another dollar added: before coast,
 * "turn the dial toward experiences and giving" would be a nudge the engine
 * hasn't earned. So the gate is `coastIsCoast` alone, and the sentence never
 * claims the app surfaces giving (giving categories are per-user visible).
 *
 * Deliberately not a snapshot — a snapshot would go green on any change that
 * updates it (the C.26 rule).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { FICard } from '@/components/coach/fi-card';
import { COACH_COPY } from '@/lib/engine/fi/coach-copy';
import { cents } from '@/lib/money';

afterEach(cleanup);

// All figures are integer cents via the money brand; the numbers only feed the
// card's own math (monthsToFI/slider), which no assertion here depends on.
const baseProps = {
  fiNumberCents: cents(120_000_000), // $1,200,000
  annualExpensesCents: cents(48_000_00),
  portfolioCents: cents(400_000_00),
  monthlyIncomeCents: cents(8_000_00),
  monthlySavingsCents: cents(2_000_00),
  monthlySavingsMonths: 6,
  monthsToFINow: 240,
  swrBps: 400,
  expectedReturnBps: 650,
  projectionReturnBps: 300,
  inflationBps: 250,
  dialOwnership: { returnIsDefault: true, inflationIsDefault: false },
  realReturnFloored: false,
  coastTargetYears: 25,
  coastTargetYearsIsAppDefault: true,
  latestMonthRateBps: 2500,
  latestMonthLabel: 'Jul 2026',
  currencyNote: undefined,
  frozenPortfolioNote: undefined,
};

describe('C14 past-enough Coast framing', () => {
  it('shows the line under the Coast line when coastIsCoast is true', () => {
    render(
      <FICard {...baseProps} coastIsCoast={true} coastRequiredMonthlyCents={null} />,
    );
    const line = screen.getByTestId('past-enough-coast');
    expect(line.textContent).toBe(COACH_COPY.pastEnoughCoast());
  });

  it('stays silent when coastIsCoast is false — even when a coast pace exists', () => {
    render(
      <FICard
        {...baseProps}
        coastIsCoast={false}
        coastRequiredMonthlyCents={cents(145_462)}
      />,
    );
    expect(screen.getByTestId('coast-fi').textContent).toContain('it takes about');
    expect(screen.queryByTestId('past-enough-coast')).toBeNull();
  });

  it('stays silent when coastIsCoast is false with no coast data at all', () => {
    render(
      <FICard {...baseProps} coastIsCoast={false} coastRequiredMonthlyCents={null} />,
    );
    expect(screen.queryByTestId('past-enough-coast')).toBeNull();
  });
});
