/**
 * Investments engine known-answer suite (DECISIONS #77).
 * Every expected value is hand-derived. XIRR multi-flow cases assert the DEFINING
 * property (NPV at the solved rate ≈ 0) rather than a hand-solved polynomial root.
 */
import { describe, expect, it } from 'vitest';
import {
  type DatedFlow,
  type Holding,
  isPerShareApproximate,
  linkReturns,
  summarizePortfolio,
  timeWeightedReturn,
  valuePosition,
  xirr,
} from '@/lib/engine/investments/portfolio';
import { cents } from '@/lib/money';
import { daysBetween, isoDate } from '@/lib/dates';

const h = (o: Partial<Holding> & { symbol: string }): Holding => ({
  quantity: 0,
  costBasisCents: cents(0),
  priceCents: cents(0),
  ...o,
});

describe('valuePosition — market value, unrealized gain, gain %', () => {
  it('10 shares @ $150, cost $1,200 → MV $1,500, gain $300 (+25%)', () => {
    const p = valuePosition(h({ symbol: 'VOO', quantity: 10, priceCents: cents(15000), costBasisCents: cents(120000) }));
    expect(p.marketValueCents).toBe(150000);
    expect(p.unrealizedGainCents).toBe(30000);
    expect(p.gainPct).toBeCloseTo(0.25, 10);
  });

  it('fractional shares round half-away-from-zero ONCE: 2.5 @ $33.33 → $83.33', () => {
    const p = valuePosition(h({ symbol: 'FRAC', quantity: 2.5, priceCents: cents(3333), costBasisCents: cents(8000) }));
    expect(p.marketValueCents).toBe(8333); // round(8332.5) = 8333
    expect(p.unrealizedGainCents).toBe(333);
  });

  it('a loss is reported as a negative gain', () => {
    const p = valuePosition(h({ symbol: 'DOWN', quantity: 4, priceCents: cents(2500), costBasisCents: cents(12000) }));
    expect(p.marketValueCents).toBe(10000); // 4 × $25
    expect(p.unrealizedGainCents).toBe(-2000);
    expect(p.gainPct).toBeCloseTo(-2000 / 12000, 10);
  });

  it('zero cost basis → gain % is null (undefined return), not Infinity', () => {
    const p = valuePosition(h({ symbol: 'GIFT', quantity: 1, priceCents: cents(5000), costBasisCents: cents(0) }));
    expect(p.marketValueCents).toBe(5000);
    expect(p.gainPct).toBeNull();
  });

  it('fails loud (no silent mis-round) when the value exceeds safe-integer range', () => {
    expect(() =>
      valuePosition(h({ symbol: 'BIG', quantity: 1e15, priceCents: cents(100), costBasisCents: cents(0) })),
    ).toThrow(/exceeds safe range/);
  });
});

describe('valuePosition — authoritative total when the source supplies one (DECISIONS #129)', () => {
  it('uses marketValueCents verbatim, NOT round(quantity × priceCents)', () => {
    // 1,000,000 shares whose rounded per-share price is $0 (a penny lot), but the feed's
    // authoritative total is 1¢. Per-share derivation would report $0 — the bug #5 fixes.
    const p = valuePosition(h({ symbol: 'PENNY', quantity: 1000000, priceCents: cents(0), costBasisCents: cents(0), marketValueCents: cents(1) }));
    expect(p.marketValueCents).toBe(1); // authoritative, not round(1000000 × 0) = 0
    expect(p.priceCents).toBe(0); //       the per-share figure is still surfaced for display
  });

  it('gain and gain% are computed off the authoritative total', () => {
    const p = valuePosition(h({ symbol: 'X', quantity: 3, priceCents: cents(3333), costBasisCents: cents(9000), marketValueCents: cents(10000) }));
    expect(p.marketValueCents).toBe(10000); // $100.00 total, not round(3 × 3333) = 9999
    expect(p.unrealizedGainCents).toBe(1000); // 10000 − 9000
    expect(p.gainPct).toBeCloseTo(1000 / 9000, 10);
  });

  it('an explicit zero total is honored (distinguishes 0 from "absent", not a falsy bug)', () => {
    const p = valuePosition(h({ symbol: 'ZERO', quantity: 5, priceCents: cents(2000), costBasisCents: cents(1000), marketValueCents: cents(0) }));
    expect(p.marketValueCents).toBe(0); // feed says the position is worth $0 → honored
    expect(p.unrealizedGainCents).toBe(-1000);
  });

  it('an authoritative total bypasses the derive-path overflow guard (never reached)', () => {
    // quantity × priceCents would overflow, but we never multiply — the total is supplied.
    const p = valuePosition(h({ symbol: 'OK', quantity: 1e15, priceCents: cents(100), costBasisCents: cents(0), marketValueCents: cents(500000) }));
    expect(p.marketValueCents).toBe(500000);
  });

  it('fails loud (located) on a negative authoritative total — self-validating for any caller (critic ENG-1)', () => {
    // cents() allows negatives (a loss is a negative Cents), so a bad caller could pass one;
    // the engine guards it with a symbol-located throw rather than a silent negative weight.
    expect(() =>
      valuePosition(h({ symbol: 'NEG', quantity: 1, priceCents: cents(0), costBasisCents: cents(0), marketValueCents: cents(-5) })),
    ).toThrow(/NEG authoritative market value/);
  });

  it('fails loud on a non-integer authoritative total (bypassing the branded constructor)', () => {
    expect(() =>
      valuePosition(h({ symbol: 'FRC', quantity: 1, priceCents: cents(0), costBasisCents: cents(0), marketValueCents: 1.5 as ReturnType<typeof cents> })),
    ).toThrow(/not a non-negative safe integer/);
  });
});

