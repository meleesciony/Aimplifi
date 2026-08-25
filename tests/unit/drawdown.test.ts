/**
 * W.6(d) — drawdown counterfactual pinned to docs/EDGE_CASES.md §Drawdown.
 */
import { describe, expect, it } from 'vitest';
import {
  DRAWDOWN_SHOCK_BPS,
  drawdownCounterfactual,
} from '@/lib/engine/fi/drawdown';
import { monthsToFI } from '@/lib/engine/fi/fi';
import { cents } from '@/lib/money';

describe('drawdownCounterfactual (EDGE_CASES §Drawdown)', () => {
  it('D1: zero-return exact — 30% drop adds 30 months', () => {
    const cf = drawdownCounterfactual({
      portfolioCents: cents(10_000_000),
      monthlySavingsCents: cents(100_000),
      realReturnBps: 0,
      fiTargetCents: cents(12_000_000),
    });
    expect(cf.shockBps).toBe(DRAWDOWN_SHOCK_BPS);
    expect(cf.shockedPortfolioCents).toBe(7_000_000);
    expect(cf.baselineMonths).toBe(20);
    expect(cf.shockedMonths).toBe(50);
    expect(cf.monthsLater).toBe(30);
    expect(cf.newlyUnreachable).toBe(false);
  });

  it('D2: already at FI — shock creates a date that was not needed', () => {
    const cf = drawdownCounterfactual({
      portfolioCents: cents(150_000_000),
      monthlySavingsCents: cents(0),
      realReturnBps: 450,
      fiTargetCents: cents(150_000_000),
    });
    expect(cf.shockedPortfolioCents).toBe(105_000_000);
    expect(cf.baselineMonths).toBe(0);
    expect(cf.shockedMonths).toBe(98);
    expect(cf.monthsLater).toBe(98);
    expect(cf.newlyUnreachable).toBe(false);
  });

  it('D3: pure compounding — EDGE §FI anchor 2 under a 30% drop', () => {
    const cf = drawdownCounterfactual({
      portfolioCents: cents(50_000_000),
      monthlySavingsCents: cents(0),
      realReturnBps: 720,
      fiTargetCents: cents(100_000_000),
    });
    expect(cf.baselineMonths).toBe(120);
    expect(cf.shockedPortfolioCents).toBe(35_000_000);
    expect(cf.shockedMonths).toBe(182);
    expect(cf.monthsLater).toBe(62);
  });

  it('D4: zero portfolio — shock is a no-op', () => {
    const cf = drawdownCounterfactual({
      portfolioCents: cents(0),
      monthlySavingsCents: cents(100_000),
      realReturnBps: 0,
      fiTargetCents: cents(12_000_000),
    });
    expect(cf.shockedPortfolioCents).toBe(0);
    expect(cf.baselineMonths).toBe(120);
    expect(cf.shockedMonths).toBe(120);
    expect(cf.monthsLater).toBe(0);
    expect(cf.newlyUnreachable).toBe(false);
  });

  it('D5: both unreachable — no fabricated delay', () => {
    const cf = drawdownCounterfactual({
      portfolioCents: cents(5_000_000),
      monthlySavingsCents: cents(0),
      realReturnBps: 0,
      fiTargetCents: cents(10_000_000),
    });
    expect(cf.baselineMonths).toBeNull();
    expect(cf.shockedMonths).toBeNull();
    expect(cf.monthsLater).toBe(0);
    expect(cf.newlyUnreachable).toBe(false);
  });

  it('D6: shock makes FI unreachable — newlyUnreachable, no monthsLater', () => {
    const cf = drawdownCounterfactual({
      portfolioCents: cents(10_000_000),
      monthlySavingsCents: cents(0),
      realReturnBps: 0,
      fiTargetCents: cents(10_000_000),
    });
    expect(cf.baselineMonths).toBe(0);
    expect(cf.shockedMonths).toBeNull();
    expect(cf.monthsLater).toBe(0);
    expect(cf.newlyUnreachable).toBe(true);
  });

  it('shocked walk equals hand-calling monthsToFI on 70% portfolio', () => {
    const portfolio = cents(14_200_000);
    const savings = cents(50_000);
    const rate = 450;
    const target = cents(150_000_000);
    const cf = drawdownCounterfactual({
      portfolioCents: portfolio,
      monthlySavingsCents: savings,
      realReturnBps: rate,
      fiTargetCents: target,
    });
    expect(cf.baselineMonths).toBe(monthsToFI(portfolio, savings, rate, target));
    expect(cf.shockedMonths).toBe(
      monthsToFI(cf.shockedPortfolioCents, savings, rate, target),
    );
  });

  it('shockBps 0 leaves the date unchanged', () => {
    const cf = drawdownCounterfactual({
      portfolioCents: cents(10_000_000),
      monthlySavingsCents: cents(100_000),
      realReturnBps: 0,
      fiTargetCents: cents(12_000_000),
      shockBps: 0,
    });
    expect(cf.shockedPortfolioCents).toBe(10_000_000);
    expect(cf.monthsLater).toBe(0);
  });
});
