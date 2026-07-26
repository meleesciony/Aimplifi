/**
 * Spending Plan engine known-answer tests (DECISIONS #66, reframed #295 —
 * guilt-free spending). Hand-verified to the cent.
 */
import { describe, expect, it } from 'vitest';
import {
  computeSpendingPlan,
  daysInMonth,
  savingsTargetCents,
  scheduledOccurrencesInWindow,
} from '@/lib/engine/spending-plan/plan';
import { isoDate } from '@/lib/dates';

describe('daysInMonth', () => {
  it('is leap-year aware', () => {
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2026, 6)).toBe(30);
    expect(daysInMonth(2026, 1)).toBe(31);
  });
});

describe('savingsTargetCents', () => {
  it('applies bps of income with half-up rounding', () => {
    expect(savingsTargetCents(600000, 1500)).toBe(90000); // 15% of $6,000
    expect(savingsTargetCents(333333, 1500)).toBe(50000); // 49,999.95 → rounds to 50,000
    expect(savingsTargetCents(100001, 1)).toBe(10); // 10.0001 → 10
  });

  it('is 0 for a null/zero target or non-positive income', () => {
    expect(savingsTargetCents(600000, null)).toBe(0);
    expect(savingsTargetCents(600000, 0)).toBe(0);
    expect(savingsTargetCents(0, 1500)).toBe(0);
    expect(savingsTargetCents(-100, 1500)).toBe(0);
  });
});

describe('scheduledOccurrencesInWindow (critic F4 — a biweekly paycheck with two paydays left counts twice)', () => {
  const today = isoDate('2026-06-10');
  const eom = '2026-06-30';

  it('BIWEEKLY with two remaining paydays counts 2; with one counts 1', () => {
    expect(scheduledOccurrencesInWindow('2026-06-12', 'BIWEEKLY', today, eom)).toBe(2); // 12th + 26th
    expect(scheduledOccurrencesInWindow('2026-06-20', 'BIWEEKLY', today, eom)).toBe(1); // 20th only (Jul 4 is out)
  });

  it('WEEKLY steps by 7 days inside the window', () => {
    expect(scheduledOccurrencesInWindow('2026-06-12', 'WEEKLY', today, eom)).toBe(3); // 12, 19, 26
  });

  it('MONTHLY / ANNUAL / IRREGULAR / null contribute at most the one dated occurrence', () => {
    expect(scheduledOccurrencesInWindow('2026-06-12', 'MONTHLY', today, eom)).toBe(1);
    expect(scheduledOccurrencesInWindow('2026-06-12', 'ANNUAL', today, eom)).toBe(1);
    expect(scheduledOccurrencesInWindow('2026-06-12', 'IRREGULAR', today, eom)).toBe(1);
    expect(scheduledOccurrencesInWindow('2026-06-12', null, today, eom)).toBe(1);
  });

  it('a stale (past-dated) anchor is never extrapolated forward, and out-of-month dates count 0', () => {
    expect(scheduledOccurrencesInWindow('2026-06-01', 'BIWEEKLY', today, eom)).toBe(0); // past anchor
    expect(scheduledOccurrencesInWindow('2026-06-10', 'WEEKLY', today, eom)).toBe(0); // today itself is not "still to come"
    expect(scheduledOccurrencesInWindow('2026-07-01', 'MONTHLY', today, eom)).toBe(0); // next month
  });
});