describe('isPerShareApproximate — marks a per-share price that can’t rebuild the authoritative total (DECISIONS #129)', () => {
  it('false for a derived (manual) position — round(qty × price) IS the total by construction', () => {
    const p = valuePosition(h({ symbol: 'CLEAN', quantity: 10, priceCents: cents(15000), costBasisCents: cents(0) }));
    expect(isPerShareApproximate(p)).toBe(false);
  });

  it('false for an authoritative total that reconciles exactly (whole-cent lot)', () => {
    const p = valuePosition(h({ symbol: 'AAPL', quantity: 10, priceCents: cents(20000), costBasisCents: cents(0), marketValueCents: cents(200000) }));
    expect(isPerShareApproximate(p)).toBe(false); // round(10 × 20000) = 200000 = total
  });

  it('true for a sub-dollar lot whose rounded per-share does NOT rebuild the total', () => {
    // 10,000 sh, $50.00 total → $0.005/share shown as $0.01; round(10000 × 1) = 10000 ≠ 5000.
    const p = valuePosition(h({ symbol: 'SUB', quantity: 10000, priceCents: cents(1), costBasisCents: cents(0), marketValueCents: cents(5000) }));
    expect(isPerShareApproximate(p)).toBe(true);
  });

  it('true for the penny lot (price rounds to $0 but the position is worth 1¢)', () => {
    const p = valuePosition(h({ symbol: 'PENNY', quantity: 1000000, priceCents: cents(0), costBasisCents: cents(0), marketValueCents: cents(1) }));
    expect(isPerShareApproximate(p)).toBe(true);
  });
});

describe('summarizePortfolio — authoritative + derived positions mix correctly (DECISIONS #129)', () => {
  it('totals and weights use each position’s authoritative total when present', () => {
    const port = summarizePortfolio([
      h({ symbol: 'PENNY', quantity: 1000000, priceCents: cents(0), costBasisCents: cents(0), marketValueCents: cents(1) }), // MV 1 (auth)
      h({ symbol: 'BND', quantity: 5, priceCents: cents(20000), costBasisCents: cents(90000) }), //                            MV 100000 (derived)
    ]);
    expect(port.totalMarketValueCents).toBe(100001); // 1 + 100000 — the penny lot is not lost
    expect(port.positions.find((p) => p.symbol === 'PENNY')!.weight).toBeCloseTo(1 / 100001, 12);
    expect(port.positions.find((p) => p.symbol === 'BND')!.weight).toBeCloseTo(100000 / 100001, 12);
  });
});

describe('summarizePortfolio — totals + allocation weights', () => {
  it('two positions: totals add up and weights sum to 1', () => {
    const port = summarizePortfolio([
      h({ symbol: 'VOO', quantity: 10, priceCents: cents(15000), costBasisCents: cents(120000) }), // MV 150000
      h({ symbol: 'BND', quantity: 5, priceCents: cents(20000), costBasisCents: cents(90000) }), //  MV 100000
    ]);
    expect(port.totalMarketValueCents).toBe(250000);
    expect(port.totalCostBasisCents).toBe(210000);
    expect(port.totalUnrealizedGainCents).toBe(40000);
    expect(port.totalGainPct).toBeCloseTo(40000 / 210000, 10);
    expect(port.positions.find((p) => p.symbol === 'VOO')!.weight).toBeCloseTo(0.6, 10);
    expect(port.positions.find((p) => p.symbol === 'BND')!.weight).toBeCloseTo(0.4, 10);
    expect(port.positions.reduce((s, p) => s + p.weight, 0)).toBeCloseTo(1, 10);
  });

  it('empty portfolio → all zeros, null gain %, no divide-by-zero', () => {
    const port = summarizePortfolio([]);
    expect(port.totalMarketValueCents).toBe(0);
    expect(port.totalCostBasisCents).toBe(0);
    expect(port.totalUnrealizedGainCents).toBe(0);
    expect(port.totalGainPct).toBeNull();
    expect(port.positions).toHaveLength(0);
  });
});

