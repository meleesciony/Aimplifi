/**
 * Reports interest & fees YTD — pinned to docs/EDGE_CASES.md §Interest & fees YTD.
 */
import { describe, expect, it } from 'vitest';
import {
  INTEREST_FEE_CATEGORY_IDS,
  INTEREST_FEES_YTD_MONTHS,
  interestFeeContributions,
  interestFeeYtdWindow,
  interestFeesYtd,
  paidInterestFeesCents,
} from '@/lib/engine/reports/interest-fees-ytd';
import {
  spendingByCategory,
  type ReportTxn,
  type SpendingBreakdown,
} from '@/lib/engine/reports/reports';
import {
  OPPORTUNITY_HORIZON_MONTHS,
  opportunityFVCents,
  opportunityValueTodayCents,
  opportunityValueTrailsContributions,
} from '@/lib/engine/fi/fi';
import { cents } from '@/lib/money';

const emptyBreakdown = (rows: SpendingBreakdown['byCategory']): SpendingBreakdown => ({
  totalCents: rows.reduce((s, r) => s + r.amountCents, 0),
  countedOnHandoverDays: 0,
  uncountedOnHandoverDays: [],
  byCategory: rows,
  byGroup: [],
});

describe('interestFeeYtdWindow', () => {
  it('is Jan 1 of today\'s year through today\'s month, clamped at today', () => {
    expect(interestFeeYtdWindow('2026-06-10')).toEqual({
      fromYm: '2026-01',
      toYm: '2026-06',
      asOf: '2026-06-10',
    });
  });
});

describe('paidInterestFeesCents', () => {
  it('sums only the four interest/fee leaves (IF-filter)', () => {
    const paid = paidInterestFeesCents(
      emptyBreakdown([
        { categoryId: 'fees', name: 'Fees & Charges', group: 'Financial', amountCents: 5_000, countedOnHandoverDays: 0 },
        { categoryId: 'fees-interest', name: 'Interest & Finance Charges', group: 'Financial', amountCents: 3_000, countedOnHandoverDays: 0 },
        { categoryId: 'atm-fee', name: 'ATM Fee', group: 'Financial', amountCents: 400, countedOnHandoverDays: 0 },
        { categoryId: 'late-fee', name: 'Late Fee', group: 'Financial', amountCents: 1_000, countedOnHandoverDays: 0 },
        { categoryId: 'taxes', name: 'Taxes', group: 'Financial', amountCents: 20_000, countedOnHandoverDays: 0 },
        { categoryId: 'loan-payment', name: 'Loan Payment', group: 'Financial', amountCents: 62_170, countedOnHandoverDays: 0 },
        { categoryId: 'groceries', name: 'Groceries', group: 'Food & Dining', amountCents: 8_000, countedOnHandoverDays: 0 },
      ]),
    );
    expect(paid).toBe(9_400);
    expect(INTEREST_FEE_CATEGORY_IDS).toEqual(['fees', 'fees-interest', 'atm-fee', 'late-fee']);
  });

  it('a cancelled fee category (absent from byCategory) is $0, not a guess', () => {
    expect(paidInterestFeesCents(emptyBreakdown([]))).toBe(0);
  });

  it('contributions list only the leaves that have a positive amount, in taxonomy order', () => {
    const { paidYtdCents, contributingCategoryIds } = interestFeeContributions(
      emptyBreakdown([
        { categoryId: 'late-fee', name: 'Late Fee', group: 'Financial', amountCents: 1_000, countedOnHandoverDays: 0 },
        { categoryId: 'fees-interest', name: 'Interest', group: 'Financial', amountCents: 3_000, countedOnHandoverDays: 0 },
        { categoryId: 'taxes', name: 'Taxes', group: 'Financial', amountCents: 20_000, countedOnHandoverDays: 0 },
      ]),
    );
    expect(paidYtdCents).toBe(4_000);
    expect(contributingCategoryIds).toEqual(['fees-interest', 'late-fee']);
  });
});

