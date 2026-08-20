/**
 * Conscious Spending lens (P0.4, DECISIONS #93; L.22 pattern re-spec).
 * The cardinal property: the buckets are a strict re-partition of
 * computeSpendingPlan's quantities, so they must ALWAYS sum back to
 * patternIncomeCents — there is no second spend definition. Anchored on the
 * real engine output, never on hand-built plans. Under L.22 the partition IS
 * the owner's formula: fixed = recurring bills at a monthly rate (card payments
 * are settlement, not a bucket), with no discretionary term anywhere.
 */
import { describe, expect, it } from 'vitest';
import { isoDate } from '@/lib/dates';
import { COACH_COPY } from '@/lib/engine/fi/coach-copy';
import { computeSpendingPlan } from '@/lib/engine/spending-plan/plan';
import {
  CONSCIOUS_BUCKET_COUNTS,
  consciousFixedCounts,
  CONSCIOUS_TARGET_BPS,
  mapToConsciousBuckets,
} from '@/lib/engine/spending-plan/conscious';

const plan = (over: Partial<Parameters<typeof computeSpendingPlan>[0]> = {}) =>
  computeSpendingPlan({
    today: isoDate('2026-06-25'),
    trailingMonthlyIncomeCents: [500_000],
    scheduledIncome: [],
    scheduledFixed: [{ amountCents: -300_000, cadence: 'MONTHLY' }],
    cardObligationsCents: 0,
    cardObligationsEstimated: false,
    obligationsBeyondMonthCents: 0,
    obligationsBeyondMonthThroughDate: null,
    obligationsBeyondMonthEstimated: false,
    goalContributionsCents: 50_000,
    savingsTargetBps: null,
    ...over,
  });

const sumCents = (b: ReturnType<typeof mapToConsciousBuckets>) =>
  b.buckets.reduce((s, x) => s + x.cents, 0);