describe('timeWeightedReturn — removes cash-flow timing', () => {
  it('linkReturns geometrically chains: [+10%, +10%] → 21%', () => {
    expect(linkReturns([0.1, 0.1])).toBeCloseTo(0.21, 10);
  });

  it('TWR of +10% then (deposit) +10% = 21%, independent of the deposit size', () => {
    // $100 → $110 (10%); deposit to $120; $120 → $132 (10%). TWR = 1.1×1.1 − 1.
    expect(
      timeWeightedReturn([
        { startValueCents: 10000, endValueCents: 11000 },
        { startValueCents: 12000, endValueCents: 13200 },
      ]),
    ).toBeCloseTo(0.21, 10);
  });

  it('a losing sub-period links correctly: +10% then −50% → −45%', () => {
    expect(
      timeWeightedReturn([
        { startValueCents: 10000, endValueCents: 11000 },
        { startValueCents: 12000, endValueCents: 6000 },
      ]),
    ).toBeCloseTo(-0.45, 10);
  });

  it('a period with zero start value contributes 0% (no divide-by-zero)', () => {
    expect(timeWeightedReturn([{ startValueCents: 0, endValueCents: 5000 }])).toBe(0);
  });
});

describe('xirr — money-weighted (dollar-weighted) return', () => {
  const flow = (date: string, amountCents: number): DatedFlow => ({ date: isoDate(date), amountCents });

  it('invest $1,000, get $1,100 a year later → 10%', () => {
    const r = xirr([flow('2025-01-01', -100000), flow('2026-01-01', 110000)]); // 365 days
    expect(r).toBeCloseTo(0.1, 6);
  });

  it('invest $1,000, get $1,210 two years later → 10%/yr (geometric)', () => {
    const r = xirr([flow('2025-01-01', -100000), flow('2027-01-01', 121000)]); // 730 days
    expect(r).toBeCloseTo(0.1, 6);
  });

  it('a loss: $1,000 → $900 in a year → −10%', () => {
    const r = xirr([flow('2025-01-01', -100000), flow('2026-01-01', 90000)]);
    expect(r).toBeCloseTo(-0.1, 6);
  });

  it('multi-flow: the solved rate makes NPV ≈ 0 (the defining property of IRR)', () => {
    const flows = [
      flow('2025-01-01', -1000000), // invest $10,000
      flow('2025-07-01', -500000), //  add    $5,000 mid-year
      flow('2026-01-01', 1650000), //  worth  $16,500 at year end
    ];
    const r = xirr(flows)!;
    expect(r).not.toBeNull();
    const t0 = flows[0].date;
    const npv = flows.reduce((s, f) => s + f.amountCents / Math.pow(1 + r, daysBetween(t0, f.date) / 365), 0);
    expect(Math.abs(npv)).toBeLessThan(1); // < 1 cent of $16,500
    expect(r).toBeGreaterThan(0); // net gainer overall
  });

  it('returns null when flows are all the same sign (no solution)', () => {
    expect(xirr([flow('2025-01-01', -100000), flow('2026-01-01', -50000)])).toBeNull();
    expect(xirr([flow('2025-01-01', 100000), flow('2026-01-01', 50000)])).toBeNull();
  });

  it('returns null with fewer than two flows', () => {
    expect(xirr([flow('2025-01-01', -100000)])).toBeNull();
    expect(xirr([])).toBeNull();
  });

  it('resolves a DEEP loss (root near −1): invest $1,000, recover $1 → ≈ −99.9%', () => {
    const r = xirr([flow('2025-01-01', -100000), flow('2026-01-01', 100)]);
    expect(r).not.toBeNull();
    expect(r!).toBeCloseTo(-0.999, 3); // (1 + r) = 100 / 100000 = 0.001
  });

  it('is order-independent: unsorted flows give the same rate', () => {
    const ordered = xirr([flow('2025-01-01', -100000), flow('2026-01-01', 110000)])!;
    const shuffled = xirr([flow('2026-01-01', 110000), flow('2025-01-01', -100000)])!;
    expect(shuffled).toBeCloseTo(ordered, 9);
    expect(shuffled).toBeCloseTo(0.1, 6);
  });

  it('NEVER returns a non-root: on a non-conventional flow, null or a true root only', () => {
    const flows = [flow('2025-01-01', -100000), flow('2026-01-01', 250000), flow('2027-01-01', -160000)];
    const r = xirr(flows); // two sign changes — multiple IRRs may exist
    if (r !== null) {
      const t0 = flows[0].date;
      const npv = flows.reduce((s, f) => s + f.amountCents / Math.pow(1 + r, daysBetween(t0, f.date) / 365), 0);
      expect(Math.abs(npv)).toBeLessThan(1); // a returned rate is always a genuine root
    } else {
      expect(r).toBeNull();
    }
  });
});
