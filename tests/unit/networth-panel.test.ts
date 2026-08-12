import { describe, expect, it } from 'vitest';
import { netWorthLiveBasis, netWorthPointBasis } from '@/lib/engine/networth/panel';
import { cents } from '@/lib/money';
import { isoDate } from '@/lib/dates';

describe('net-worth drilldown basis sentences (O.20d/O.20f)', () => {
  it('month-end point basis embeds the figure and date, and says "month-end"', () => {
    const basis = netWorthPointBasis(cents(120_00), isoDate('2026-04-30'));
    expect(basis.length).toBeGreaterThanOrEqual(2); // NON-EMPTY by type; locked again here
    expect(basis[0]).toBe(
      'The $120.00 is the sum of every account\'s month-end balance on Thu, Apr 30 — assets minus liabilities.',
    );
    expect(basis[1]).toContain('snapshots');
    expect(basis[1]).toContain('no snapshot then is not in it');
  });

  it('mid-month point basis reads "balance on", never "month-end" (O.20f P2-g)', () => {
    // The seed's `back === 0` snapshot is dated `asOf` — `npx prisma db seed
    // -- --asOf 2026-05-15` with DEMO_TODAY=2026-06-10 produces exactly one
    // mid-month point; calling a mid-month snapshot a "month-end balance"
    // would be the O.18c lie the composer exists to prevent.
    const basis = netWorthPointBasis(cents(120_00), isoDate('2026-05-15'));
    expect(basis[0]).toBe(
      'The $120.00 is the sum of every account\'s balance on Fri, May 15 — assets minus liabilities.',
    );
    expect(basis[0]).not.toContain('month-end');
  });

  it('live basis embeds the rendered figure and names manual items explicitly', () => {
    const basis = netWorthLiveBasis(cents(500_250_00));
    expect(basis[0]).toBe(
      'The $500,250.00 is today\'s live balance across every account — manual items included.',
    );
    expect(basis[1]).toContain('headline above');
    expect(basis[1]).toContain('not a month-end snapshot');
  });

  it('both tuples are non-empty (the BreakdownPanel contract)', () => {
    expect(netWorthPointBasis(cents(1), isoDate('2026-01-31')).length).toBeGreaterThan(0);
    expect(netWorthLiveBasis(cents(1)).length).toBeGreaterThan(0);
  });
});
