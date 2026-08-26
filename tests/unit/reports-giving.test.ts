/**
 * Reports assembler + copy for Giving YTD (DECISIONS #520).
 */
import { describe, expect, it } from 'vitest';

import { DEMO_USER_ID } from '@/lib/demo-user';
import { COACH_COPY } from '@/lib/engine/fi/coach-copy';
import { givenYtdCents, givingYtd } from '@/lib/engine/reports/giving-ytd';
import { cents } from '@/lib/money';
import { getReports } from '@/server/reports';

describe('Reports Giving YTD payload', () => {
  it('demo seed has no gifts or charity spend — honest empty, not $0.00 given', async () => {
    const data = await getReports(DEMO_USER_ID);
    expect(data.giving.result).toBeNull();
    expect(data.giving.window).toEqual({
      fromYm: '2026-01',
      toYm: '2026-06',
      asOf: '2026-06-10',
    });
    expect(data.giving.window).toEqual(data.interestFees.window);
    const empty = COACH_COPY.givingYtdEmpty(2026);
    expect(empty).toMatch(/so far in 2026/);
    expect(empty).toMatch(/Gifts/);
    expect(empty).toMatch(/Charity & Donations/);
    expect(empty).not.toMatch(/\bthe tile\b/i);
    expect(empty).not.toMatch(/\b(tithe|10%|should give|generously)\b/i);
    expect(empty).not.toMatch(/No gifts or donations are filed/);
    expect(COACH_COPY.givingYtdSubtitle()).not.toMatch(/already on file/i);
  });

  it('a synthetic $1,000 names only the leaves in the dollars', () => {
    const row = givingYtd({
      givenYtdCents: cents(100_000),
      year: 2026,
      contributingCategoryIds: ['gifts', 'charity'],
    })!;
    const sentence = COACH_COPY.givingYtd(row);
    expect(sentence).not.toBeNull();
    expect(sentence).toContain('$1,000.00');
    expect(sentence).toContain('2026');
    expect(sentence).toContain('Gifts and Charity & Donations on file come to $1,000.00');
    expect(sentence).toContain(
      'This figure counts Gifts and Charity & Donations — a category with no spend so far adds nothing.',
    );
    expect(sentence).toContain('not a target');
    expect(sentence).not.toMatch(/give more or less/);
    expect(sentence).not.toMatch(/this card/i);
    expect(sentence).not.toMatch(/\bbelow\b/i);
    expect(sentence).not.toMatch(/\b(VTSAX|VTI|VOO|SPY|AAPL)\b/);
    expect(sentence).not.toMatch(/\b(tithe|10%|should give|invested|30 years)\b/i);
  });

  it('test_regression__giving_ytd_names_only_the_leaves_in_the_dollars', () => {
    const sentence = COACH_COPY.givingYtd({
      givenYtdCents: cents(25_000),
      year: 2026,
      contributingCategoryIds: ['charity'],
    })!;
    expect(sentence).toMatch(/Charity & Donations on file comes to \$250\.00 so far in 2026\./);
    expect(sentence).not.toContain('Gifts and Charity & Donations on file come');
    expect(sentence).toContain(
      'This figure counts Gifts and Charity & Donations',
    );
  });

  it('test_regression__giving_ytd_does_not_sum_the_giving_group', () => {
    expect(
      givenYtdCents({
        totalCents: 100_000,
        countedOnHandoverDays: 0,
        uncountedOnHandoverDays: [],
        byCategory: [
          { categoryId: 'gifts', name: 'Gifts', group: 'Giving', amountCents: 10_000, countedOnHandoverDays: 0 },
          { categoryId: 'my-tithe', name: 'My tithe', group: 'Giving', amountCents: 90_000, countedOnHandoverDays: 0 },
        ],
        byGroup: [],
      }),
    ).toBe(10_000);
  });

  it('test_regression__giving_ytd_empty_title_does_not_claim_already_on_file', () => {
    expect(COACH_COPY.givingYtdSubtitle()).toBe('A lens, not a grade');
    expect(COACH_COPY.givingYtdSubtitle()).not.toMatch(/already on file/i);
    expect(COACH_COPY.givingYtdSubtitle()).not.toMatch(/gifts and donations/i);
  });

  it('test_regression__giving_ytd_empty_does_not_deny_custom_giving_group_spend', () => {
    expect(
      givenYtdCents({
        totalCents: 90_000,
        countedOnHandoverDays: 0,
        uncountedOnHandoverDays: [],
        byCategory: [
          { categoryId: 'my-tithe', name: 'My tithe', group: 'Giving', amountCents: 90_000, countedOnHandoverDays: 0 },
        ],
        byGroup: [],
      }),
    ).toBe(0);
    expect(givingYtd({ givenYtdCents: cents(0), year: 2026, contributingCategoryIds: [] })).toBeNull();
    const empty = COACH_COPY.givingYtdEmpty(2026);
    expect(empty).toMatch(/No spend is filed in Gifts or Charity & Donations so far in 2026/);
    expect(empty).not.toMatch(/No gifts or donations are filed/);
  });

  it('test_regression__giving_ytd_does_not_invent_an_opportunity_cost', () => {
    const sentence = COACH_COPY.givingYtd({
      givenYtdCents: cents(100_000),
      year: 2026,
      contributingCategoryIds: ['gifts', 'charity'],
    })!;
    expect(sentence).not.toMatch(/if .+ (invested|saved)/i);
    expect(sentence).not.toMatch(/would be worth/i);
    expect(sentence).not.toMatch(/today's money/i);
    expect(sentence).not.toMatch(/compound/i);
  });
});
