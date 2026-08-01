/**
 * Spending Plan engine known-answer tests (DECISIONS #66; #295 reframe; L.22
 * pattern re-spec, owner instruction 2026-07-26). Hand-verified to the cent.
 *
 * The owner's formula (2026-08-01): guilt-free = pattern income − savings % −
 * fixed & recurring expenses. Card obligations are settlement of spend, not a
 * plan term. The locks here are mostly about what is NOT in the number: this
 * month's received income, remaining-occurrence counts, discretionary spending,
 * card payments, and the per-day framing.
 */
import { describe, expect, it } from 'vitest';
import {
  computeSpendingPlan,
  daysInMonth,
  monthlyRateCents,
  savingsTargetCents,
  scheduledOccurrencesBetween,
  type SpendingPlanInput,
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

describe('scheduledOccurrencesBetween — longer windows with the REAL stale gate (L.22 money critic P1-1)', () => {
  const today = isoDate('2026-06-10');
  const eom = '2026-06-30';
  // In-month form: windowStart === today (the old scheduledOccurrencesInWindow shape).
  const inMonth = (nextDate: string, cadence: string | null) =>
    scheduledOccurrencesBetween(nextDate, cadence, today, today, eom);

  it('BIWEEKLY with two remaining paydays counts 2; with one counts 1', () => {
    expect(inMonth('2026-06-12', 'BIWEEKLY')).toBe(2);
    expect(inMonth('2026-06-20', 'BIWEEKLY')).toBe(1);
  });

  it('WEEKLY steps by 7 days inside the window', () => {
    expect(inMonth('2026-06-12', 'WEEKLY')).toBe(3);
  });

  it('MONTHLY / ANNUAL / IRREGULAR / null contribute at most the one dated occurrence within one month', () => {
    expect(inMonth('2026-06-12', 'MONTHLY')).toBe(1);
    expect(inMonth('2026-06-12', 'ANNUAL')).toBe(1);
    expect(inMonth('2026-06-12', 'IRREGULAR')).toBe(1);
    expect(inMonth('2026-06-12', null)).toBe(1);
  });

  it('a stale (past-dated) anchor is never extrapolated forward, and out-of-month dates count 0', () => {
    expect(inMonth('2026-06-01', 'BIWEEKLY')).toBe(0);
    expect(inMonth('2026-06-10', 'WEEKLY')).toBe(0);
    expect(inMonth('2026-07-01', 'MONTHLY')).toBe(0);
  });

  it('a LIVE anchor before the window is stepped forward into it — the executed critic case', () => {
    // Anchor 2026-06-12 BIWEEKLY, real today 2026-06-10, window (2026-06-30, 2026-08-05]:
    // occurrences 07-10 and 07-24 — the old call counted 0 and reserved a full statement
    // against income it could not see.
    expect(scheduledOccurrencesBetween('2026-06-12', 'BIWEEKLY', today, '2026-06-30', '2026-08-05')).toBe(2);
    // WEEKLY: 07-03, 07-10, 07-17, 07-24, 07-31 = 5
    expect(scheduledOccurrencesBetween('2026-06-12', 'WEEKLY', today, '2026-06-30', '2026-08-05')).toBe(5);
  });

  it('the stale gate is the REAL today, never the window start', () => {
    expect(scheduledOccurrencesBetween('2026-06-08', 'BIWEEKLY', today, '2026-06-30', '2026-08-05')).toBe(0);
    // An anchor inside the window needs no stepping (the L.11(D) locked shapes are unchanged).
    expect(scheduledOccurrencesBetween('2026-08-01', 'MONTHLY', today, '2026-06-30', '2026-08-05')).toBe(1);
  });

  it('MONTHLY steps by clamped calendar months across the boundary', () => {
    // Anchor 06-15 monthly, window (06-30, 08-31]: 07-15 and 08-15 (not 08-31).
    expect(scheduledOccurrencesBetween('2026-06-15', 'MONTHLY', today, '2026-06-30', '2026-08-31')).toBe(2);
    // Clamped chain: anchor 01-31 monthly steps 02-28 → 03-28 → 04-28 (addMonthsClamped never
    // returns to the 31st after a short month — a recorded bound, not a bug in the count).
    expect(scheduledOccurrencesBetween('2026-01-31', 'MONTHLY', isoDate('2026-01-10'), '2026-01-31', '2026-04-30')).toBe(3);
    // …and the drift gap is honest: ending the window Mar 30 sees the Mar 28 occurrence,
    // though the "true" month-end date (Mar 31) lands after it.
    expect(scheduledOccurrencesBetween('2026-01-31', 'MONTHLY', isoDate('2026-01-10'), '2026-01-31', '2026-03-30')).toBe(2);
  });

  it('IRREGULAR / null contribute the one dated occurrence only when it falls inside', () => {
    expect(scheduledOccurrencesBetween('2026-07-04', 'IRREGULAR', today, '2026-06-30', '2026-08-05')).toBe(1);
    expect(scheduledOccurrencesBetween('2026-06-20', 'IRREGULAR', today, '2026-06-30', '2026-08-05')).toBe(0);
    expect(scheduledOccurrencesBetween('2026-09-01', null, today, '2026-06-30', '2026-08-05')).toBe(0);
  });
});

describe('monthlyRateCents — the pattern rate', () => {
  it('normalizes each cadence to a monthly rate, half-up rounded', () => {
    expect(monthlyRateCents(10000, 'WEEKLY')).toBe(Math.round((10000 * 52) / 12)); // 43333
    expect(monthlyRateCents(10000, 'BIWEEKLY')).toBe(Math.round((10000 * 26) / 12)); // 21667
    expect(monthlyRateCents(120000, 'ANNUAL')).toBe(10000); // an annual bill costs every month
    expect(monthlyRateCents(250000, 'MONTHLY')).toBe(250000);
  });

  it('IRREGULAR / null count at face ×1 — the safe direction, never understated fixed costs', () => {
    expect(monthlyRateCents(9999, 'IRREGULAR')).toBe(9999);
    expect(monthlyRateCents(9999, null)).toBe(9999);
  });
});

function input(over: Partial<SpendingPlanInput>): SpendingPlanInput {
  return {
    today: isoDate('2026-07-26'),
    trailingMonthlyIncomeCents: [],
    scheduledIncome: [],
    scheduledFixed: [],
    cardObligationsCents: 0,
    cardObligationsEstimated: false,
    obligationsBeyondMonthCents: 0,
    obligationsBeyondMonthThroughDate: null,
    obligationsBeyondMonthEstimated: false,
    goalContributionsCents: 0,
    savingsTargetBps: null,
    ...over,
  };
}

describe('computeSpendingPlan — the L.22 pattern model', () => {
  it('income is the MEDIAN of up to the last 3 complete months — a one-time spike touches no month but its own', () => {
    // THE owner-case lock: a $18,000 one-time inflow in June does not inflate the pattern.
    const p = computeSpendingPlan(input({ trailingMonthlyIncomeCents: [490000, 490000, 1800000] }));
    expect(p.patternIncomeCents).toBe(490000);
    expect(p.incomeBasis).toBe('trailing-median');
    expect(p.incomeMonths).toBe(3);
    expect(p.leftToSpendCents).toBe(490000);
  });

  it('fewer than 3 months medians what exists (2 months average, half-up; 1 month is itself)', () => {
    expect(computeSpendingPlan(input({ trailingMonthlyIncomeCents: [490001, 490002] })).patternIncomeCents).toBe(490002);
    // (490001 + 490002) / 2 = 490001.5 → Math.round → 490002
    expect(computeSpendingPlan(input({ trailingMonthlyIncomeCents: [525000] })).patternIncomeCents).toBe(525000);
    expect(computeSpendingPlan(input({ trailingMonthlyIncomeCents: [525000] })).incomeMonths).toBe(1);
  });

  it('only the last 3 months are read', () => {
    const p = computeSpendingPlan(input({ trailingMonthlyIncomeCents: [999999, 400000, 500000, 600000] }));
    expect(p.patternIncomeCents).toBe(500000); // median of [400000, 500000, 600000]; the 999999 is out of window
    expect(p.incomeMonths).toBe(3);
  });

  it('falls back to detected income series at a monthly rate when no complete month exists', () => {
    const p = computeSpendingPlan(
      input({
        scheduledIncome: [
          { amountCents: 212500, cadence: 'BIWEEKLY' }, // 212500 × 26/12 = 460416.67 → 460417
          { amountCents: 50000, cadence: 'MONTHLY' },
        ],
      }),
    );
    expect(p.patternIncomeCents).toBe(460417 + 50000);
    expect(p.incomeBasis).toBe('detected-series');
    expect(p.incomeMonths).toBe(0);
  });

  it('with neither history nor series, income is 0 and basis says so — nothing is invented', () => {
    const p = computeSpendingPlan(input({}));
    expect(p.patternIncomeCents).toBe(0);
    expect(p.incomeBasis).toBe('none');
    expect(p.leftToSpendCents).toBe(0);
    expect(p.overspent).toBe(false);
  });

  it('guilt-free = pattern income − fixed − savings; card payments and discretionary are never subtracted', () => {
    // $6,000 pattern income; fixed: $250/week streaming (25000×52/12=108333) + $1,200/yr
    // insurance (120000/12=10000) + $2,200 rent = 338333; cards $900 ignored; goals $800.
    const p = computeSpendingPlan(
      input({
        trailingMonthlyIncomeCents: [600000, 600000, 600000],
        scheduledFixed: [
          { amountCents: -25000, cadence: 'WEEKLY' },
          { amountCents: -120000, cadence: 'ANNUAL' },
          { amountCents: -220000, cadence: 'MONTHLY' },
        ],
        cardObligationsCents: 90000,
        goalContributionsCents: 80000,
      }),
    );
    expect(p.fixedExpensesCents).toBe(108333 + 10000 + 220000);
    expect(p.cardObligationsCents).toBe(90000); // still carried for cash-needed disclosures
    expect(p.leftToSpendCents).toBe(600000 - 338333 - 80000);
    expect(p.overspent).toBe(false);
  });

  it('a card obligation alone does NOT drive the plan overspent — cards settle spend, they are not a cost class', () => {
    const p = computeSpendingPlan(
      input({ trailingMonthlyIncomeCents: [600000], cardObligationsCents: 700000 }),
    );
    expect(p.leftToSpendCents).toBe(600000);
    expect(p.overspent).toBe(false);
    expect(p.cardObligationsCents).toBe(700000);
  });

  it('savings target is a floor: the larger of goals and income×bps wins, never the sum', () => {
    const target = computeSpendingPlan(
      input({ trailingMonthlyIncomeCents: [600000], goalContributionsCents: 80000, savingsTargetBps: 2000 }),
    );
    expect(target.plannedSavingsCents).toBe(120000); // 20% of $6,000 > $800 goals
    expect(target.savingsSource).toBe('target');
    expect(target.unallocatedSavingsCents).toBe(40000);
    expect(target.leftToSpendCents).toBe(480000); // 600000 − 120000

    const goals = computeSpendingPlan(
      input({ trailingMonthlyIncomeCents: [600000], goalContributionsCents: 80000, savingsTargetBps: 1000 }),
    );
    expect(goals.plannedSavingsCents).toBe(80000);
    expect(goals.savingsSource).toBe('goals');
    expect(goals.unallocatedSavingsCents).toBe(0);
    expect(goals.leftToSpendCents).toBe(520000);
  });

  it('an exact tie between goals and target reads as goals (the concrete label)', () => {
    const p = computeSpendingPlan(
      input({ trailingMonthlyIncomeCents: [800000], goalContributionsCents: 80000, savingsTargetBps: 1000 }),
    );
    expect(savingsTargetCents(800000, 1000)).toBe(80000);
    expect(p.savingsSource).toBe('goals');
  });

  it('a zero-income pattern with a savings target reserves nothing (no fabricated negative savings)', () => {
    const p = computeSpendingPlan(input({ savingsTargetBps: 2000, scheduledFixed: [{ amountCents: -20000, cadence: 'MONTHLY' }] }));
    expect(p.plannedSavingsCents).toBe(0);
    expect(p.leftToSpendCents).toBe(-20000);
    expect(p.overspent).toBe(true);
  });
});

/**
 * Owner 2026-08-01 — card payments (including L.11(D) beyond-month) are carried
 * for cash-needed / disclosures but never subtract from guilt-free.
 */
describe("computeSpendingPlan — card payments do not reduce guilt-free", () => {
  const OWNER = input({
    trailingMonthlyIncomeCents: [650000, 640000, 645000],
    obligationsBeyondMonthCents: 1881414,
    obligationsBeyondMonthThroughDate: 'Wed, Aug 5',
  });

  it('still carries the beyond-month obligation, but guilt-free ignores it', () => {
    const p = computeSpendingPlan(OWNER);
    expect(p.patternIncomeCents).toBe(645000);
    expect(p.obligationsBeyondMonthCents).toBe(1881414);
    expect(p.reservesBeyondMonth).toBe(true);
    expect(p.leftToSpendCents).toBe(645000);
    expect(p.overspent).toBe(false);
  });

  it('changes nothing for the ordinary month, where every card is due inside it', () => {
    const p = computeSpendingPlan(input({ trailingMonthlyIncomeCents: [645000] }));
    expect(p.leftToSpendCents).toBe(645000);
    expect(p.reservesBeyondMonth).toBe(false);
  });

  it('in-month card dues likewise leave guilt-free equal to pattern income', () => {
    const p = computeSpendingPlan({ ...OWNER, cardObligationsCents: 500000 });
    expect(p.cardObligationsCents).toBe(500000);
    expect(p.leftToSpendCents).toBe(645000);
    expect(p.overspent).toBe(false);
  });
});