describe('computeSpendingPlan', () => {
  const base = {
    today: isoDate('2026-06-10'),
    expectedIncomeCents: 600000,
    spentSoFarCents: 150000,
    upcomingBillsCents: 120000,
    cardObligationsCents: 0,
    cardObligationsEstimated: false,
    obligationsBeyondMonthCents: 0,
    obligationsBeyondMonthThroughDate: null,
    obligationsBeyondMonthEstimated: false,
    goalContributionsCents: 80000,
    savingsTargetBps: null,
  };

  it('guilt-free = income − cash spent − upcoming bills − card payments − savings; per-day over days left', () => {
    // June (30 days), the 10th → 21 days left incl. today. $6000 income, $1500
    // cash spend, $1200 bills still coming, $800 goal savings → $2500 left, $119/day.
    const p = computeSpendingPlan(base);
    expect(p.plannedSavingsCents).toBe(80000);
    expect(p.savingsSource).toBe('goals');
    expect(p.leftToSpendCents).toBe(250000);
    expect(p.daysLeftInMonth).toBe(21);
    expect(p.perDayCents).toBe(Math.floor(250000 / 21)); // 11904
    expect(p.overspent).toBe(false);
  });

  it('subtracts this-cycle card obligations (the #295 term)', () => {
    const p = computeSpendingPlan({ ...base, cardObligationsCents: 90000 });
    expect(p.leftToSpendCents).toBe(160000); // 250000 − 90000
    expect(p.overspent).toBe(false);
  });

  it('a card obligation alone can drive the plan overspent — the shortfall and this figure now agree in direction', () => {
    const p = computeSpendingPlan({ ...base, cardObligationsCents: 300000 });
    expect(p.leftToSpendCents).toBe(-50000);
    expect(p.overspent).toBe(true);
    expect(p.perDayCents).toBe(0);
  });

  it('savings target is a floor: the larger of goals and income×bps wins, never the sum', () => {
    // 20% of $6,000 = $1,200 > $800 goals → target wins.
    const target = computeSpendingPlan({ ...base, savingsTargetBps: 2000 });
    expect(target.plannedSavingsCents).toBe(120000);
    expect(target.savingsSource).toBe('target');
    expect(target.leftToSpendCents).toBe(210000); // 600000 − 150000 − 120000 − 0 − 120000

    // 10% of $6,000 = $600 < $800 goals → goals win.
    const goals = computeSpendingPlan({ ...base, savingsTargetBps: 1000 });
    expect(goals.plannedSavingsCents).toBe(80000);
    expect(goals.savingsSource).toBe('goals');
    expect(goals.leftToSpendCents).toBe(250000);
  });

  it('unallocatedSavingsCents is the target reserve beyond goals — 0 whenever goals decide (critic F3)', () => {
    const target = computeSpendingPlan({ ...base, savingsTargetBps: 2000 }); // $1,200 target > $800 goals
    expect(target.unallocatedSavingsCents).toBe(40000); // 120000 − 80000
    const goals = computeSpendingPlan({ ...base, savingsTargetBps: 1000 }); // goals win
    expect(goals.unallocatedSavingsCents).toBe(0);
    expect(computeSpendingPlan(base).unallocatedSavingsCents).toBe(0); // no target set
  });

  it('an exact tie between goals and target reads as goals (the concrete label)', () => {
    // 80000 = 600000 × 1333.33…bps has no exact bps; use income 800000 × 1000bps = 80000.
    const p = computeSpendingPlan({ ...base, expectedIncomeCents: 800000, savingsTargetBps: 1000 });
    expect(savingsTargetCents(800000, 1000)).toBe(80000);
    expect(p.plannedSavingsCents).toBe(80000);
    expect(p.savingsSource).toBe('goals');
  });

  it('flags overspending and reports $0/day (never negative per-day)', () => {
    const p = computeSpendingPlan({
      today: isoDate('2026-06-28'),
      expectedIncomeCents: 300000,
      spentSoFarCents: 280000,
      upcomingBillsCents: 60000,
      cardObligationsCents: 0,
      cardObligationsEstimated: false,
      obligationsBeyondMonthCents: 0,
      obligationsBeyondMonthThroughDate: null,
      obligationsBeyondMonthEstimated: false,
      goalContributionsCents: 0,
      savingsTargetBps: null,
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
      cardObligationsCents: 0,
      cardObligationsEstimated: false,
      obligationsBeyondMonthCents: 0,
      obligationsBeyondMonthThroughDate: null,
      obligationsBeyondMonthEstimated: false,
      goalContributionsCents: 0,
      savingsTargetBps: null,
    });
    expect(p.daysLeftInMonth).toBe(1);
    expect(p.perDayCents).toBe(50000);
  });

  it('a zero-income month with a savings target reserves nothing (no fabricated negative savings)', () => {
    const p = computeSpendingPlan({
      today: isoDate('2026-06-10'),
      expectedIncomeCents: 0,
      spentSoFarCents: 20000,
      upcomingBillsCents: 0,
      cardObligationsCents: 0,
      cardObligationsEstimated: false,
      obligationsBeyondMonthCents: 0,
      obligationsBeyondMonthThroughDate: null,
      obligationsBeyondMonthEstimated: false,
      goalContributionsCents: 0,
      savingsTargetBps: 2000,
    });
    expect(p.plannedSavingsCents).toBe(0);
    expect(p.leftToSpendCents).toBe(-20000);
  });
});

/**
 * TASKS L.11(D) — the month's edge. Regression tests for the owner's report of
 * 2026-07-25, "It's worse now", reproduced from his three screenshots to the cent.
 * FAIL-OLD: before this term the same inputs returned $22,254.09 at $3,709.01/day,
 * because all seven of his cards are dated five days past the end of the window.
 */
describe("computeSpendingPlan — card payments dated past the month's edge", () => {
  const OWNER = {
    // His dashboard read: 7 cards, $18,814.14 needed by Wed Aug 5, while the
    // plan beneath it offered the whole month's income, because every one of
    // those cards falls outside July.
    today: isoDate('2026-07-26'),
    expectedIncomeCents: 2225409,
    spentSoFarCents: 0,
    upcomingBillsCents: 0,
    cardObligationsCents: 0,
    cardObligationsEstimated: false,
    goalContributionsCents: 0,
    savingsTargetBps: null,
    obligationsBeyondMonthCents: 1881414,
    obligationsBeyondMonthThroughDate: 'Wed, Aug 5',
    obligationsBeyondMonthEstimated: false,
  };

  it('reserves a dated statement from the moment it is known, not from the 1st of its month', () => {
    const p = computeSpendingPlan(OWNER);
    expect(p.leftToSpendCents).toBe(343995); // 22,254.09 − 18,814.14
    expect(p.reservesBeyondMonth).toBe(true);
    expect(p.daysLeftInMonth).toBe(6);
    expect(p.perDayCents).toBe(57332); // $573.32/day, not $3,709.01
    expect(p.overspent).toBe(false);
  });

  it('changes nothing for the ordinary month, where every card is due inside it', () => {
    const p = computeSpendingPlan({
      ...OWNER,
      obligationsBeyondMonthCents: 0,
      obligationsBeyondMonthThroughDate: null,
      obligationsBeyondMonthEstimated: false,
    });
    expect(p.leftToSpendCents).toBe(2225409);
    expect(p.reservesBeyondMonth).toBe(false);
  });

  it('composes with the in-month term rather than replacing it — neither statement is counted twice', () => {
    const p = computeSpendingPlan({ ...OWNER, cardObligationsCents: 500000 });
    // Two different statements, two lines: 22,254.09 − 5,000 − 18,814.14.
    expect(p.leftToSpendCents).toBe(-156005);
    expect(p.overspent).toBe(true);
    expect(p.perDayCents).toBe(0);
  });

  it('can drive the month overspent, and says so rather than reporting a calm $0.00', () => {
    const p = computeSpendingPlan({ ...OWNER, obligationsBeyondMonthCents: 3000000 });
    expect(p.leftToSpendCents).toBe(-774591);
    expect(p.overspent).toBe(true);
  });
});