describe('interestFeesYtd (EDGE_CASES §Interest & fees YTD)', () => {
  it('IF1: $1,200 at 0%/0% — $100/mo × 360 = $36,000.00', () => {
    const row = interestFeesYtd({
      paidYtdCents: cents(120_000),
      year: 2026,
      contributingCategoryIds: ['fees-interest'],
      nominalReturnBps: 0,
      inflationBps: 0,
    });
    expect(row).not.toBeNull();
    expect(row!.monthlyEquivalentCents).toBe(10_000);
    expect(row!.months).toBe(360);
    expect(row!.valueTodayCents).toBe(3_600_000);
    expect(row!.valueNominalCents).toBe(3_600_000);
    expect(row!.year).toBe(2026);
  });

  it('IF2: zero paid is an honest null', () => {
    expect(
      interestFeesYtd({
        paidYtdCents: cents(0),
        year: 2026,
        contributingCategoryIds: [],
        nominalReturnBps: 700,
        inflationBps: 250,
      }),
    ).toBeNull();
  });

  it('IF3: $0.05 paid — fact survives; illustration rounds to $0.00', () => {
    const row = interestFeesYtd({
      paidYtdCents: cents(5),
      year: 2026,
      contributingCategoryIds: ['fees'],
      nominalReturnBps: 700,
      inflationBps: 250,
    });
    expect(row).not.toBeNull();
    expect(row!.paidYtdCents).toBe(5);
    expect(row!.monthlyEquivalentCents).toBe(0);
    expect(row!.valueTodayCents).toBe(0);
    expect(row!.valueNominalCents).toBe(0);
  });

  it('IF4: reuses opportunityFVCents / opportunityValueTodayCents exactly', () => {
    const row = interestFeesYtd({
      paidYtdCents: cents(120_000),
      year: 2026,
      contributingCategoryIds: ['fees-interest'],
      nominalReturnBps: 700,
      inflationBps: 250,
    });
    expect(row).not.toBeNull();
    expect(row!.valueNominalCents).toBe(
      opportunityFVCents(row!.monthlyEquivalentCents, row!.months, 700),
    );
    expect(row!.valueTodayCents).toBe(
      opportunityValueTodayCents(row!.monthlyEquivalentCents, row!.months, 700, 250),
    );
  });

  it('IF5: $1,200 at 7.00%/2.50% — today-money from the primitive', () => {
    const row = interestFeesYtd({
      paidYtdCents: cents(120_000),
      year: 2026,
      contributingCategoryIds: ['fees-interest'],
      nominalReturnBps: 700,
      inflationBps: 250,
    });
    expect(row).not.toBeNull();
    expect(row!.monthlyEquivalentCents).toBe(10_000);
    expect(row!.valueTodayCents).toBe(
      opportunityValueTodayCents(cents(10_000), 360, 700, 250),
    );
    expect(row!.valueNominalCents).toBe(opportunityFVCents(cents(10_000), 360, 700));
  });

  it('horizon default is the opportunity 30-year', () => {
    expect(INTEREST_FEES_YTD_MONTHS).toBe(360);
    expect(INTEREST_FEES_YTD_MONTHS).toBe(OPPORTUNITY_HORIZON_MONTHS[2]);
  });

  it('demo 7.00%/2.50% does not trail; equal 2.50%/2.50% does', () => {
    expect(opportunityValueTrailsContributions(360, 700, 250)).toBe(false);
    expect(opportunityValueTrailsContributions(360, 250, 250)).toBe(true);
  });
});

describe('interest & fees YTD uses the spend basis (no forked predicate)', () => {
  const today = '2026-06-10';
  const window = interestFeeYtdWindow(today);

  const tx = (partial: Partial<ReportTxn> & Pick<ReportTxn, 'date' | 'amountCents'>): ReportTxn => ({
    id: partial.id ?? `t-${partial.date}-${partial.amountCents}`,
    categoryId: partial.categoryId ?? 'fees',
    isTransfer: partial.isTransfer,
    isSplitParent: partial.isSplitParent,
    excludeFromTotals: partial.excludeFromTotals,
    ...partial,
  });

  it('counts a YTD fee and drops last-year, future, transfer, split-parent, excluded-flow', () => {
    const txns: ReportTxn[] = [
      tx({ id: 'keep', date: '2026-03-15', amountCents: -4_000, categoryId: 'fees' }),
      tx({ id: 'prior-year', date: '2025-12-31', amountCents: -9_000, categoryId: 'fees' }),
      tx({ id: 'future', date: '2026-06-20', amountCents: -2_000, categoryId: 'fees' }),
      tx({ id: 'xfer', date: '2026-02-01', amountCents: -3_000, categoryId: 'fees', isTransfer: true }),
      tx({ id: 'split', date: '2026-02-01', amountCents: -3_000, categoryId: 'fees', isSplitParent: true }),
      tx({ id: 'loan-ex', date: '2026-04-01', amountCents: -5_000, categoryId: 'fees' }),
      tx({ id: 'income', date: '2026-01-15', amountCents: 1_500, categoryId: 'interest-income' }),
      tx({ id: 'taxes', date: '2026-01-15', amountCents: -8_000, categoryId: 'taxes' }),
    ];
    const breakdown = spendingByCategory(txns, window, undefined, new Set(['loan-ex']));
    expect(paidInterestFeesCents(breakdown)).toBe(4_000);
  });
});
