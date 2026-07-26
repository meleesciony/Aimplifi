/**
 * Conscious Spending lens (P0.4, DECISIONS #93; #295 card-obligations term).
 * The cardinal property: the buckets are a strict re-partition of
 * computeSpendingPlan's quantities, so they must ALWAYS sum back to
 * expectedIncomeCents — there is no second spend definition. Anchored on the
 * real engine output, never on hand-built plans.
 */
import { describe, expect, it } from 'vitest';
import { isoDate } from '@/lib/dates';
import { computeSpendingPlan } from '@/lib/engine/spending-plan/plan';
import { mapToConsciousBuckets } from '@/lib/engine/spending-plan/conscious';

const plan = (over: Partial<Parameters<typeof computeSpendingPlan>[0]> = {}) =>
  computeSpendingPlan({
    today: isoDate('2026-06-25'),
    expectedIncomeCents: 500_000,
    spentSoFarCents: 250_000,
    upcomingBillsCents: 50_000,
    cardObligationsCents: 0,
      cardObligationsEstimated: false,
    goalContributionsCents: 50_000,
    savingsTargetBps: null,
    ...over,
  });

const sumCents = (b: ReturnType<typeof mapToConsciousBuckets>) =>
  b.buckets.reduce((s, x) => s + x.cents, 0);

describe('mapToConsciousBuckets — provably equal re-partition', () => {
  it('the three buckets sum exactly to expected income', () => {
    const b = mapToConsciousBuckets(plan());
    expect(sumCents(b)).toBe(b.expectedIncomeCents);
    expect(sumCents(b)).toBe(500_000);
  });

  it('maps the plan quantities to the right buckets with correct shares', () => {
    const b = mapToConsciousBuckets(plan()); // left = 500k - (250k+50k+0+50k) = 150k
    const byKey = Object.fromEntries(b.buckets.map((x) => [x.key, x]));
    expect(byKey.fixed.cents).toBe(300_000); // spent 250k + upcoming bills 50k + card obligations 0
    expect(byKey.savings.cents).toBe(50_000); // planned savings (goals)
    expect(byKey.guiltFree.cents).toBe(150_000); // left to spend
    expect(byKey.fixed.shareBps).toBe(6000); // 60%
    expect(byKey.savings.shareBps).toBe(1000); // 10%
    expect(byKey.guiltFree.shareBps).toBe(3000); // 30%
    expect(b.overspent).toBe(false);
    expect(b.investingTracked).toBe(false);
  });

  it('card obligations land in the fixed bucket and the partition still holds (#295)', () => {
    const b = mapToConsciousBuckets(plan({ cardObligationsCents: 100_000 }));
    const byKey = Object.fromEntries(b.buckets.map((x) => [x.key, x]));
    expect(byKey.fixed.cents).toBe(400_000); // 250k + 50k + 100k card payments
    expect(byKey.guiltFree.cents).toBe(50_000); // 150k − 100k
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
      plan({ expectedIncomeCents: 300_000, spentSoFarCents: 280_000, upcomingBillsCents: 30_000, goalContributionsCents: 20_000 }),
    ); // committed 330k > income 300k -> left = -30k
    const byKey = Object.fromEntries(b.buckets.map((x) => [x.key, x]));
    expect(b.overspent).toBe(true);
    expect(byKey.guiltFree.cents).toBe(-30_000);
    expect(byKey.guiltFree.shareBps).toBe(-1000); // -10%
    expect(sumCents(b)).toBe(b.expectedIncomeCents); // partition still holds
    expect(sumCents(b)).toBe(300_000);
  });

  it('never divides by zero when there is no income', () => {
    const b = mapToConsciousBuckets(
      plan({ expectedIncomeCents: 0, spentSoFarCents: 100_000, upcomingBillsCents: 0, goalContributionsCents: 0 }),
    );
    for (const bucket of b.buckets) expect(bucket.shareBps).toBe(0);
    expect(sumCents(b)).toBe(0); // 100k fixed + 0 savings - 100k guilt-free
  });

  it('every bucket carries Sethi target bands and the canonical order', () => {
    const b = mapToConsciousBuckets(plan());
    expect(b.buckets.map((x) => x.key)).toEqual(['fixed', 'savings', 'guiltFree']);
    const byKey = Object.fromEntries(b.buckets.map((x) => [x.key, x]));
    expect([byKey.fixed.targetLoBps, byKey.fixed.targetHiBps]).toEqual([5000, 6000]);
    expect([byKey.savings.targetLoBps, byKey.savings.targetHiBps]).toEqual([1500, 2000]);
    expect([byKey.guiltFree.targetLoBps, byKey.guiltFree.targetHiBps]).toEqual([2000, 3500]);
  });
});
