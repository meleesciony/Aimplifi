// @vitest-environment jsdom
/**
 * Live 2026-09-01: Home "You're covered" sat in the same viewport as Cash
 * flow radar "Investor Checking is projected to dip below $0 in 30 days".
 * Both walks are real. The all-clear is this-cycle cards in the payment
 * account only. Copy must name that window so it cannot be read as a 90-day
 * all-clear.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/server/engagement-actions', () => ({ logEngagement: vi.fn() }));

import { cleanup, render, screen } from '@testing-library/react';
import { CashNeededCard } from '@/components/finance/cash-needed-card';
import type { CashNeededResult } from '@/lib/engine/cash-needed/types';
import { cents } from '@/lib/money';
import { isoDate } from '@/lib/dates';

afterEach(cleanup);

function coveredResult(): CashNeededResult {
  return {
    scenario: 'PAY_IN_FULL',
    headline: {
      requiredCents: cents(12_184_78),
      firstDueDate: isoDate('2026-09-01'),
      byDate: isoDate('2026-09-04'),
      cardsDueCount: 2,
      shortfallCents: cents(0),
      shortfallDate: null,
      firstShortCents: cents(0),
      worstDipDate: null,
      shortfallDateBalanceCents: null,
      recommendation: null,
    },
    perDueDate: [],
    cards: [],
    unknownDueDateCards: [],
    upcoming: [],
    intraPeriodMinimum: { date: isoDate('2026-09-04'), balanceCents: cents(210_516) },
    minimumPathInterestCents: null,
    minimumPathInterestCardsCount: 0,
    fundingFrozen: null,
    assumptions: [],
  } as CashNeededResult;
}

describe('CashNeededCard covered alert names this cycle', () => {
  it('test_regression__covered_alert_names_this_cycle_not_a_90_day_all_clear', () => {
    render(
      <CashNeededCard
        result={coveredResult()}
        paymentAccountName="Investor Checking"
        today="2026-09-01"
      />,
    );
    const alert = screen.getByTestId('covered-alert');
    const text = alert.textContent ?? '';
    expect(text).toMatch(/you.?re covered this cycle/i);
    expect(text).toMatch(/through .*Sep 4/);
    expect(text).toContain('$2,105.16');
    expect(text).toContain('every card due this cycle in Investor Checking');
    expect(text).not.toBe("You're covered");
  });
});
