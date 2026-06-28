/**
 * Pure SimpleFIN holdings mapper (DECISIONS #124). Known-answer + end-to-end through
 * the portfolio engine. This is the boundary that turns a brokerage feed's
 * decimal-string positions into integer-cents Holding rows; its bugs would silently
 * misreport the /investments breakdown, so it is tested even though the live network
 * is UNVERIFIED. Bounds are pinned identical to server/investments.ts::addHolding.
 */
import { describe, expect, it } from 'vitest';
import { cents } from '@/lib/money';
import { mapSimplefinHoldings } from '@/lib/providers/simplefin-holdings';
import type { SimplefinHolding } from '@/lib/providers/simplefin-map';
import { type Holding, summarizePortfolio } from '@/lib/engine/investments/portfolio';

const h = (over: Partial<SimplefinHolding> & { id: string }): SimplefinHolding => over;

describe('mapSimplefinHoldings — single-position mapping', () => {
  it('maps a clean position: shares, total cost basis, per-share price from market_value ÷ shares', () => {
    const { holdings, skipped } = mapSimplefinHoldings([
      h({ id: 'h1', symbol: 'AAPL', description: 'Apple Inc', shares: '10', cost_basis: '1500.00', market_value: '2000.00' }),
    ]);
    expect(skipped).toBe(0);
    expect(holdings).toHaveLength(1);
    expect(holdings[0]).toEqual({
      symbol: 'AAPL',
      name: 'Apple Inc',
      quantity: 10,
      costBasisCents: 150000, // $1,500.00 total invested
      priceCents: 20000, //      round($2,000.00 ÷ 10) = $20.00/share
    });
  });

  it('uppercases the ticker and trims the name; an empty description → null name', () => {
    const { holdings } = mapSimplefinHoldings([
      h({ id: 'h1', symbol: 'msft', description: '   ', shares: '2', market_value: '700.00' }),
    ]);
    expect(holdings[0].symbol).toBe('MSFT');
    expect(holdings[0].name).toBeNull();
  });

  it('treats market_value as authoritative; cost_basis is best-effort (missing → 0, gainPct null)', () => {
    const { holdings } = mapSimplefinHoldings([h({ id: 'h1', symbol: 'VOO', shares: '3', market_value: '100.00' })]);
    // round(10000 ÷ 3) = round(3333.33) = 3333 → engine marketValue round(3 × 3333) = 9999,
    // a documented sub-cent-per-share reconstruction drift (never touches net worth).
    expect(holdings[0]).toEqual({ symbol: 'VOO', name: null, quantity: 3, costBasisCents: 0, priceCents: 3333 });
  });

  it('tolerates thousands separators and >2 decimals (integer-cent math, no float drift)', () => {
    const { holdings } = mapSimplefinHoldings([
      h({ id: 'h1', symbol: 'SPY', shares: '1,000', cost_basis: '10,000.00', market_value: '25,000.00' }),
    ]);
    expect(holdings[0]).toEqual({ symbol: 'SPY', name: null, quantity: 1000, costBasisCents: 1000000, priceCents: 2500 });
  });

  it('keeps a ticker with an allowed "." (e.g. BRK.B)', () => {
    const { holdings, skipped } = mapSimplefinHoldings([
      h({ id: 'h1', symbol: 'BRK.B', shares: '4', cost_basis: '1200.00', market_value: '1600.00' }),
    ]);
    expect(skipped).toBe(0);
    expect(holdings[0].symbol).toBe('BRK.B');
    expect(holdings[0].priceCents).toBe(40000);
  });
});

