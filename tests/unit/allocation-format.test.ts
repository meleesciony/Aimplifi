import { describe, expect, it } from 'vitest';
import { allocationPercent } from '@/components/finance/allocation-format';

describe('allocationPercent (O.20f P2-a/b)', () => {
  it('exactly zero renders "0" — a $0.00 position IS 0%, not a rounding artifact', () => {
    expect(allocationPercent(0)).toBe('0');
  });

  it('a positive sub-0.05% position renders "<0.1", never "0.0%" — the critic case: $3.00 in a $1,000,000.00 portfolio', () => {
    expect(allocationPercent(0.000003)).toBe('<0.1');
    expect(allocationPercent(0.00003)).toBe('<0.1');
  });

  it('a rounded-whole percent renders whole — decided on the ROUNDED side, not IEEE754 residue', () => {
    // 0.29 × 100 === 28.999999999999996; Number.isInteger is false, and deciding
    // on the raw residue is exactly the bug this module replaces.
    expect(allocationPercent(0.29)).toBe('29');
    // The exact 50/29/14/7 split the O.20d-FU critic named: 0.14 × 100 is
    // 14.000000000000002 — the other direction of the same residue.
    expect(allocationPercent(0.5)).toBe('50');
    expect(allocationPercent(0.14)).toBe('14');
    expect(allocationPercent(0.07)).toBe('7');
  });

  it('otherwise renders one decimal, ROUNDED', () => {
    expect(allocationPercent(0.294)).toBe('29.4');
    expect(allocationPercent(0.2949)).toBe('29.5'); // rounds up
    expect(allocationPercent(0.001)).toBe('0.1'); // 0.1% is real and must show
  });

  it('the demo-split smoke case (NVDA 34%)', () => {
    expect(allocationPercent(0.34)).toBe('34');
  });
});
