/**
 * Reports Giving YTD — pinned to docs/EDGE_CASES.md §Giving YTD.
 */
import { describe, expect, it } from 'vitest';
import { CATEGORY_BY_ID } from '@/lib/engine/categorize/categories';
import {
  GIVING_CATEGORY_IDS,
  GIVING_CATEGORY_LABELS,
  givenYtdCents,
  givingContributions,
  givingYtd,
  givingYtdWindow,
} from '@/lib/engine/reports/giving-ytd';
import { interestFeeYtdWindow } from '@/lib/engine/reports/interest-fees-ytd';
import {
  spendingByCategory,
  type ReportTxn,
  type SpendingBreakdown,
} from '@/lib/engine/reports/reports';
import { cents } from '@/lib/money';

const emptyBreakdown = (rows: SpendingBreakdown['byCategory']): SpendingBreakdown => ({
  totalCents: rows.reduce((s, r) => s + r.amountCents, 0),
  countedOnHandoverDays: 0,
  uncountedOnHandoverDays: [],
  byCategory: rows,
  byGroup: [],
});

describe('givingYtdWindow', () => {
  it('GY6: is Jan 1 of today\'s year through today\'s month, clamped at today', () => {
    expect(givingYtdWindow('2026-06-10')).toEqual({
      fromYm: '2026-01',
      toYm: '2026-06',
      asOf: '2026-06-10',
    });
  });

  it('is the same calendar YTD the interest-and-fees tile uses', () => {
    expect(givingYtdWindow('2026-06-10')).toEqual(interestFeeYtdWindow('2026-06-10'));
    expect(givingYtdWindow('2025-12-31')).toEqual(interestFeeYtdWindow('2025-12-31'));
  });
});

describe('givenYtdCents', () => {
  it('GY1: sums gifts + charity only', () => {
    const given = givenYtdCents(
      emptyBreakdown([
        { categoryId: 'gifts', name: 'Gifts', group: 'Giving', amountCents: 40_000, countedOnHandoverDays: 0 },
        { categoryId: 'charity', name: 'Charity & Donations', group: 'Giving', amountCents: 60_000, countedOnHandoverDays: 0 },
        { categoryId: 'groceries', name: 'Groceries', group: 'Food & Dining', amountCents: 8_000, countedOnHandoverDays: 0 },
        { categoryId: 'taxes', name: 'Taxes', group: 'Financial', amountCents: 20_000, countedOnHandoverDays: 0 },
      ]),
    );
    expect(given).toBe(100_000);
    expect(GIVING_CATEGORY_IDS).toEqual(['gifts', 'charity']);
  });

  it('GY2: a cancelled giving category (absent from byCategory) is $0, not a guess', () => {
    expect(givenYtdCents(emptyBreakdown([]))).toBe(0);
  });

  it('GY3: contributions list only the leaves that have a positive amount, in taxonomy order', () => {
    const { givenYtdCents: sum, contributingCategoryIds } = givingContributions(
      emptyBreakdown([
        { categoryId: 'charity', name: 'Charity', group: 'Giving', amountCents: 25_000, countedOnHandoverDays: 0 },
        { categoryId: 'groceries', name: 'Groceries', group: 'Food & Dining', amountCents: 8_000, countedOnHandoverDays: 0 },
      ]),
    );
    expect(sum).toBe(25_000);
    expect(contributingCategoryIds).toEqual(['charity']);
  });

  it('GY4: does not sum the Giving group — a custom row in that group is not a leaf', () => {
    expect(
      givenYtdCents(
        emptyBreakdown([
          { categoryId: 'gifts', name: 'Gifts', group: 'Giving', amountCents: 10_000, countedOnHandoverDays: 0 },
          { categoryId: 'my-tithe', name: 'My tithe', group: 'Giving', amountCents: 90_000, countedOnHandoverDays: 0 },
        ]),
      ),
    ).toBe(10_000);
  });

  it('GY5: a refund that nets charity to ≤ 0 leaves only gifts', () => {
    const { givenYtdCents: sum, contributingCategoryIds } = givingContributions(
      emptyBreakdown([
        { categoryId: 'gifts', name: 'Gifts', group: 'Giving', amountCents: 10_000, countedOnHandoverDays: 0 },
      ]),
    );
    expect(sum).toBe(10_000);
    expect(contributingCategoryIds).toEqual(['gifts']);
  });
});

describe('givingYtd (EDGE_CASES §Giving YTD)', () => {
  it('GY1: $1,000 from both leaves is a result, not a null', () => {
    const row = givingYtd({
      givenYtdCents: cents(100_000),
      year: 2026,
      contributingCategoryIds: ['gifts', 'charity'],
    });
    expect(row).not.toBeNull();
    expect(row!.givenYtdCents).toBe(100_000);
    expect(row!.year).toBe(2026);
    expect(row!.contributingCategoryIds).toEqual(['gifts', 'charity']);
  });

  it('GY2: zero given is an honest null', () => {
    expect(
      givingYtd({
        givenYtdCents: cents(0),
        year: 2026,
        contributingCategoryIds: [],
      }),
    ).toBeNull();
  });

  it('a one-cent gift is still a result — $0.01 is not empty', () => {
    const row = givingYtd({
      givenYtdCents: cents(1),
      year: 2026,
      contributingCategoryIds: ['gifts'],
    });
    expect(row).not.toBeNull();
    expect(row!.givenYtdCents).toBe(1);
  });

  it('ignores contributing ids that are not in the two-leaf set', () => {
    const row = givingYtd({
      givenYtdCents: cents(10_000),
      year: 2026,
      contributingCategoryIds: ['gifts', 'my-tithe' as 'gifts'],
    });
    expect(row!.contributingCategoryIds).toEqual(['gifts']);
  });

  it('labels stay locked to the taxonomy names', () => {
    expect(GIVING_CATEGORY_LABELS.gifts).toBe(CATEGORY_BY_ID.get('gifts')!.name);
    expect(GIVING_CATEGORY_LABELS.charity).toBe(CATEGORY_BY_ID.get('charity')!.name);
    expect(GIVING_CATEGORY_LABELS.gifts).toBe('Gifts');
    expect(GIVING_CATEGORY_LABELS.charity).toBe('Charity & Donations');
  });
});

describe('givingYtdWindow + spendingByCategory', () => {
  it('a prior-year gift is outside the window; a June gift on 2026-06-10 is in', () => {
    const txns: ReportTxn[] = [
      { date: '2025-12-31', amountCents: -50_000, categoryId: 'charity' },
      { date: '2026-01-15', amountCents: -20_000, categoryId: 'gifts' },
      { date: '2026-06-10', amountCents: -30_000, categoryId: 'charity' },
      { date: '2026-06-11', amountCents: -9_000, categoryId: 'charity' },
    ];
    const breakdown = spendingByCategory(txns, givingYtdWindow('2026-06-10'));
    expect(givenYtdCents(breakdown)).toBe(50_000);
    expect(givingContributions(breakdown).contributingCategoryIds).toEqual(['gifts', 'charity']);
  });
});
