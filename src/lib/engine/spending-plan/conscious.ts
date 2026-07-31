/**
 * Conscious Spending lens (P0.4, DECISIONS #93) — Ramit Sethi's bucket frame
 * laid OVER the existing spending plan. This is NOT a new spend calculation: it
 * is a pure re-partition of computeSpendingPlan's exact quantities, so the
 * bucket totals provably sum back to `patternIncomeCents` (one definition of
 * spend — DECISIONS #74/#75). Since the L.22 pattern re-spec (owner
 * 2026-07-26) the partition is exactly his formula — fixed costs are genuinely
 * fixed (the old `spentSoFarCents` term, which mixed fixed and variable, is
 * gone, and with it this module's oldest honest-departure note). One honest
 * departure from the book remains, surfaced inline in the UI copy:
 *
 *   - Investing is FOLDED INTO Savings. Aimplifi tracks investments as a
 *     balance (a stock), not a per-month contribution (a flow) — see
 *     src/server/coach.ts:92-94 — so there is no honest per-month investing
 *     number to show, and we never invent one.
 *
 * Pure: integer cents in, buckets out. No I/O, no `new Date()`, no rounding of
 * money — only `shareBps` (a display ratio, not a materialized cent) is rounded.
 */
import type { SpendingPlan } from './plan';

export type ConsciousBucketKey = 'fixed' | 'savings' | 'guiltFree';

/**
 * The buckets' display names, authored once (L.29's one-author rule applied to
 * O.18b): the strip's legend, the per-bucket Glass-Box panels, and the share
 * snapshot's headline all print these — two spellings of one bucket would be
 * two answers to one question. "Fixed costs" deliberately does not say
 * "bills": since #295 the bucket also holds this month's card payments.
 */
export const CONSCIOUS_BUCKET_LABELS: Record<ConsciousBucketKey, string> = {
  fixed: 'Fixed costs',
  savings: 'Savings & investing',
  guiltFree: 'Guilt-free',
};

export interface ConsciousBucket {
  key: ConsciousBucketKey;
  /** Exact partition of patternIncomeCents. `guiltFree` is negative when overspent. */
  cents: number;
  /** Share of pattern income in integer basis points; 0 when income <= 0. May be negative. */
  shareBps: number;
  /** Sethi target band for this bucket, in basis points of after-tax income. */
  targetLoBps: number;
  targetHiBps: number;
}

export interface ConsciousBuckets {
  patternIncomeCents: number;
  /** Always ordered [fixed, savings, guiltFree]; the three sum to patternIncomeCents. */
  buckets: ConsciousBucket[];
  overspent: boolean;
  /** Investing has no per-month contribution flow in the data model; it is folded into savings. */
  investingTracked: false;
}

/**
 * Sethi's canonical bands, adapted to the three buckets the data honestly
 * supports. His 10% investing + 5–10% savings collapse into a single 15–20%
 * "pay yourself first" band because investing is folded into savings here.
 */
const TARGET_BPS: Record<ConsciousBucketKey, readonly [number, number]> = {
  fixed: [5000, 6000], // 50–60%
  savings: [1500, 2000], // 15–20% (10% investing + 5–10% savings, combined)
  guiltFree: [2000, 3500], // 20–35%
};

/** Integer-bps share of income; guarded against divide-by-zero (returns 0). */
function shareBps(cents: number, incomeCents: number): number {
  if (incomeCents <= 0) return 0;
  return Math.round((cents * 10000) / incomeCents);
}

/**
 * Re-partition a SpendingPlan into the conscious-spending buckets. The identity
 * preserved (the L.22 formula):
 *   patternIncome = fixedExpenses + cardObligations + obligationsBeyondMonth + plannedSavings + leftToSpend
 * maps to:
 *   fixed     = fixedExpenses + cardObligations + obligationsBeyondMonth
 *               (recurring bills at a monthly rate + this-cycle card payments +
 *                card payments already dated past the month's edge, L.11(D) —
 *                a card payment belongs on the FIXED side whichever side of a
 *                month boundary its due date fell on)
 *   savings   = plannedSavings               (max of goal contributions and the
 *                                             savings-% target; investing folded in)
 *   guiltFree = leftToSpend                  (the discretionary remainder; <0 when overspent)
 * so `fixed + savings + guiltFree === patternIncome` by construction.
 */
export function mapToConsciousBuckets(plan: SpendingPlan): ConsciousBuckets {
  const income = plan.patternIncomeCents;
  const cellsByKey: Record<ConsciousBucketKey, number> = {
    fixed: plan.fixedExpensesCents + plan.cardObligationsCents + plan.obligationsBeyondMonthCents,
    savings: plan.plannedSavingsCents,
    guiltFree: plan.leftToSpendCents,
  };

  const buckets: ConsciousBucket[] = (['fixed', 'savings', 'guiltFree'] as const).map((key) => ({
    key,
    cents: cellsByKey[key],
    shareBps: shareBps(cellsByKey[key], income),
    targetLoBps: TARGET_BPS[key][0],
    targetHiBps: TARGET_BPS[key][1],
  }));

  return {
    patternIncomeCents: income,
    buckets,
    overspent: plan.overspent,
    investingTracked: false,
  };
}

