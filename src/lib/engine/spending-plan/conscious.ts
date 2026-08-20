/**
 * Conscious Spending lens (P0.4, DECISIONS #93; B.3 / W.5) — Ramit Sethi's
 * bucket frame laid OVER the existing spending plan. This is NOT a new spend
 * calculation: it is a pure re-partition of computeSpendingPlan's exact
 * quantities, so the bucket totals provably sum back to `patternIncomeCents`
 * (one definition of spend — DECISIONS #74/#75).
 *
 * Fixed (Wave B): the plan's fixed term is must-pay / Fixed-designated spending
 * (bills, groceries, housing, utilities, …) — not detected recurring series
 * alone — so Sethi's 50–60% band is scored against a numerator that matches
 * what the band assumed. Card statement payments stay OUT (settlement of spend,
 * owner 2026-08-01). One honest departure from the book remains, surfaced
 * inline in the UI copy:
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
 * two answers to one question.
 */
export const CONSCIOUS_BUCKET_LABELS: Record<ConsciousBucketKey, string> = {
  fixed: 'Fixed costs',
  savings: 'Savings & investing',
  guiltFree: 'Guilt-free',
};

/**
 * What each bucket counts — one author for the Sethi-lens caption (B.3). The
 * short label alone under-claimed when Fixed was only detected bills (W.5);
 * this sentence moves with the numerator.
 */
export const CONSCIOUS_BUCKET_COUNTS: Record<ConsciousBucketKey, string> = {
  fixed:
    'bills plus other must-pay spending like groceries and utilities — whatever is marked Fixed on Spending',
  savings: 'savings and investing goals',
  guiltFree: 'guilt-free discretionary spending',
};

/**
 * The Fixed caption for THIS reader (C.23/H.4 copy critic P1-1).
 *
 * `CONSCIOUS_BUCKET_COUNTS.fixed` enumerates the bucket's sources and ends
 * "whatever is marked Fixed on Spending" — a membership rule a declared reserve
 * breaks by construction, because it has no transaction and no category and so
 * is marked nowhere. Executed on a reserves-only reader, the rendered sentence
 * described 100% of the bucket as something none of it was.
 *
 * The reserve fact is APPENDED rather than woven in, so the existing sentence
 * (and the two tests that pin it) stay exactly as they were for the readers it
 * was already true for, and the new clause carries its own truth condition —
 * `a-disclosure-is-several-claims-in-one-sentence`.
 */
export function consciousFixedCounts(reserveCount: number): string {
  if (reserveCount <= 0) return CONSCIOUS_BUCKET_COUNTS.fixed;
  return reserveCount === 1
    ? `${CONSCIOUS_BUCKET_COUNTS.fixed}, plus the reserve you declared`
    : `${CONSCIOUS_BUCKET_COUNTS.fixed}, plus the ${reserveCount} reserves you declared`;
}

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
 * Conscious-spending target bands (DECISIONS #379 Fixed/guilt-free; #493
 * supersedes #379 for the SAVINGS number only).
 *
 *   fixed:     50–60%  (Sethi book — unchanged)
 *   savings:   40%     (household goal — was Sethi 15–20%)
 *   guiltFree: 20–35%  (Sethi book — unchanged)
 *
 * These three bands no longer partition 100% (50–60 + 40 + 20–35 can exceed
 * 100). That is intentional: savings is the household goal rail, not a residual
 * that must sum with Fixed and guilt-free to one whole.
 */
export const CONSCIOUS_TARGET_BPS: Record<ConsciousBucketKey, readonly [number, number]> = {
  fixed: [5000, 6000], // 50–60%
  savings: [4000, 4000], // 40% household goal (#493; was 15–20% Sethi)
  guiltFree: [2000, 3500], // 20–35%
};

/** Integer-bps share of income; guarded against divide-by-zero (returns 0). */
function shareBps(cents: number, incomeCents: number): number {
  if (incomeCents <= 0) return 0;
  return Math.round((cents * 10000) / incomeCents);
}

/**
 * Re-partition a SpendingPlan into the conscious-spending buckets. The identity
 * preserved (owner 2026-08-01 formula):
 *   patternIncome = fixedExpenses + plannedSavings + leftToSpend
 * maps to:
 *   fixed     = fixedExpenses   (must-pay Fixed — not card statement pay)
 *   savings   = plannedSavings  (max of goal contributions and the savings-%
 *                                target; investing folded in)
 *   guiltFree = leftToSpend     (the discretionary remainder; <0 when overspent)
 * so `fixed + savings + guiltFree === patternIncome` by construction.
 */
export function mapToConsciousBuckets(plan: SpendingPlan): ConsciousBuckets {
  const income = plan.patternIncomeCents;
  const cellsByKey: Record<ConsciousBucketKey, number> = {
    fixed: plan.fixedExpensesCents,
    savings: plan.plannedSavingsCents,
    guiltFree: plan.leftToSpendCents,
  };

  const buckets: ConsciousBucket[] = (['fixed', 'savings', 'guiltFree'] as const).map((key) => ({
    key,
    cents: cellsByKey[key],
    shareBps: shareBps(cellsByKey[key], income),
    targetLoBps: CONSCIOUS_TARGET_BPS[key][0],
    targetHiBps: CONSCIOUS_TARGET_BPS[key][1],
  }));

  return {
    patternIncomeCents: income,
    buckets,
    overspent: plan.overspent,
    investingTracked: false,
  };
}