describe('mapToConsciousBuckets — provably equal re-partition', () => {
  it('the three buckets sum exactly to pattern income', () => {
    const b = mapToConsciousBuckets(plan());
    expect(sumCents(b)).toBe(b.patternIncomeCents);
    expect(sumCents(b)).toBe(500_000);
  });

  it('maps the plan quantities to the right buckets with correct shares', () => {
    const b = mapToConsciousBuckets(plan()); // left = 500k - (300k fixed + 0 cards + 50k savings) = 150k
    const byKey = Object.fromEntries(b.buckets.map((x) => [x.key, x]));
    expect(byKey.fixed.cents).toBe(300_000); // recurring bills at a monthly rate + card obligations 0
    expect(byKey.savings.cents).toBe(50_000); // planned savings (goals)
    expect(byKey.guiltFree.cents).toBe(150_000); // left to spend
    expect(byKey.fixed.shareBps).toBe(6000); // 60%
    expect(byKey.savings.shareBps).toBe(1000); // 10%
    expect(byKey.guiltFree.shareBps).toBe(3000); // 30%
    expect(b.overspent).toBe(false);
    expect(b.investingTracked).toBe(false);
  });

  it('card obligations do not enter any bucket — guilt-free stays the income remainder', () => {
    const b = mapToConsciousBuckets(plan({ cardObligationsCents: 100_000 }));
    const byKey = Object.fromEntries(b.buckets.map((x) => [x.key, x]));
    expect(byKey.fixed.cents).toBe(300_000); // bills only
    expect(byKey.guiltFree.cents).toBe(150_000); // unchanged by card dues
    expect(sumCents(b)).toBe(500_000);
  });

  it('a savings-% target that outbids the goals flows into the savings bucket, partition intact', () => {
    // 20% of 500k = 100k > 50k goals → savings 100k, guilt-free 100k.
    const b = mapToConsciousBuckets(plan({ savingsTargetBps: 2000 }));
    const byKey = Object.fromEntries(b.buckets.map((x) => [x.key, x]));
    expect(byKey.savings.cents).toBe(100_000);
    expect(byKey.guiltFree.cents).toBe(100_000);
    expect(sumCents(b)).toBe(500_000);
  });

  it('stays a strict partition when overspent (guilt-free goes negative)', () => {
    const b = mapToConsciousBuckets(
      plan({
        trailingMonthlyIncomeCents: [300_000],
        scheduledFixed: [{ amountCents: -310_000, cadence: 'MONTHLY' }],
        goalContributionsCents: 20_000,
      }),
    ); // committed 330k > income 300k -> left = -30k
    const byKey = Object.fromEntries(b.buckets.map((x) => [x.key, x]));
    expect(b.overspent).toBe(true);
    expect(byKey.guiltFree.cents).toBe(-30_000);
    expect(byKey.guiltFree.shareBps).toBe(-1000); // -10%
    expect(sumCents(b)).toBe(b.patternIncomeCents); // partition still holds
    expect(sumCents(b)).toBe(300_000);
  });

  it('never divides by zero when there is no income', () => {
    const b = mapToConsciousBuckets(
      plan({ trailingMonthlyIncomeCents: [], scheduledFixed: [{ amountCents: -100_000, cadence: 'MONTHLY' }], goalContributionsCents: 0 }),
    );
    for (const bucket of b.buckets) expect(bucket.shareBps).toBe(0);
    expect(sumCents(b)).toBe(0); // 100k fixed + 0 savings − 100k guilt-free
  });

  it('every bucket carries target bands and the canonical order', () => {
    const b = mapToConsciousBuckets(plan());
    expect(b.buckets.map((x) => x.key)).toEqual(['fixed', 'savings', 'guiltFree']);
    const byKey = Object.fromEntries(b.buckets.map((x) => [x.key, x]));
    expect([byKey.fixed.targetLoBps, byKey.fixed.targetHiBps]).toEqual([5000, 6000]);
    expect([byKey.savings.targetLoBps, byKey.savings.targetHiBps]).toEqual([4000, 4000]);
    expect([byKey.guiltFree.targetLoBps, byKey.guiltFree.targetHiBps]).toEqual([2000, 3500]);
  });

  it('test_regression__conscious_savings_band_is_40_not_sethi_15_20', () => {
    expect(CONSCIOUS_TARGET_BPS.savings).toEqual([4000, 4000]);
    // #493: the three bands no longer partition 100% (50–60 + 40 + 20–35 can exceed 100)
    const loSum =
      CONSCIOUS_TARGET_BPS.fixed[0] + CONSCIOUS_TARGET_BPS.savings[0] + CONSCIOUS_TARGET_BPS.guiltFree[0];
    expect(loSum).toBeGreaterThan(10000);
  });
});

describe('C.23/H.4 — the caption names the reserve the bucket contains', () => {
  it('a declared reserve is added to the Fixed enumeration, and nothing changes without one', () => {
    expect(consciousFixedCounts(0)).toBe(CONSCIOUS_BUCKET_COUNTS.fixed);
    expect(consciousFixedCounts(1)).toContain('plus the reserve you declared');
    expect(consciousFixedCounts(3)).toContain('plus the 3 reserves you declared');
    // The rendered sentence carries it — the caption is the surface, not the table.
    const text = COACH_COPY.consciousSpending(2, 0, 98, consciousFixedCounts(1));
    expect(text).toContain('plus the reserve you declared');
  });
});

describe('B.3 — Sethi band stays; Fixed copy names the widened numerator', () => {
  it('test_regression__conscious_fixed_band_stays_50_60_after_widened_numerator', () => {
    expect(CONSCIOUS_TARGET_BPS.fixed).toEqual([5000, 6000]);
    expect(CONSCIOUS_BUCKET_COUNTS.fixed).toMatch(/groceries/i);
    expect(CONSCIOUS_BUCKET_COUNTS.fixed).toMatch(/Fixed on Spending/);
  });

  it('test_regression__conscious_caption_names_must_pay_fixed_not_bills_alone', () => {
    const text = COACH_COPY.consciousSpending(58, 14, 28, CONSCIOUS_BUCKET_COUNTS.fixed);
    expect(text).toContain(CONSCIOUS_BUCKET_COUNTS.fixed);
    expect(text).toMatch(/50–60%/);
    expect(text).toMatch(/income pattern/);
    expect(text).not.toMatch(/This month/);
    expect(text).not.toMatch(/fixed and recurring costs/);
  });
});