describe('mapSimplefinHoldings — un-mappable rows are skipped + counted, never thrown', () => {
  it('skips a position with no usable ticker', () => {
    const r = mapSimplefinHoldings([h({ id: 'h1', shares: '5', market_value: '500.00' })]);
    expect(r.holdings).toHaveLength(0);
    expect(r.skipped).toBe(1);
  });

  it('skips zero / negative / non-numeric share counts', () => {
    const r = mapSimplefinHoldings([
      h({ id: 'a', symbol: 'A', shares: '0', market_value: '10.00' }),
      h({ id: 'b', symbol: 'B', shares: '-3', market_value: '10.00' }),
      h({ id: 'c', symbol: 'C', shares: 'xyz', market_value: '10.00' }),
    ]);
    expect(r.holdings).toHaveLength(0);
    expect(r.skipped).toBe(3);
  });

  it('skips a position we cannot value (missing, garbage, or negative market_value)', () => {
    const r = mapSimplefinHoldings([
      h({ id: 'a', symbol: 'A', shares: '5' }),
      h({ id: 'b', symbol: 'B', shares: '5', market_value: 'abc' }),
      h({ id: 'c', symbol: 'C', shares: '5', market_value: '-100.00' }),
    ]);
    expect(r.holdings).toHaveLength(0);
    expect(r.skipped).toBe(3);
  });

  it('skips an invalid ticker (spaces, illegal chars, or >20 chars)', () => {
    const r = mapSimplefinHoldings([
      h({ id: 'a', symbol: 'BAD SYM', shares: '5', market_value: '10.00' }),
      h({ id: 'b', symbol: 'BAD!', shares: '5', market_value: '10.00' }),
      h({ id: 'c', symbol: 'TOOLONGSYMBOLNAME1234', shares: '5', market_value: '10.00' }), // 21 chars
    ]);
    expect(r.holdings).toHaveLength(0);
    expect(r.skipped).toBe(3);
  });

  it('skips (does not throw) when per-share price overflows the safe-integer range', () => {
    const r = mapSimplefinHoldings([
      h({ id: 'a', symbol: 'OVR', shares: '0.0000000001', market_value: '90000000000000.00' }),
    ]);
    expect(r.holdings).toHaveLength(0);
    expect(r.skipped).toBe(1);
  });

  it('drops only the bad rows and keeps the good ones', () => {
    const r = mapSimplefinHoldings([
      h({ id: 'good', symbol: 'GOOD', shares: '1', cost_basis: '50.00', market_value: '60.00' }),
      h({ id: 'bad', shares: '1', market_value: '60.00' }), // no symbol
    ]);
    expect(r.skipped).toBe(1);
    expect(r.holdings).toHaveLength(1);
    expect(r.holdings[0].symbol).toBe('GOOD');
  });
});

describe('mapSimplefinHoldings — aggregation + ordering', () => {
  it('aggregates same-symbol lots (sums shares + cost + value), case-insensitively', () => {
    const { holdings } = mapSimplefinHoldings([
      h({ id: 'l1', symbol: 'AAPL', shares: '10', cost_basis: '1000.00', market_value: '1500.00' }),
      h({ id: 'l2', symbol: 'aapl', shares: '5', cost_basis: '600.00', market_value: '750.00' }),
    ]);
    expect(holdings).toHaveLength(1);
    expect(holdings[0]).toEqual({
      symbol: 'AAPL',
      name: null,
      quantity: 15, //               10 + 5
      costBasisCents: 160000, //     100000 + 60000
      priceCents: 15000, //          round((150000 + 75000) ÷ 15) = $150.00/share
    });
  });

  it('returns positions ordered by symbol', () => {
    const { holdings } = mapSimplefinHoldings([
      h({ id: '1', symbol: 'ZM', shares: '1', market_value: '70.00' }),
      h({ id: '2', symbol: 'AMD', shares: '1', market_value: '120.00' }),
      h({ id: '3', symbol: 'MSFT', shares: '1', market_value: '400.00' }),
    ]);
    expect(holdings.map((x) => x.symbol)).toEqual(['AMD', 'MSFT', 'ZM']);
  });
});

