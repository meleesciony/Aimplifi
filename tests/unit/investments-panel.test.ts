import { describe, expect, it } from 'vitest';
import { allocationPanelBasis, allocationSegments } from '@/lib/engine/investments/panel';
import { cents } from '@/lib/money';

const acct = (
  accountId: string,
  accountName: string,
  positions: { symbol: string; marketValueCents: number }[],
) => ({
  accountId,
  accountName,
  portfolio: { positions: positions.map((p) => ({ ...p, marketValueCents: cents(p.marketValueCents) })) },
});

describe('allocationSegments (O.20d)', () => {
  it('groups by symbol and carries the per-account rows that sum to each segment', () => {
    const segments = allocationSegments({
      accounts: [
        acct('a1', 'Brokerage', [
          { symbol: 'VTI', marketValueCents: 30000 },
          { symbol: 'AAPL', marketValueCents: 20000 },
        ]),
        acct('a2', 'Roth IRA', [
          { symbol: 'VTI', marketValueCents: 50000 },
        ]),
      ],
    });
    expect(segments.map((s) => s.symbol)).toEqual(['VTI', 'AAPL']); // first-appearance order
    const vti = segments.find((s) => s.symbol === 'VTI')!;
    // The O.20d invariant: Σ rows === segment value, by construction.
    expect(vti.marketValueCents).toBe(80000);
    expect(vti.rows.reduce((s, r) => s + r.amountCents, 0)).toBe(vti.marketValueCents);
    expect(vti.accountCount).toBe(2);
    expect(vti.rows.map((r) => r.label)).toEqual(['Brokerage', 'Roth IRA']);
    expect(vti.rows.map((r) => r.amountCents)).toEqual([30000, 50000]);
    // Weights are share of the whole portfolio.
    const aapl = segments.find((s) => s.symbol === 'AAPL')!;
    expect(aapl.weight).toBeCloseTo(20000 / 100000, 10);
    expect(vti.weight).toBeCloseTo(0.8, 10);
    // Rows are BreakdownRow-shaped and keyed uniquely.
    expect(new Set(vti.rows.map((r) => r.key)).size).toBe(2);
    expect(vti.rows[0].transactionId).toBeNull();
  });

  it('a symbol held twice in one account still sums and keys uniquely', () => {
    const segments = allocationSegments({
      accounts: [
        acct('a1', 'Brokerage', [
          { symbol: 'VTI', marketValueCents: 30000 },
          { symbol: 'VTI', marketValueCents: 10000 },
        ]),
      ],
    });
    expect(segments).toHaveLength(1);
    const vti = segments[0];
    expect(vti.marketValueCents).toBe(40000);
    expect(vti.accountCount).toBe(1);
    expect(new Set(vti.rows.map((r) => r.key)).size).toBe(2);
    expect(vti.rows.reduce((s, r) => s + r.amountCents, 0)).toBe(vti.marketValueCents);
  });

  it('empty input yields no segments (no division by zero)', () => {
    expect(allocationSegments({ accounts: [] })).toEqual([]);
  });

  it('carries the display name when a position has one', () => {
    const segments = allocationSegments({
      accounts: [acct('a1', 'Brokerage', [{ symbol: 'VTI', marketValueCents: 100 }])],
    });
    // The test fixture type omits `name`; a superset input with it passes through.
    expect(segments[0].name).toBeNull();
    const withName = allocationSegments({
      accounts: [
        {
          accountId: 'a1',
          accountName: 'Brokerage',
          portfolio: { positions: [{ symbol: 'VTI', name: 'Vanguard Total Stock', marketValueCents: cents(100) }] },
        },
      ],
    });
    expect(withName[0].name).toBe('Vanguard Total Stock');
  });
});

describe('allocationPanelBasis (O.20d)', () => {
  it('embeds the rendered figure, the symbol, and the account count', () => {
    const basis = allocationPanelBasis('VTI', cents(80000), 2);
    expect(basis[0]).toBe(
      'The $800.00 is the market value of VTI across 2 accounts — from your holdings.',
    );
    expect(basis.length).toBeGreaterThanOrEqual(3);
    expect(basis[1]).toContain('quantity × price per share');
    expect(basis[2]).toContain('source of truth for net worth');
  });
  it('singular account wording', () => {
    expect(allocationPanelBasis('AAPL', cents(100), 1)[0]).toContain('across one account');
  });
});
