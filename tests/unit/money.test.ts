import { describe, expect, it } from 'vitest';
import {
  cents,
  centsFromDollarString,
  floorAtZero,
  formatCents,
  maxCents,
  minCents,
  mulBps,
  roundHalfAwayFromZero,
  roundUpToNext50Dollars,
  subCents,
  sumCents,
} from '@/lib/money';

describe('cents constructor', () => {
  it('accepts integers including negatives and zero', () => {
    expect(cents(0)).toBe(0);
    expect(cents(-50)).toBe(-50);
    expect(cents(123456)).toBe(123456);
  });
  it('rejects non-integers (floats are forbidden for money)', () => {
    expect(() => cents(1.5)).toThrow();
    expect(() => cents(NaN)).toThrow();
    expect(() => cents(Infinity)).toThrow();
  });
});

describe('rounding rule: round-half-away-from-zero (docs/EDGE_CASES.md §Money)', () => {
  it('rounds 0.5 up and -0.5 down (away from zero)', () => {
    expect(roundHalfAwayFromZero(0.5)).toBe(1);
    expect(roundHalfAwayFromZero(-0.5)).toBe(-1);
    expect(roundHalfAwayFromZero(2.5)).toBe(3);
    expect(roundHalfAwayFromZero(-2.5)).toBe(-3);
  });
  it('rounds below-half toward zero', () => {
    expect(roundHalfAwayFromZero(1.4)).toBe(1);
    expect(roundHalfAwayFromZero(-1.4)).toBe(-1);
  });
  it('handles the EDGE_CASES style case deterministically: 296500 × 0.005 / 12', () => {
    // 296500 * 0.005 / 12 = 123.5416̄ → 124? No: 123.541… rounds to 124 only if ≥ .5; it is .541 → 124.
    expect(roundHalfAwayFromZero((296500 * 0.005) / 12)).toBe(124);
  });
});

describe('mulBps — basis-point interest math', () => {
  it('computes EDGE_CASES §I: carried $2,965.00 at 2400 bps / 12 → $59.30', () => {
    expect(mulBps(cents(296500), 2400, 12)).toBe(5930);
  });
  it('rounds half away from zero at the materialized step', () => {
    // 100 * 50 / 10000 = 0.5 → 1 cent
    expect(mulBps(cents(100), 50)).toBe(1);
    expect(mulBps(cents(-100), 50)).toBe(-1);
  });
});

describe('sum/sub/floor/min/max', () => {
  it('sums signed cents (outflow negative, inflow positive)', () => {
    expect(sumCents([cents(-2500), cents(1000), cents(1500)])).toBe(0);
  });
  it('floors negative remainders at zero (overpayment never creates negative due)', () => {
    expect(floorAtZero(subCents(cents(50000), cents(60000)))).toBe(0);
    expect(floorAtZero(subCents(cents(100000), cents(40000)))).toBe(60000);
  });
  it('min/max', () => {
    expect(minCents(cents(1), cents(2))).toBe(1);
    expect(maxCents(cents(1), cents(2))).toBe(2);
  });
});

describe('roundUpToNext50Dollars — transfer recommendation rounding', () => {
  it('rounds $1,412.33 up to $1,450.00 (EDGE_CASES §A)', () => {
    expect(roundUpToNext50Dollars(cents(141233))).toBe(145000);
  });
  it('leaves exact multiples alone ($300.00 → $300.00, EDGE_CASES §H)', () => {
    expect(roundUpToNext50Dollars(cents(30000))).toBe(30000);
  });
  it('rounds $1,012.33 up to $1,050.00 (seed headline)', () => {
    expect(roundUpToNext50Dollars(cents(101233))).toBe(105000);
  });
  it('returns 0 for non-positive amounts', () => {
    expect(roundUpToNext50Dollars(cents(0))).toBe(0);
    expect(roundUpToNext50Dollars(cents(-100))).toBe(0);
  });
});

describe('centsFromDollarString — exact parsing, no float math', () => {
  it('parses dollars and cents exactly', () => {
    expect(centsFromDollarString('2712.33')).toBe(271233);
    expect(centsFromDollarString('-250')).toBe(-25000);
    expect(centsFromDollarString('0.5')).toBe(50);
    expect(centsFromDollarString('17.99')).toBe(1799);
  });
  it('rejects malformed input', () => {
    expect(() => centsFromDollarString('12.345')).toThrow();
    expect(() => centsFromDollarString('$12')).toThrow();
    expect(() => centsFromDollarString('')).toThrow();
  });
});

describe('formatCents — UI boundary only', () => {
  it('formats positive, negative, zero', () => {
    expect(formatCents(cents(481233))).toBe('$4,812.33');
    expect(formatCents(cents(-50))).toBe('-$0.50');
    expect(formatCents(cents(0))).toBe('$0.00');
    expect(formatCents(cents(5))).toBe('$0.05');
  });
  it('supports explicit plus sign for inflows', () => {
    expect(formatCents(cents(245000), { signDisplay: 'always' })).toBe('+$2,450.00');
  });
});
