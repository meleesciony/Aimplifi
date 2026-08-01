/**
 * Dial-aware discretionary cuts + wealth contribution basis (DECISIONS #375).
 */
import { describe, expect, it } from 'vitest';
import {
  categoryMatchesMoneyDial,
  proposeDiscretionaryCuts,
  wealthContributionBasis,
} from '@/lib/engine/fi/discretionary-cuts';
import { averageDiscretionaryCategorySpend } from '@/lib/engine/fi/discretionary-spend';
import { CATEGORY_BY_ID } from '@/lib/engine/categorize/categories';
import { isoDate } from '@/lib/dates';

describe('discretionary cuts (#375)', () => {
  it('test_regression__money_dials_protect_named_categories_from_cut_list', () => {
    const cuts = proposeDiscretionaryCuts({
      moneyDials: ['Golf', 'Dining Out'],
      gapCents: 200_000,
      categories: [
        { categoryId: 'fitness', categoryName: 'Fitness', monthlyCents: 80_000, discretionary: true },
        { categoryId: 'dining', categoryName: 'Dining Out', monthlyCents: 120_000, discretionary: true },
        { categoryId: 'kids-activities', categoryName: 'Kids Activities', monthlyCents: 90_000, discretionary: true },
        { categoryId: 'groceries', categoryName: 'Groceries', monthlyCents: 500_000, discretionary: false },
      ],
    });
    expect(cuts.map((c) => c.categoryId)).toEqual(['kids-activities', 'fitness']);
    expect(cuts.every((c) => c.categoryId !== 'dining')).toBe(true);
    expect(cuts.every((c) => c.categoryId !== 'groceries')).toBe(true);
    // Stacking against the gap: kids 90k + fitness 80k closes 170k of 200k.
    expect(cuts[0].closesGapCents).toBe(90_000);
    expect(cuts[1].closesGapCents).toBe(80_000);
  });

  it('test_regression__zero_gap_proposes_no_cuts', () => {
    expect(
      proposeDiscretionaryCuts({
        moneyDials: [],
        gapCents: 0,
        categories: [
          { categoryId: 'dining', categoryName: 'Dining Out', monthlyCents: 50_000, discretionary: true },
        ],
      }),
    ).toEqual([]);
  });

  it('matches dials case-insensitively and by containment', () => {
    expect(categoryMatchesMoneyDial('Dining Out', ['dining'])).toBe(true);
    expect(categoryMatchesMoneyDial('Fitness', ['golf'])).toBe(false);
    expect(categoryMatchesMoneyDial('Kids Activities', ['kids activities'])).toBe(true);
  });

  it('test_regression__wealth_contribution_prefers_settings_savings_pct', () => {
    expect(
      wealthContributionBasis({
        historicalMonthlySavingsCents: 100_000,
        plannedSavingsCents: 500_000,
        savingsTargetBps: 2500,
      }),
    ).toEqual({ contributionCents: 500_000, basis: 'settings-savings-pct' });

    expect(
      wealthContributionBasis({
        historicalMonthlySavingsCents: 100_000,
        plannedSavingsCents: 0,
        savingsTargetBps: null,
      }),
    ).toEqual({ contributionCents: 100_000, basis: 'recent-surplus' });
  });

  it('averages discretionary spend over complete months only', () => {
    const today = isoDate('2026-06-10');
    const rows = averageDiscretionaryCategorySpend(
      [
        {
          date: '2026-05-02',
          amountCents: -4000,
          rawDescriptor: 'CHIPOTLE',
          accountId: 'a',
          isTransfer: false,
          status: 'POSTED',
          categoryId: 'dining',
        },
        {
          date: '2026-04-02',
          amountCents: -2000,
          rawDescriptor: 'CHIPOTLE',
          accountId: 'a',
          isTransfer: false,
          status: 'POSTED',
          categoryId: 'dining',
        },
        {
          date: '2026-06-02', // current month — excluded
          amountCents: -99_000,
          rawDescriptor: 'CHIPOTLE',
          accountId: 'a',
          isTransfer: false,
          status: 'POSTED',
          categoryId: 'dining',
        },
        {
          date: '2026-05-03',
          amountCents: -1000,
          rawDescriptor: 'COSTCO',
          accountId: 'a',
          isTransfer: false,
          status: 'POSTED',
          categoryId: 'groceries', // non-discretionary
        },
      ],
      today,
      2,
      CATEGORY_BY_ID,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].categoryId).toBe('dining');
    // (4000+2000)/2 = 3000
    expect(rows[0].monthlyCents).toBe(3000);
  });
});
