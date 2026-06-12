/**
 * FI engine — every anchor from docs/EDGE_CASES.md §FI, hand-verified.
 */
import { describe, expect, it } from 'vitest';
import {
  coastFI,
  fiNumberCents,
  geometricMonthlyRate,
  monthsToFI,
  opportunityFVCents,
  savingsRateBps,
} from '@/lib/engine/fi/fi';
import { cents } from '@/lib/money';

describe('FI number = annual expenses × 10000/swrBps', () => {
  it('$60,000/yr at 400 bps → exactly $1,500,000.00', () => {
    expect(fiNumberCents(cents(6_000_000), 400)).toBe(150_000_000);
  });
  it('$60,000/yr at 350 bps → $1,714,285.71 (rounded to the cent)', () => {
    // 6,000,000 × 10000 / 350 = 171,428,571.428… → 171,428,571
    expect(fiNumberCents(cents(6_000_000), 350)).toBe(171_428_571);
  });
});

describe('years to FI (iterative monthly simulation)', () => {
  it('anchor 1 — zero return, exact: $0 + $1,000/mo to $120,000 = exactly 120 months', () => {
    expect(monthsToFI(cents(0), cents(100_000), 0, cents(12_000_000))).toBe(120);
  });
  it('anchor 2 — pure compounding: $500k at 7.2% geometric doubles by month 120', () => {
    // m ≥ 12·ln2/ln1.072 = 119.6 → first month portfolio ≥ $1M is 120
    expect(monthsToFI(cents(50_000_000), cents(0), 720, cents(100_000_000))).toBe(120);
  });
  it('already at the target → 0 months', () => {
    expect(monthsToFI(cents(100), cents(0), 700, cents(100))).toBe(0);
  });
  it('unreachable (no savings, no return) → null', () => {
    expect(monthsToFI(cents(0), cents(0), 0, cents(1))).toBeNull();
  });
  it('geometric monthly rate compounds to exactly the annual rate', () => {
    const i = geometricMonthlyRate(720);
    expect(Math.pow(1 + i, 12)).toBeCloseTo(1.072, 10);
  });
});

describe('Coast FI', () => {
  it('$200k → $1M at 7.2% within 25 years: already Coast FI (needs 23.15 yr)', () => {
    const r = coastFI(cents(20_000_000), cents(100_000_000), 720, 300);
    expect(r.isCoastFI).toBe(true);
    // ln 5 / ln 1.072 = 23.15 yr → 278 months (first month ≥ target)
    expect(r.monthsCompoundingAlone).toBe(278);
  });
  it('$100k → $1M needs 33.1 yr > 25 → NOT Coast FI; reports the required contribution', () => {
    const r = coastFI(cents(10_000_000), cents(100_000_000), 720, 300);
    expect(r.isCoastFI).toBe(false);
    expect(r.monthsCompoundingAlone).toBe(398); // ln 10 / ln 1.072 = 33.16 yr
    expect(r.requiredMonthlyContributionCents).toBeGreaterThan(0);
    // the reported contribution actually reaches the target in time (engine self-consistency)
    const check = monthsToFI(
      cents(10_000_000),
      r.requiredMonthlyContributionCents!,
      720,
      cents(100_000_000),
    );
    expect(check).not.toBeNull();
    expect(check!).toBeLessThanOrEqual(300);
    // and one dollar less per month would NOT
    const tooLittle = monthsToFI(
      cents(10_000_000 ),
      cents(r.requiredMonthlyContributionCents! - 100),
      720,
      cents(100_000_000),
    );
    expect(tooLittle === null || tooLittle > 300).toBe(true);
  });
});

describe('opportunity-cost future value (nominal monthly rate, end-of-month)', () => {
  it('anchor — $100/mo, 12 months, 12%/yr nominal → exactly $1,268.25', () => {
    expect(opportunityFVCents(cents(10_000), 12, 1200)).toBe(126_825);
  });
  it('regression — $189/mo, 25 yr, 7%/yr nominal lands in $153,000–$153,300 and is pinned', () => {
    const fv = opportunityFVCents(cents(18_900), 300, 700);
    expect(fv).toBeGreaterThanOrEqual(15_300_000);
    expect(fv).toBeLessThanOrEqual(15_330_000);
    // pinned exact value, recorded in docs/EDGE_CASES.md §FI
    expect(fv).toBe(15_310_355);
  });
  it('zero rate degenerates to simple sum', () => {
    expect(opportunityFVCents(cents(10_000), 12, 0)).toBe(120_000);
  });
});

describe('savings rate', () => {
  it('income $6,000, expenses $4,200 → 30.00%', () => {
    expect(savingsRateBps(cents(600_000), cents(420_000))).toBe(3000);
  });
  it('no income → null (never a fake 100%)', () => {
    expect(savingsRateBps(cents(0), cents(100))).toBeNull();
  });
});
