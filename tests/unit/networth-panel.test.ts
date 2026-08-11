import { describe, expect, it } from 'vitest';
import { netWorthLiveBasis, netWorthMonthEndBasis } from '@/lib/engine/networth/panel';
import { cents } from '@/lib/money';

describe('net-worth drilldown basis sentences (O.20d)', () => {
  it('month-end basis embeds the rendered figure and date, and names its snapshot source', () => {
    const basis = netWorthMonthEndBasis(cents(120_00), 'Apr 30, 2026');
    expect(basis.length).toBeGreaterThanOrEqual(2); // NON-EMPTY by type; locked again here
    expect(basis[0]).toBe(
      'The $120.00 is the sum of every account\'s month-end balance on Apr 30, 2026 — assets minus liabilities.',
    );
    expect(basis[1]).toContain('snapshots');
    expect(basis[1]).toContain('no snapshot then is not in it');
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
    expect(netWorthMonthEndBasis(cents(1), 'x').length).toBeGreaterThan(0);
    expect(netWorthLiveBasis(cents(1)).length).toBeGreaterThan(0);
  });
});