describe('mapSimplefinHoldings — end-to-end through the portfolio engine', () => {
  it('mapped holdings summarize to the hand-computed portfolio totals', () => {
    const { holdings } = mapSimplefinHoldings([
      h({ id: '1', symbol: 'AAPL', description: 'Apple', shares: '10', cost_basis: '1500.00', market_value: '2000.00' }),
      h({ id: '2', symbol: 'VTI', description: 'Total Market', shares: '20', cost_basis: '4000.00', market_value: '5000.00' }),
    ]);
    const engineHoldings: Holding[] = holdings.map((m) => ({
      symbol: m.symbol,
      name: m.name ?? undefined,
      quantity: m.quantity,
      costBasisCents: cents(m.costBasisCents),
      priceCents: cents(m.priceCents),
    }));
    const p = summarizePortfolio(engineHoldings);
    // AAPL: MV 200000, basis 150000, gain +50000 | VTI: MV 500000, basis 400000, gain +100000
    expect(p.totalMarketValueCents).toBe(700000);
    expect(p.totalCostBasisCents).toBe(550000);
    expect(p.totalUnrealizedGainCents).toBe(150000);
    expect(p.positions.find((x) => x.symbol === 'AAPL')!.unrealizedGainCents).toBe(50000);
    expect(p.positions.find((x) => x.symbol === 'VTI')!.marketValueCents).toBe(500000);
  });

  it('an all-skipped feed yields an empty (zeroed) portfolio, not a throw', () => {
    const { holdings, skipped } = mapSimplefinHoldings([
      h({ id: '1', shares: '5', market_value: '100.00' }), // no symbol
      h({ id: '2', symbol: 'X', shares: '0', market_value: '100.00' }), // zero shares
    ]);
    expect(skipped).toBe(2);
    const p = summarizePortfolio([]);
    expect(holdings).toHaveLength(0);
    expect(p.totalMarketValueCents).toBe(0);
    expect(p.totalGainPct).toBeNull();
  });
});

describe('mapSimplefinHoldings — edge cases (#124 critic P2)', () => {
  it('allows a per-share price that rounds to zero for a sub-cent-per-share position', () => {
    const { holdings, skipped } = mapSimplefinHoldings([
      h({ id: '1', symbol: 'PENNY', shares: '1000000', market_value: '0.01' }),
    ]);
    expect(skipped).toBe(0);
    expect(holdings[0]).toEqual({ symbol: 'PENNY', name: null, quantity: 1000000, costBasisCents: 0, priceCents: 0 });
  });

  it('truncates an over-long description to the name cap', () => {
    const { holdings } = mapSimplefinHoldings([
      h({ id: '1', symbol: 'X', description: 'A'.repeat(150), shares: '1', market_value: '10.00' }),
    ]);
    expect(holdings[0].name).toHaveLength(120);
  });

  it('rejects a non-ASCII (unicode) or empty ticker (matches addHolding charset)', () => {
    const r = mapSimplefinHoldings([
      h({ id: '1', symbol: '苹果', shares: '1', market_value: '10.00' }),
      h({ id: '2', symbol: '', shares: '1', market_value: '10.00' }),
    ]);
    expect(r.holdings).toHaveLength(0);
    expect(r.skipped).toBe(2);
  });

  it('aggregation name is deterministic: the first non-null description wins', () => {
    const { holdings } = mapSimplefinHoldings([
      h({ id: '1', symbol: 'AAPL', shares: '1', market_value: '100.00' }), // no description
      h({ id: '2', symbol: 'AAPL', description: 'Apple Inc', shares: '1', market_value: '100.00' }),
      h({ id: '3', symbol: 'AAPL', description: 'Apple Computer', shares: '1', market_value: '100.00' }),
    ]);
    expect(holdings).toHaveLength(1);
    expect(holdings[0].name).toBe('Apple Inc'); // first non-null, regardless of later rows
    expect(holdings[0].quantity).toBe(3);
  });
});
