/**
 * Spending Plan engine known-answer tests (DECISIONS #66). Hand-verified to the cent.
 */
import { describe, expect, it } from 'vitest';
import { computeSpendingPlan, daysInMonth } from '@/lib/engine/spending-plan/plan';
import { isoDate } from '@/lib/dates';

describe('daysInMonth', () => {
  it('is leap-year aware', () => {
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2026, 6)).toBe(30);
    expect(daysInMonth(2026, 1)).toBe(31);
  });
});

describe('computeSpendingPlan', () => {
  it('safe-to-spend = income − spent − upcoming bills − savings; per-day over days left', () => {
    // June (30 days), the 10th → 21 days left incl. today. $6000 income, $1500
    // spent, $1200 bills still coming, $800 savings → $2500 left, $119/day.
    const p = computeSpendingPlan({
      today: isoDate('2026-06-10'),
      expectedIncomeCents: 600000,
      spentSoFarCents: 150000,
      upcomingBillsCents: 120000,
      plannedSavingsCents: 80000,
    });
    expect(p.leftToSpendCents).toBe(250000);
    expect(p.daysLeftInMonth).toBe(21);
    expect(p.perDayCents).toBe(Math.floor(250000 / 21)); // 11904
    expect(p.overspent).toBe(false);
  });

  it('flags overspending and reports $0/day (never negative per-day)', () => {
    const p = computeSpendingPlan({
      today: isoDate('2026-06-28'),
      expectedIncomeCents: 300000,
      spentSoFarCents: 280000,
      upcomingBillsCents: 60000,
      plannedSavingsCents: 0,
    });
    expect(p.leftToSpendCents).toBe(-40000);
    expect(p.overspent).toBe(true);
    expect(p.daysLeftInMonth).toBe(3); // 30 − 28 + 1
    expect(p.perDayCents).toBe(0);
  });

  it('last day of month → 1 day left (never divides by zero)', () => {
    const p = computeSpendingPlan({
      today: isoDate('2026-06-30'),
      expectedIncomeCents: 100000,
      spentSoFarCents: 50000,
      upcomingBillsCents: 0,
      plannedSavingsCents: 0,
    });
    expect(p.daysLeftInMonth).toBe(1);
    expect(p.perDayCents).toBe(50000);
  });
});
