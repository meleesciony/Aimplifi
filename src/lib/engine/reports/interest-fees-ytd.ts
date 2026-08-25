/**
 * Reports "Interest & fees paid YTD" (COACH_PRINCIPLES_PLAN / DECISIONS #516).
 *
 * The paid figure is the existing spend basis (`spendingByCategory` +
 * `isSpendRow`) restricted to the four Financial leaves that ARE interest
 * or fees — never the whole Financial group (taxes, loan-payment,
 * investment, legal sit there too). The 30-year illustration reuses the
 * same opportunity primitive P1.5 uses: this year's paid-so-far treated
 * as a LEVEL yearly amount (`paid / 12` each month), grown at the nominal
 * dial and printed in today's money. It is not an annualized pace, not
 * their actual APR, and not a nudge to prepay a mortgage.
 *
 * Pure: no I/O, integer cents, deterministic.
 */

import { type Cents, cents, roundHalfAwayFromZero } from '@/lib/money';
import {
  OPPORTUNITY_HORIZON_MONTHS,
  opportunityFVCents,
  opportunityValueTodayCents,
} from '@/lib/engine/fi/fi';
import {
  asOfWindow,
  type SpendingBreakdown,
  type SpendWindow,
} from '@/lib/engine/reports/reports';

/** The four taxonomy leaves this tile reads. One author. */
export const INTEREST_FEE_CATEGORY_IDS = [
  'fees',
  'fees-interest',
  'atm-fee',
  'late-fee',
] as const;

export type InterestFeeCategoryId = (typeof INTEREST_FEE_CATEGORY_IDS)[number];

/** Display names — same strings the taxonomy uses, so copy cannot drift. */
export const INTEREST_FEE_CATEGORY_LABELS: Record<InterestFeeCategoryId, string> = {
  fees: 'Fees & Charges',
  'fees-interest': 'Interest & Finance Charges',
  'atm-fee': 'ATM Fee',
  'late-fee': 'Late Fee',
};

const INTEREST_FEE_CATEGORY_SET: ReadonlySet<string> = new Set(INTEREST_FEE_CATEGORY_IDS);

/** Same 30-year horizon the opportunity list and fee-drag print. */
export const INTEREST_FEES_YTD_MONTHS = OPPORTUNITY_HORIZON_MONTHS[2];

export interface InterestFeesYtdInput {
  paidYtdCents: Cents;
  /** Calendar year the YTD window belongs to (from `today`, never the clock). */
  year: number;
  /**
   * Leaves that actually contributed a positive amount, in taxonomy order.
   * Copy names ONLY these in the paid sentence (critic P1: listing the
   * scan set after the dollars reads as a composition claim).
   */
  contributingCategoryIds: readonly InterestFeeCategoryId[];
  nominalReturnBps: number;
  inflationBps: number;
  /** Default `INTEREST_FEES_YTD_MONTHS`. Clamped to ≥ 0. */
  months?: number;
}

export interface InterestFeesYtd {
  paidYtdCents: Cents;
  year: number;
  contributingCategoryIds: readonly InterestFeeCategoryId[];
  /** `roundHalfAwayFromZero(paidYtd / 12)` — YTD treated as one year's amount. */
  monthlyEquivalentCents: Cents;
  months: number;
  nominalReturnBps: number;
  inflationBps: number;
  /** Today's-money value of investing that yearly amount for `months`. */
  valueTodayCents: Cents;
  /** Nominal FV (`opportunityFVCents`). Pinned, not printed. */
  valueNominalCents: Cents;
}

/**
 * Calendar-year-to-`today` window. Same `asOfWindow` the register and Ask
 * already use for "this year" / YTD — one clamp, one meaning of "so far".
 */
export function interestFeeYtdWindow(today: string): SpendWindow {
  const year = today.slice(0, 4);
  return asOfWindow({ fromYm: `${year}-01`, toYm: today.slice(0, 7) }, today);
}

/**
 * Sum the four interest/fee leaves off an already-computed breakdown.
 * Categories the spend engine dropped (net ≤ 0) are absent — a refund that
 * cancelled the fees is $0 here, not a negative "paid".
 */
export function interestFeeContributions(breakdown: SpendingBreakdown): {
  paidYtdCents: Cents;
  contributingCategoryIds: InterestFeeCategoryId[];
} {
  const amounts = new Map<string, number>();
  for (const row of breakdown.byCategory) {
    if (INTEREST_FEE_CATEGORY_SET.has(row.categoryId) && row.amountCents > 0) {
      amounts.set(row.categoryId, row.amountCents);
    }
  }
  const contributingCategoryIds = INTEREST_FEE_CATEGORY_IDS.filter((id) => amounts.has(id));
  let sum = 0;
  for (const id of contributingCategoryIds) sum += amounts.get(id) ?? 0;
  return { paidYtdCents: cents(sum), contributingCategoryIds };
}

export function paidInterestFeesCents(breakdown: SpendingBreakdown): Cents {
  return interestFeeContributions(breakdown).paidYtdCents;
}

/**
 * YTD paid + the 30-year illustration. Null when nothing was paid (the
 * empty state is a different sentence, not a $0.00 cost). A paid amount
 * whose monthly equivalent rounds to $0.00 still returns: the paid fact
 * is real; the illustration fields are $0 and copy must not invent a
 * 30-year sentence for them.
 */
export function interestFeesYtd(input: InterestFeesYtdInput): InterestFeesYtd | null {
  const paidYtdCents = cents(Math.max(0, Math.trunc(input.paidYtdCents)));
  if (paidYtdCents <= 0) return null;

  const months = Math.max(0, Math.trunc(input.months ?? INTEREST_FEES_YTD_MONTHS));
  const monthlyEquivalentCents = roundHalfAwayFromZero(paidYtdCents / 12);
  const canIllustrate = monthlyEquivalentCents > 0 && months > 0;

  return {
    paidYtdCents,
    year: Math.trunc(input.year),
    contributingCategoryIds: INTEREST_FEE_CATEGORY_IDS.filter((id) =>
      input.contributingCategoryIds.includes(id),
    ),
    monthlyEquivalentCents,
    months,
    nominalReturnBps: input.nominalReturnBps,
    inflationBps: input.inflationBps,
    valueNominalCents: canIllustrate
      ? opportunityFVCents(monthlyEquivalentCents, months, input.nominalReturnBps)
      : cents(0),
    valueTodayCents: canIllustrate
      ? opportunityValueTodayCents(
          monthlyEquivalentCents,
          months,
          input.nominalReturnBps,
          input.inflationBps,
        )
      : cents(0),
  };
}
