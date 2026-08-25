/**
 * Reports assembler + copy for Interest & fees YTD (DECISIONS #516).
 */
import { describe, expect, it } from 'vitest';

import { DEMO_USER_ID } from '@/lib/demo-user';
import { COACH_COPY } from '@/lib/engine/fi/coach-copy';
import { opportunityValueTodayCents } from '@/lib/engine/fi/fi';
import {
  interestFeesYtd,
  paidInterestFeesCents,
} from '@/lib/engine/reports/interest-fees-ytd';
import { cents, formatCents } from '@/lib/money';
import { getReports } from '@/server/reports';

const DEFAULT_OWNER = { returnIsDefault: true, inflationIsDefault: true };

const illustrated = (
  extras: Partial<Parameters<typeof interestFeesYtd>[0]> = {},
) =>
  interestFeesYtd({
    paidYtdCents: cents(120_000),
    year: 2026,
    contributingCategoryIds: ['fees-interest'],
    nominalReturnBps: 700,
    inflationBps: 250,
    ...extras,
  })!;

describe('Reports interest & fees YTD payload', () => {
  it('demo seed has no fee/interest spend — honest empty, not $0.00 invested', async () => {
    const data = await getReports(DEMO_USER_ID);
    expect(data.interestFees.result).toBeNull();
    expect(data.interestFees.dialOwnership).toEqual(DEFAULT_OWNER);
    expect(data.interestFees.window).toEqual({
      fromYm: '2026-01',
      toYm: '2026-06',
      asOf: '2026-06-10',
    });
    const empty = COACH_COPY.interestFeesYtdEmpty(2026);
    expect(empty).toMatch(/so far in 2026/);
    expect(empty).toMatch(/Fees & Charges/);
    expect(empty).toMatch(/Interest & Finance Charges/);
    expect(empty).toMatch(/ATM Fee/);
    expect(empty).toMatch(/Late Fee/);
    expect(empty).not.toMatch(/\bthe tile\b/i);
  });

  it('a synthetic $1,200 at demo dials is one-authored in today\'s money', () => {
    const row = illustrated();
    const sentence = COACH_COPY.interestFeesYtd(row, DEFAULT_OWNER);
    expect(sentence).not.toBeNull();
    expect(sentence).toContain('$1,200.00');
    expect(sentence).toContain('2026');
    expect(sentence).toContain(formatCents(row.valueTodayCents));
    expect(sentence).toContain('$100.00 a month');
    expect(sentence).toContain("today's money");
    expect(sentence).toContain('grown at our default 7.00% return assumption');
    expect(sentence).toContain('our default 2.50% inflation assumption taken off');
    expect(sentence).toContain('paid-so-far treated as a yearly amount');
    expect(sentence).not.toContain('assumptions working');
    expect(sentence).toContain('Illustration, not advice');
    expect(sentence).not.toMatch(/this card/i);
    expect(sentence).not.toMatch(/\bbelow\b/i);
    expect(sentence).not.toMatch(/\b(VTSAX|VTI|VOO|SPY|AAPL)\b/);
    expect(row.valueTodayCents).toBe(opportunityValueTodayCents(cents(10_000), 360, 700, 250));
  });

  it('test_regression__interest_fees_ytd_names_monthly_and_grow_then_deflate', () => {
    const sentence = COACH_COPY.interestFeesYtd(illustrated(), DEFAULT_OWNER)!;
    expect(sentence).toContain('$100.00 a month');
    expect(sentence).toMatch(/grown at .+ then .+ taken off/);
    expect(sentence).not.toMatch(/at 7(?:\.00)?% and 2(?:\.50)?%/);
  });

  it('test_regression__interest_fees_ytd_trails_contributions_names_the_assumptions', () => {
    const row = illustrated({ nominalReturnBps: 250, inflationBps: 250 });
    const sentence = COACH_COPY.interestFeesYtd(row, DEFAULT_OWNER)!;
    expect(row.valueTodayCents).toBeLessThan(row.monthlyEquivalentCents * row.months);
    expect(sentence).toContain('assumptions working');
  });

  it('test_regression__interest_fees_ytd_names_only_the_leaves_in_the_dollars', () => {
    const sentence = COACH_COPY.interestFeesYtd(illustrated(), DEFAULT_OWNER)!;
    expect(sentence).toMatch(/You've paid \$1,200\.00 in Interest & Finance Charges so far in 2026\./);
    expect(sentence).not.toMatch(
      /You've paid \$1,200\.00 in interest and fees so far in 2026 — Fees & Charges/,
    );
    expect(sentence).toContain(
      'This figure counts Fees & Charges, Interest & Finance Charges, ATM Fee, and Late Fee',
    );
  });

  it('test_regression__interest_fees_ytd_does_not_sum_the_financial_group', () => {
    expect(
      paidInterestFeesCents({
        totalCents: 90_000,
        countedOnHandoverDays: 0,
        uncountedOnHandoverDays: [],
        byCategory: [
          { categoryId: 'fees', name: 'Fees', group: 'Financial', amountCents: 1_000, countedOnHandoverDays: 0 },
          { categoryId: 'taxes', name: 'Taxes', group: 'Financial', amountCents: 40_000, countedOnHandoverDays: 0 },
          { categoryId: 'loan-payment', name: 'Loan', group: 'Financial', amountCents: 49_000, countedOnHandoverDays: 0 },
        ],
        byGroup: [],
      }),
    ).toBe(1_000);
  });

  it('paid-only copy when the monthly equivalent rounds to $0.00 — no 30-year sentence', () => {
    const text = COACH_COPY.interestFeesYtd(
      {
        paidYtdCents: cents(5),
        year: 2026,
        contributingCategoryIds: ['fees'],
        monthlyEquivalentCents: cents(0),
        months: 360,
        nominalReturnBps: 700,
        inflationBps: 250,
        valueTodayCents: cents(0),
        valueNominalCents: cents(0),
      },
      DEFAULT_OWNER,
    );
    expect(text).toContain('$0.05');
    expect(text).toContain('Fees & Charges');
    expect(text).not.toMatch(/30 years/);
    expect(text).not.toMatch(/today's money/);
  });
});
