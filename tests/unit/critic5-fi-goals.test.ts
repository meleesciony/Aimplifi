/**
 * HOSTILE CRITIC — Phase 5 (final) probes: FI anchors re-verified by hand,
 * plus the goals→FI delay hand-check from the final review brief.
 * Expected values computed on paper before running (working in comments).
 */
import { describe, expect, it } from 'vitest';
import { fiNumberCents, monthsToFI, opportunityFVCents } from '@/lib/engine/fi/fi';
import { goalFIImpact } from '@/lib/engine/goals';
import { cents } from '@/lib/money';

describe('critic5: §FI anchors, re-verified by hand', () => {
  it('FI number: $60,000/yr at 4.00% SWR → exactly $1,500,000.00', () => {
    // Hand: 6,000,000¢ × 10000/400 = 6,000,000 × 25 = 150,000,000¢.
    expect(fiNumberCents(cents(6000000), 400)).toBe(150000000);
    // 3.50%: 6e6 × 10000/350 = 171,428,571.43 → 171,428,571¢ = $1,714,285.71.
    expect(fiNumberCents(cents(6000000), 350)).toBe(171428571);
  });

  it('years-to-FI anchor 1 (0% return, exact): $1,000/mo to $120,000 → exactly 120 months', () => {
    expect(monthsToFI(cents(0), cents(100000), 0, cents(12000000))).toBe(120);
    // month 119 must NOT suffice: 119 × 1000 = 119,000 < 120,000.
    expect(monthsToFI(cents(0), cents(100000), 0, cents(11900000))).toBe(119);
  });

  it('opportunity-cost FV anchor: $100/mo, 12 mo, 12%/yr nominal → $1,268.25', () => {
    // Hand: 1.01^12 = 1.126825…; (0.126825…)/0.01 = 12.682503; ×10,000¢ = 126,825.03 → 126,825¢.
    expect(opportunityFVCents(cents(10000), 12, 1200)).toBe(126825);
  });
});

describe('critic5: goals → FI delay (final-review hand check)', () => {
  it('$6k goal at $500/mo against a 120-month/0% FI plan → FI in 126 months (delay 6)', () => {
    // Hand: baseline = 120,000/1,000 = 120 months.
    // Goal months = 6,000/500 = 12. While funding: 500/mo × 12 = 6,000 saved.
    // Remaining 114,000 at 1,000/mo = 114 → total 126; delay = 6.
    const r = goalFIImpact({
      portfolioCents: cents(0),
      monthlySavingsCents: cents(100000),
      annualReturnBps: 0,
      fiTargetCents: cents(12000000),
      goalRemainingCents: cents(600000),
      goalMonthlyContributionCents: cents(50000),
    });
    expect(r.monthsToGoal).toBe(12);
    expect(r.monthsToFIBaseline).toBe(120);
    expect(r.monthsToFIWithGoal).toBe(126);
    expect(r.fiDelayMonths).toBe(6);
  });

  it('goal contribution exceeding savings → FI delayed but never crashes; delay honest', () => {
    // Reduced savings floors at 0 while funding (24 months of zero progress),
    // then 120 more → 144, delay 24.
    const r = goalFIImpact({
      portfolioCents: cents(0),
      monthlySavingsCents: cents(100000),
      annualReturnBps: 0,
      fiTargetCents: cents(12000000),
      goalRemainingCents: cents(3600000),
      goalMonthlyContributionCents: cents(150000),
    });
    expect(r.monthsToGoal).toBe(24);
    expect(r.monthsToFIWithGoal).toBe(144);
    expect(r.fiDelayMonths).toBe(24);
  });
});
