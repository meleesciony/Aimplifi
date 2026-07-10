/**
 * Savings-rate streak known answers (TASKS 1.4 / DECISIONS #205).
 * Hand-verified: rates are integer bps already on each flow.
 */
import { describe, expect, it } from 'vitest';
import { computeSavingsStreak } from '@/lib/engine/fi/savings-streak';
import type { MonthlyFlow } from '@/lib/engine/fi/insights';
import { cents } from '@/lib/money';

function flow(
  month: string,
  income: number,
  expenses: number,
  savingsRateBps: number | null,
): MonthlyFlow {
  return {
    month,
    incomeCents: cents(income),
    expensesCents: cents(expenses),
    savingsRateBps,
  };
}

describe('computeSavingsStreak', () => {
  it('counts three consecutive positive months and flags personal best', () => {
    const flows = [
      flow('2026-03', 490000, 400000, 1836),
      flow('2026-04', 490000, 380000, 2245),
      flow('2026-05', 490000, 360000, 2653),
    ];
    const r = computeSavingsStreak(flows);
    expect(r.streakMonths).toBe(3);
    expect(r.latestRateBps).toBe(2653);
    expect(r.isPersonalBest).toBe(true);
    expect(r.bestRateBps).toBe(2653);
    expect(r.priorBestRateBps).toBe(2245);
  });

  it('breaks on a null (no-income) latest month', () => {
    const flows = [
      flow('2026-04', 490000, 400000, 2000),
      flow('2026-05', 0, 10000, null),
    ];
    const r = computeSavingsStreak(flows);
    expect(r.streakMonths).toBe(0);
    expect(r.latestRateBps).toBeNull();
    expect(r.isPersonalBest).toBe(false);
  });

  it('breaks on a negative latest month when minRateBps is 0', () => {
    const flows = [
      flow('2026-04', 490000, 400000, 2000),
      flow('2026-05', 490000, 520000, -612),
    ];
    const r = computeSavingsStreak(flows);
    expect(r.streakMonths).toBe(0);
    expect(r.isPersonalBest).toBe(false);
  });

  it('counts a two-month streak with personal best', () => {
    const flows = [
      flow('2026-04', 490000, 343000, 3000),
      flow('2026-05', 490000, 318500, 3500),
    ];
    const r = computeSavingsStreak(flows);
    expect(r.streakMonths).toBe(2);
    expect(r.isPersonalBest).toBe(true);
    expect(r.priorBestRateBps).toBe(3000);
  });

  it('respects a 15% (1500 bps) floor', () => {
    const flows = [
      flow('2026-03', 490000, 400000, 1836),
      flow('2026-04', 490000, 421400, 1400), // below 15%
      flow('2026-05', 490000, 360000, 2653),
    ];
    const r = computeSavingsStreak(flows, { minRateBps: 1500 });
    // Latest qualifies; April breaks looking further back → streak = 1
    expect(r.streakMonths).toBe(1);
    expect(r.isPersonalBest).toBe(true);
  });

  it('returns zeros on an empty series', () => {
    const r = computeSavingsStreak([]);
    expect(r.streakMonths).toBe(0);
    expect(r.bestRateBps).toBeNull();
    expect(r.isPersonalBest).toBe(false);
  });
});
