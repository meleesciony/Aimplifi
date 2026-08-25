/**
 * P1.4 — income lever pinned to docs/EDGE_CASES.md §Income lever.
 */
import { describe, expect, it } from 'vitest';
import {
  INCOME_LEVER_DEFAULT_RAISE_CENTS,
  incomeLever,
  incomeLeverSliderInitialCents,
  incomeLeverSliderMaxCents,
} from '@/lib/engine/fi/income-lever';
import { monthsToFI } from '@/lib/engine/fi/fi';
import { cents } from '@/lib/money';

describe('incomeLever (EDGE_CASES §Income lever)', () => {
  it('I1: zero-return exact — $12k raise at 20% saves $200/mo, 20 months sooner', () => {
    const cf = incomeLever({
      portfolioCents: cents(0),
      monthlyIncomeCents: cents(500_000),
      monthlySavingsCents: cents(100_000),
      realReturnBps: 0,
      fiTargetCents: cents(12_000_000),
      raiseAnnualCents: 1_200_000,
    });
    expect(cf.rateBps).toBe(2000);
    expect(cf.monthlyRaiseCents).toBe(100_000);
    expect(cf.extraMonthlySavingsCents).toBe(20_000);
    expect(cf.baselineMonths).toBe(120);
    expect(cf.raisedMonths).toBe(100);
    expect(cf.monthsSooner).toBe(20);
    expect(cf.newlyReachable).toBe(false);
    expect(cf.noIncome).toBe(false);
    expect(cf.rateNonPositive).toBe(false);
    expect(cf.alreadyThere).toBe(false);
  });

  it('I2: already at FI — raise does not invent a sooner date', () => {
    const cf = incomeLever({
      portfolioCents: cents(12_000_000),
      monthlyIncomeCents: cents(500_000),
      monthlySavingsCents: cents(100_000),
      realReturnBps: 0,
      fiTargetCents: cents(12_000_000),
      raiseAnnualCents: 1_200_000,
    });
    expect(cf.baselineMonths).toBe(0);
    expect(cf.raisedMonths).toBe(0);
    expect(cf.monthsSooner).toBe(0);
    expect(cf.alreadyThere).toBe(true);
    expect(cf.newlyReachable).toBe(false);
  });

  it('I3: zero raise is a no-op', () => {
    const cf = incomeLever({
      portfolioCents: cents(0),
      monthlyIncomeCents: cents(500_000),
      monthlySavingsCents: cents(100_000),
      realReturnBps: 0,
      fiTargetCents: cents(12_000_000),
      raiseAnnualCents: 0,
    });
    expect(cf.extraMonthlySavingsCents).toBe(0);
    expect(cf.monthlyRaiseCents).toBe(0);
    expect(cf.baselineMonths).toBe(120);
    expect(cf.raisedMonths).toBe(120);
    expect(cf.monthsSooner).toBe(0);
  });

  it('I4: no income — no rate, no extra savings', () => {
    const cf = incomeLever({
      portfolioCents: cents(0),
      monthlyIncomeCents: cents(0),
      monthlySavingsCents: cents(0),
      realReturnBps: 0,
      fiTargetCents: cents(12_000_000),
      raiseAnnualCents: 1_200_000,
    });
    expect(cf.noIncome).toBe(true);
    expect(cf.rateBps).toBeNull();
    expect(cf.extraMonthlySavingsCents).toBe(0);
    expect(cf.monthsSooner).toBe(0);
  });

  it('I5: 0% rate saves none of the raise', () => {
    const cf = incomeLever({
      portfolioCents: cents(0),
      monthlyIncomeCents: cents(500_000),
      monthlySavingsCents: cents(0),
      realReturnBps: 0,
      fiTargetCents: cents(12_000_000),
      raiseAnnualCents: 1_200_000,
    });
    expect(cf.rateBps).toBe(0);
    expect(cf.rateNonPositive).toBe(true);
    expect(cf.extraMonthlySavingsCents).toBe(0);
    expect(cf.monthsSooner).toBe(0);
  });

  it('I6: raise puts a date on the horizon — newlyReachable, no fabricated sooner', () => {
    const cf = incomeLever({
      portfolioCents: cents(0),
      monthlyIncomeCents: cents(900_000),
      monthlySavingsCents: cents(9_000),
      realReturnBps: 0,
      fiTargetCents: cents(12_000_000),
      raiseAnnualCents: 2_400_000,
    });
    expect(cf.rateBps).toBe(100);
    expect(cf.extraMonthlySavingsCents).toBe(2_000);
    expect(cf.baselineMonths).toBeNull();
    expect(cf.raisedMonths).toBe(1091);
    expect(cf.newlyReachable).toBe(true);
    expect(cf.monthsSooner).toBe(0);
  });

  it('I7: $10,000/yr raise at 20% — monthly 833.33, extra 166.67', () => {
    const cf = incomeLever({
      portfolioCents: cents(0),
      monthlyIncomeCents: cents(500_000),
      monthlySavingsCents: cents(100_000),
      realReturnBps: 0,
      fiTargetCents: cents(12_000_000),
      raiseAnnualCents: INCOME_LEVER_DEFAULT_RAISE_CENTS,
    });
    expect(cf.monthlyRaiseCents).toBe(83_333);
    expect(cf.extraMonthlySavingsCents).toBe(16_667);
  });

  it('I8: negative rate is not applied as negative extra savings', () => {
    const cf = incomeLever({
      portfolioCents: cents(0),
      monthlyIncomeCents: cents(500_000),
      monthlySavingsCents: cents(-50_000),
      realReturnBps: 0,
      fiTargetCents: cents(12_000_000),
      raiseAnnualCents: 1_200_000,
    });
    expect(cf.rateBps).toBe(-1000);
    expect(cf.rateNonPositive).toBe(true);
    expect(cf.extraMonthlySavingsCents).toBe(0);
    expect(cf.raisedMonthlySavingsCents).toBe(-50_000);
  });

  it('raised walk equals hand-calling monthsToFI on extra savings', () => {
    const portfolio = cents(14_200_000);
    const savings = cents(50_000);
    const income = cents(800_000);
    const rate = 450;
    const target = cents(150_000_000);
    const cf = incomeLever({
      portfolioCents: portfolio,
      monthlySavingsCents: savings,
      monthlyIncomeCents: income,
      realReturnBps: rate,
      fiTargetCents: target,
      raiseAnnualCents: INCOME_LEVER_DEFAULT_RAISE_CENTS,
    });
    expect(cf.baselineMonths).toBe(monthsToFI(portfolio, savings, rate, target));
    expect(cf.raisedMonths).toBe(
      monthsToFI(portfolio, cf.raisedMonthlySavingsCents, rate, target),
    );
  });

  it('I9: both unreachable — no fabricated sooner', () => {
    const cf = incomeLever({
      portfolioCents: cents(0),
      monthlyIncomeCents: cents(500_000),
      monthlySavingsCents: cents(5_000),
      realReturnBps: 0,
      fiTargetCents: cents(12_000_000),
      raiseAnnualCents: 120_000, // $1,200/yr → $100/mo × 1% = $1 extra; still >1200 mo
    });
    // $50/mo → 2400 mo; $51/mo → 2353 mo; both past the 1200 cap.
    expect(cf.rateBps).toBe(100);
    expect(cf.baselineMonths).toBeNull();
    expect(cf.raisedMonths).toBeNull();
    expect(cf.newlyReachable).toBe(false);
    expect(cf.monthsSooner).toBe(0);
  });

  it('negative raise clamps to 0', () => {
    const cf = incomeLever({
      portfolioCents: cents(0),
      monthlyIncomeCents: cents(500_000),
      monthlySavingsCents: cents(100_000),
      realReturnBps: 0,
      fiTargetCents: cents(12_000_000),
      raiseAnnualCents: -1_000_000,
    });
    expect(cf.raiseAnnualCents).toBe(0);
    expect(cf.monthsSooner).toBe(0);
  });
});

describe('income-lever slider bounds', () => {
  it('ceiling is at least $25k and never above $100k', () => {
    expect(incomeLeverSliderMaxCents(100_000)).toBe(2_500_000); // $1k/mo → floor
    expect(incomeLeverSliderMaxCents(800_000)).toBe(4_800_000); // $8k/mo → half = $48k
    expect(incomeLeverSliderMaxCents(2_000_000)).toBe(10_000_000); // half $120k → cap
  });

  it('initial thumb is $10k unless the ceiling is lower', () => {
    expect(incomeLeverSliderInitialCents(800_000)).toBe(INCOME_LEVER_DEFAULT_RAISE_CENTS);
    expect(incomeLeverSliderInitialCents(0)).toBe(INCOME_LEVER_DEFAULT_RAISE_CENTS);
  });
});
