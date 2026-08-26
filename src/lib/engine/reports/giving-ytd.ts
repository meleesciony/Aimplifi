/**
 * Reports "Giving so far this year" (COACH_PRINCIPLES_PLAN C14 / DECISIONS #520).
 *
 * The given figure is the existing spend basis (`spendingByCategory` +
 * `isSpendRow`) restricted to the two Giving leaves — never a custom
 * category that happens to sit in the Giving group, and never an
 * opportunity-cost illustration (that would frame giving as a leak).
 *
 * Pure: no I/O, integer cents, deterministic.
 */

import { type Cents, cents } from '@/lib/money';
import { CATEGORY_BY_ID } from '@/lib/engine/categorize/categories';
import {
  asOfWindow,
  type SpendingBreakdown,
  type SpendWindow,
} from '@/lib/engine/reports/reports';

/** The two taxonomy leaves this tile reads. One author. */
export const GIVING_CATEGORY_IDS = ['gifts', 'charity'] as const;

export type GivingCategoryId = (typeof GIVING_CATEGORY_IDS)[number];

/** Display names — same strings the taxonomy uses, so copy cannot drift. */
export const GIVING_CATEGORY_LABELS: Record<GivingCategoryId, string> = {
  gifts: CATEGORY_BY_ID.get('gifts')?.name ?? 'Gifts',
  charity: CATEGORY_BY_ID.get('charity')?.name ?? 'Charity & Donations',
};

const GIVING_CATEGORY_SET: ReadonlySet<string> = new Set(GIVING_CATEGORY_IDS);

export interface GivingYtdInput {
  givenYtdCents: Cents;
  /** Calendar year the YTD window belongs to (from `today`, never the clock). */
  year: number;
  /**
   * Leaves that actually contributed a positive amount, in taxonomy order.
   * Copy names ONLY these in the given sentence.
   */
  contributingCategoryIds: readonly GivingCategoryId[];
}

export interface GivingYtd {
  givenYtdCents: Cents;
  year: number;
  contributingCategoryIds: readonly GivingCategoryId[];
}

/**
 * Calendar-year-to-`today` window. Same `asOfWindow` the interest-and-fees
 * tile uses for "this year" / YTD — one clamp, one meaning of "so far".
 */
export function givingYtdWindow(today: string): SpendWindow {
  const year = today.slice(0, 4);
  return asOfWindow({ fromYm: `${year}-01`, toYm: today.slice(0, 7) }, today);
}

/**
 * Sum the two Giving leaves off an already-computed breakdown.
 * Categories the spend engine dropped (net ≤ 0) are absent — a refund
 * that cancelled the gifts is $0 here, not a negative "given".
 */
export function givingContributions(breakdown: SpendingBreakdown): {
  givenYtdCents: Cents;
  contributingCategoryIds: GivingCategoryId[];
} {
  const amounts = new Map<string, number>();
  for (const row of breakdown.byCategory) {
    if (GIVING_CATEGORY_SET.has(row.categoryId) && row.amountCents > 0) {
      amounts.set(row.categoryId, row.amountCents);
    }
  }
  const contributingCategoryIds = GIVING_CATEGORY_IDS.filter((id) => amounts.has(id));
  let sum = 0;
  for (const id of contributingCategoryIds) sum += amounts.get(id) ?? 0;
  return { givenYtdCents: cents(sum), contributingCategoryIds };
}

export function givenYtdCents(breakdown: SpendingBreakdown): Cents {
  return givingContributions(breakdown).givenYtdCents;
}

/**
 * YTD given. Null when nothing was filed (the empty state is a different
 * sentence, not a $0.00 gift). No 30-year illustration — giving is a
 * dial, not a leak.
 */
export function givingYtd(input: GivingYtdInput): GivingYtd | null {
  const givenYtdCents = cents(Math.max(0, Math.trunc(input.givenYtdCents)));
  if (givenYtdCents <= 0) return null;

  return {
    givenYtdCents,
    year: Math.trunc(input.year),
    contributingCategoryIds: GIVING_CATEGORY_IDS.filter((id) =>
      input.contributingCategoryIds.includes(id),
    ),
  };
}
