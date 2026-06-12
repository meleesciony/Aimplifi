/**
 * HOSTILE CRITIC scratch probes — Phase 3 cycle 1.
 * Every expectation hand-computed BEFORE running (worked values in comments).
 * Probes that document a degenerate-but-present behavior say so explicitly —
 * they pin what the code DOES so the critic report can judge it.
 */
import { describe, expect, it } from 'vitest';
import { coastFI, fiNumberCents, monthsToFI, opportunityFVCents, savingsRateBps } from '@/lib/engine/fi/fi';
import { detectLifestyleCreep, hoursOfWork, monthsOfRunway } from '@/lib/engine/fi/insights';
import { cents } from '@/lib/money';
import { isoDate } from '@/lib/dates';

describe('attack: savings rate when expenses > income', () => {
  it('income $4,000, expenses $5,000 → −25.00% (hand: (4000−5000)/4000 = −0.25)', () => {
    expect(savingsRateBps(cents(400_000), cents(500_000))).toBe(-2500);
  });
});

describe('attack: monthsToFI with NEGATIVE monthly savings', () => {
  it('drain exceeds growth → null, no crash (hand: $100k at 7% grows ~$565/mo < $600 drain)', () => {
    expect(monthsToFI(cents(10_000_000), cents(-60_000), 700, cents(20_000_000))).toBeNull();
  });
  it('portfolio driven negative keeps compounding negative → null, no crash', () => {
    expect(monthsToFI(cents(100), cents(-1_000), 700, cents(1_000))).toBeNull();
  });
});

describe('attack: coastFI edges', () => {
  it('already at target → 0 months alone, isCoastFI, no required contribution', () => {
    const r = coastFI(cents(1_000), cents(1_000), 700, 300);
    expect(r.isCoastFI).toBe(true);
    expect(r.monthsCompoundingAlone).toBe(0);
    expect(r.requiredMonthlyContributionCents).toBeNull();
  });
  it('target 0 with portfolio 0 → trivially coast (0 ≥ 0)', () => {
    const r = coastFI(cents(0), cents(0), 700, 300);
    expect(r.isCoastFI).toBe(true);
  });
  it('DEGENERATE: monthsToTarget = 0 with portfolio < target → binary search maxes out at fiTarget/month, which still cannot reach in 0 months', () => {
    const target = cents(1_000_000);
    const r = coastFI(cents(0), target, 700, 0);
    expect(r.isCoastFI).toBe(false);
    // hand: monthsToFI(_, anything, _, target>portfolio) is always ≥ 1 > 0,
    // so the search never finds a feasible mid → lo climbs to hi = target.
    expect(r.requiredMonthlyContributionCents).toBe(target);
    // self-inconsistency: the "required" contribution does NOT meet the deadline
    const months = monthsToFI(cents(0), r.requiredMonthlyContributionCents!, 700, target);
    expect(months).toBeGreaterThan(0);
  });
});

describe('attack: opportunity FV degenerate horizons', () => {
  it('0 months → $0 (hand: (1+i)^0 − 1 = 0)', () => {
    expect(opportunityFVCents(cents(10_000), 0, 1200)).toBe(0);
  });
  it('0 rate, 0 months → $0', () => {
    expect(opportunityFVCents(cents(10_000), 0, 0)).toBe(0);
  });
});

describe('attack: creep detector with insufficient data', () => {
  it('no transactions at all → not flagged, zeros, no NaN at the default window', () => {
    const r = detectLifestyleCreep([], isoDate('2026-06-10'));
    expect(r.flagged).toBe(false);
    expect(r.spendGrowthBps).toBe(0);
    expect(r.incomeGrowthBps).toBe(0);
    expect(r.monthlyDiscretionaryCents).toHaveLength(6);
  });
  it('1 full month of data → not flagged (first-half median 0 → growth pinned to 0)', () => {
    const r = detectLifestyleCreep(
      [
        { date: '2026-05-15', amountCents: -5_000, rawDescriptor: 'STARBUCKS 123', accountId: 'a', isTransfer: false, status: 'POSTED' },
        { date: '2026-05-20', amountCents: 600_000, rawDescriptor: 'ACH DEPOSIT ACME PAYROLL', accountId: 'a', isTransfer: false, status: 'POSTED' },
      ],
      isoDate('2026-06-10'),
    );
    expect(r.flagged).toBe(false);
    expect(Number.isNaN(r.spendGrowthBps)).toBe(false);
  });
  it('DEGENERATE: exported API with windowMonths=1 produces NaN growth (median of an empty half)', () => {
    const r = detectLifestyleCreep([], isoDate('2026-06-10'), 1);
    expect(Number.isNaN(r.spendGrowthBps)).toBe(true); // pinned hazard — unreachable from coach.ts (fixed 6)
    expect(r.flagged).toBe(false); // NaN comparison saves the verdict
  });
});

describe('attack: runway and life-energy division hazards', () => {
  it('0 expenses → Infinity (UI would render "Infinity months")', () => {
    expect(monthsOfRunway(cents(500_000), cents(0))).toBe(Infinity);
  });
  it('0 wage → 0 hours, no division blow-up', () => {
    expect(hoursOfWork(cents(19_000), 0)).toBe(0);
  });
});

describe('attack: brand-new user (no expense history) — FI number degenerates', () => {
  it('annual expenses $0 → FI number $0 → "0 months to FI" (degenerate, pinned)', () => {
    const fi = fiNumberCents(cents(0), 400);
    expect(fi).toBe(0);
    expect(monthsToFI(cents(0), cents(0), 700, fi)).toBe(0);
  });
});
