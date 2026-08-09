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

  it('never flags a least-bad negative month as a personal best (critic F3)', () => {
    // All-negative history where the latest (-1 bp) beats every prior month:
    // "best so far" would render "-0.0%" — a zero-looking claim about a number
    // that isn't zero. The positivity gate must refuse it.
    const flows = [
      flow('2026-03', 490000, 520000, -306),
      flow('2026-04', 490000, 510000, -153),
      flow('2026-05', 490000, 500000, -1),
    ];
    const r = computeSavingsStreak(flows);
    expect(r.streakMonths).toBe(0);
    expect(r.latestRateBps).toBe(-1);
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

  // Audit P2: the default floor means "saved something" — strictly positive. A 0-bps
  // month (income == expenses) must break, or the streak sentence calls a 0.0% month
  // positive. A positive minRateBps caller keeps inclusive `>=` (the 1500-bps test).
  it('breaks the default streak on a 0-bps latest month (saved nothing is not positive)', () => {
    const flows = [
      flow('2026-04', 490000, 343000, 3000),
      flow('2026-05', 490000, 490000, 0),
    ];
    const r = computeSavingsStreak(flows);
    expect(r.streakMonths).toBe(0);
    expect(r.latestRateBps).toBe(0);
  });

  it('breaks the default streak when a 0-bps month sits inside the run', () => {
    const flows = [
      flow('2026-03', 490000, 400000, 1836),
      flow('2026-04', 490000, 490000, 0),
      flow('2026-05', 490000, 360000, 2653),
    ];
    const r = computeSavingsStreak(flows);
    expect(r.streakMonths).toBe(1);
  });

  it('counts a tiny-but-positive rate (4 bps) as a streak month', () => {
    const flows = [
      flow('2026-04', 490000, 400000, 1836),
      flow('2026-05', 490000, 488000, 4),
    ];
    const r = computeSavingsStreak(flows);
    expect(r.streakMonths).toBe(2);
    expect(r.latestRateBps).toBe(4);
    expect(r.isPersonalBest).toBe(false);
  });

  it('keeps inclusive >= semantics for a positive minRateBps', () => {
    const flows = [
      flow('2026-04', 490000, 416500, 1500), // exactly the 15% floor
      flow('2026-05', 490000, 360000, 2653),
    ];
    const r = computeSavingsStreak(flows, { minRateBps: 1500 });
    expect(r.streakMonths).toBe(2);
  });
});
