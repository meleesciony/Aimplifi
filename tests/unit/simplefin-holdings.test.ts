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

/** Map a mapper output row into the engine's Holding shape, carrying the authoritative
 *  total the engine now consumes — the real provider→server→engine wiring (DECISIONS #129). */
const toEngine = (m: {
  symbol: string;
  name: string | null;
  quantity: number;
  costBasisCents: number;
  priceCents: number;
  marketValueCents: number;
}): Holding => ({
  symbol: m.symbol,
  name: m.name ?? undefined,
  quantity: m.quantity,
  costBasisCents: cents(m.costBasisCents),
  priceCents: cents(m.priceCents),
  marketValueCents: cents(m.marketValueCents),
});

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
      costBasisCents: 150000, //    $1,500.00 total invested
      priceCents: 20000, //         round($2,000.00 ÷ 10) = $20.00/share
      marketValueCents: 200000, //  $2,000.00 authoritative total (kept verbatim)
    });
  });

  it('uppercases the ticker and trims the name; an empty description → null name', () => {
    const { holdings } = mapSimplefinHoldings([
      h({ id: 'h1', symbol: 'msft', description: '   ', shares: '2', market_value: '700.00' }),
    ]);
    expect(holdings[0].symbol).toBe('MSFT');
    expect(holdings[0].name).toBeNull();
  });

  it('keeps market_value as the authoritative total; cost_basis best-effort (missing → 0, gainPct null)', () => {
    const { holdings } = mapSimplefinHoldings([h({ id: 'h1', symbol: 'VOO', shares: '3', market_value: '100.00' })]);
    // priceCents = round(10000 ÷ 3) = 3333 (display only); the $100.00 total is kept as
    // marketValueCents, so the engine reports exactly 10000 — NOT the round(3 × 3333) =
    // 9999 reconstruction the #124 per-share-only model produced (DECISIONS #129).
    expect(holdings[0]).toEqual({ symbol: 'VOO', name: null, quantity: 3, costBasisCents: 0, priceCents: 3333, marketValueCents: 10000 });
  });

  it('tolerates thousands separators and >2 decimals (integer-cent math, no float drift)', () => {
    const { holdings } = mapSimplefinHoldings([
      h({ id: 'h1', symbol: 'SPY', shares: '1,000', cost_basis: '10,000.00', market_value: '25,000.00' }),
    ]);
    expect(holdings[0]).toEqual({ symbol: 'SPY', name: null, quantity: 1000, costBasisCents: 1000000, priceCents: 2500, marketValueCents: 2500000 });
  });

  it('keeps a ticker with an allowed "." (e.g. BRK.B)', () => {
    const { holdings, skipped } = mapSimplefinHoldings([
      h({ id: 'h1', symbol: 'BRK.B', shares: '4', cost_basis: '1200.00', market_value: '1600.00' }),
    ]);
    expect(skipped).toBe(0);
    expect(holdings[0].symbol).toBe('BRK.B');
    expect(holdings[0].priceCents).toBe(40000);
  });

  it('keeps slash share-class + crypto-pair tickers now that the shared rule allows "/" (#127 tail)', () => {
    const { holdings, skipped } = mapSimplefinHoldings([
      h({ id: 'h1', symbol: 'BRK/B', shares: '4', market_value: '1600.00' }),
      h({ id: 'h2', symbol: 'btc/usd', shares: '2', market_value: '120000.00' }),
    ]);
    expect(skipped).toBe(0); // both were DROPPED before the "/" widening
    expect(holdings.map((x) => x.symbol).sort()).toEqual(['BRK/B', 'BTC/USD']);
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
      marketValueCents: 225000, //   150000 + 75000 — authoritative totals summed
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
    const p = summarizePortfolio(holdings.map(toEngine));
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
    // priceCents rounds to 0, but the $0.01 total is preserved as marketValueCents so the
    // position does NOT vanish to $0 in the engine (DECISIONS #129; end-to-end below).
    expect(holdings[0]).toEqual({ symbol: 'PENNY', name: null, quantity: 1000000, costBasisCents: 0, priceCents: 0, marketValueCents: 1 });
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

// The #129 fix: the engine reports SimpleFIN's authoritative TOTAL, not a value
// reconstructed from a rounded per-share price. These end-to-end cases would FAIL under
// the #124 per-share-only model (penny lot → $0, sub-cent lot → 9999), proving the fix.
describe('mapSimplefinHoldings — authoritative total survives to the engine (DECISIONS #129)', () => {
  it('a penny lot (rounds to $0/share) keeps its real value instead of vanishing to $0', () => {
    const { holdings } = mapSimplefinHoldings([h({ id: '1', symbol: 'PENNY', shares: '1000000', market_value: '0.01' })]);
    expect(holdings[0].marketValueCents).toBe(1);
    const p = summarizePortfolio(holdings.map(toEngine));
    // Per-share model: round(1000000 × round(1/1000000)) = round(1000000 × 0) = 0 (WRONG).
    // Authoritative model: 1¢ exactly. The position no longer disappears.
    expect(p.totalMarketValueCents).toBe(1);
    expect(p.positions[0].marketValueCents).toBe(1);
  });

  it('a sub-dollar high-quantity lot reports the real total, not ~2× from price rounding', () => {
    // 10,000 shares, $50.00 total → $0.005/share. round(0.5)=1¢/share → per-share model
    // would report round(10000 × 1) = 10000 = $100.00 (2× the truth). Authoritative = $50.
    const { holdings } = mapSimplefinHoldings([h({ id: '1', symbol: 'SUB', shares: '10000', market_value: '50.00' })]);
    expect(holdings[0]).toMatchObject({ priceCents: 1, marketValueCents: 5000 });
    const p = summarizePortfolio(holdings.map(toEngine));
    expect(p.totalMarketValueCents).toBe(5000); // $50.00, not $100.00
  });

  it('the VOO sub-cent case reports exactly $100.00 (the #124 9999 drift is gone)', () => {
    const { holdings } = mapSimplefinHoldings([h({ id: '1', symbol: 'VOO', shares: '3', cost_basis: '90.00', market_value: '100.00' })]);
    const p = summarizePortfolio(holdings.map(toEngine));
    expect(p.totalMarketValueCents).toBe(10000); // exact; per-share model gave 9999
    expect(p.positions[0].unrealizedGainCents).toBe(1000); // $100.00 − $90.00, gain off the real total
  });

  it('mixed feed: each position carries its own authoritative total into the portfolio', () => {
    const { holdings } = mapSimplefinHoldings([
      h({ id: '1', symbol: 'PENNY', shares: '1000000', market_value: '0.01' }), // → 1¢
      h({ id: '2', symbol: 'AAPL', description: 'Apple', shares: '10', cost_basis: '1500.00', market_value: '2000.00' }), // → $2,000
    ]);
    const p = summarizePortfolio(holdings.map(toEngine));
    expect(p.totalMarketValueCents).toBe(200001); // $2,000.00 + 1¢, both exact
    expect(p.positions.find((x) => x.symbol === 'PENNY')!.marketValueCents).toBe(1);
    expect(p.positions.find((x) => x.symbol === 'AAPL')!.marketValueCents).toBe(200000);
  });
});

// The DB Int column ceils a persisted cents value at $21,474,836.47 on Postgres. A total
// above it would overflow the column and be SILENTLY swallowed by the reconcile's per-row
// catch (vanishing from /investments in production; SQLite CI can't see it). So an oversize
// position must be SKIPPED + COUNTED at the mapper, not stored (critic P1-1, DECISIONS #129).
describe('mapSimplefinHoldings — totals bounded to the DB Int ceiling (critic P1-1)', () => {
  it('skips + counts a position whose TOTAL exceeds the 32-bit Int ceiling even though its per-share price fits', () => {
    // 1,000 sh @ $22,000,000 total → $22,000/share (fits), but the $2.2B total does NOT.
    // Under #124 only the per-share price was persisted, so this synced; now the total is
    // stored, so it is skipped explicitly instead of overflowing + being swallowed.
    const r = mapSimplefinHoldings([h({ id: '1', symbol: 'BIGCO', shares: '1000', market_value: '22000000.00' })]);
    expect(r.holdings).toHaveLength(0);
    expect(r.skipped).toBe(1);
  });

  it('keeps a position exactly AT the ceiling and skips one cent OVER (precise boundary)', () => {
    const atCeiling = mapSimplefinHoldings([h({ id: '1', symbol: 'MAXX', shares: '1', market_value: '21474836.47' })]);
    expect(atCeiling.holdings).toHaveLength(1);
    expect(atCeiling.holdings[0].marketValueCents).toBe(2_147_483_647); // exactly the Int32 max
    const overCeiling = mapSimplefinHoldings([h({ id: '1', symbol: 'OVER', shares: '1', market_value: '21474836.48' })]);
    expect(overCeiling.holdings).toHaveLength(0);
    expect(overCeiling.skipped).toBe(1);
  });

  it('drops only the over-ceiling position and keeps the rest of the feed', () => {
    const r = mapSimplefinHoldings([
      h({ id: '1', symbol: 'BIGCO', shares: '1000', market_value: '22000000.00' }), // over → skip
      h({ id: '2', symbol: 'AAPL', shares: '10', cost_basis: '1500.00', market_value: '2000.00' }), // kept
    ]);
    expect(r.skipped).toBe(1);
    expect(r.holdings.map((x) => x.symbol)).toEqual(['AAPL']);
  });
});

// residual 20 (DECISIONS #156): the app does NO FX — a position reported in a non-USD
// currency must NOT sum into the USD /investments total at a fake 1:1. Such a lot is
// WITHHELD and counted as withheldNonUsd (kept DISTINCT from skipped: a foreign lot is
// working-as-intended, not an un-mappable glitch). Uses the SAME isSupportedCurrency rule
// as the account-level guard (DECISIONS #135) — null/omitted → USD (golden-safe).
describe('mapSimplefinHoldings — non-USD positions are withheld (DECISIONS #156, residual 20)', () => {
  it('withholds a EUR lot (not summed at 1:1), counted as withheldNonUsd, NOT skipped', () => {
    const { holdings, skipped, withheldNonUsd } = mapSimplefinHoldings([
      h({ id: 'e', symbol: 'EUEQ', shares: '10', market_value: '1000.00', currency: 'EUR' }),
    ]);
    expect(holdings).toHaveLength(0);
    expect(withheldNonUsd).toBe(1);
    expect(skipped).toBe(0); // a foreign lot is working-as-intended, never an error
  });

  it('an OMITTED currency is assumed USD and kept (golden-safe: demo/CSV/manual carry none)', () => {
    const { holdings, withheldNonUsd } = mapSimplefinHoldings([
      h({ id: 'a', symbol: 'AAPL', shares: '10', market_value: '2000.00' }),
    ]);
    expect(holdings).toHaveLength(1);
    expect(holdings[0].marketValueCents).toBe(200000);
    expect(withheldNonUsd).toBe(0);
  });

  it("keeps an explicit 'USD'/'usd' currency (canonicalizes to USD)", () => {
    const { holdings, withheldNonUsd } = mapSimplefinHoldings([
      h({ id: 'u1', symbol: 'VTI', shares: '2', market_value: '400.00', currency: 'USD' }),
      h({ id: 'u2', symbol: 'SPY', shares: '1', market_value: '500.00', currency: 'usd' }),
    ]);
    expect(holdings.map((x) => x.symbol)).toEqual(['SPY', 'VTI']);
    expect(withheldNonUsd).toBe(0);
  });

  it('mixed feed: withholds the EUR lot, keeps the USD lot untouched', () => {
    const { holdings, skipped, withheldNonUsd } = mapSimplefinHoldings([
      h({ id: 'us', symbol: 'VTI', shares: '20', cost_basis: '4000.00', market_value: '5000.00' }),
      h({ id: 'eu', symbol: 'EUEQ', shares: '10', market_value: '1000.00', currency: 'EUR' }),
    ]);
    expect(holdings).toHaveLength(1);
    expect(holdings[0]).toEqual({ symbol: 'VTI', name: null, quantity: 20, costBasisCents: 400000, priceCents: 25000, marketValueCents: 500000 });
    expect(withheldNonUsd).toBe(1);
    expect(skipped).toBe(0);
  });

  it('withholds PER ROW before aggregation: a EUR lot of a symbol that also has a USD lot drops only the EUR lot', () => {
    const { holdings, withheldNonUsd } = mapSimplefinHoldings([
      h({ id: 'usd', symbol: 'AAPL', shares: '10', market_value: '2000.00', currency: 'USD' }),
      h({ id: 'eur', symbol: 'AAPL', shares: '5', market_value: '1000.00', currency: 'EUR' }),
    ]);
    expect(holdings).toHaveLength(1);
    // Only the USD lot survives — the EUR lot never joins the aggregate (no 1:1 blending).
    expect(holdings[0]).toMatchObject({ symbol: 'AAPL', quantity: 10, marketValueCents: 200000, priceCents: 20000 });
    expect(withheldNonUsd).toBe(1);
  });

  it('currency check WINS over un-mappability: a non-USD row with no symbol is withheld, not skipped', () => {
    const { holdings, skipped, withheldNonUsd } = mapSimplefinHoldings([
      h({ id: 'x', shares: '5', market_value: '500.00', currency: 'GBP' }), // no symbol AND non-USD
    ]);
    expect(holdings).toHaveLength(0);
    expect(withheldNonUsd).toBe(1);
    expect(skipped).toBe(0);
  });

  // Predicate boundary — this codebase uses the ACCOUNT-consistent rule (isSupportedCurrency):
  // anything that isn't null/USD is withheld, INCLUDING a crypto/non-ISO URL, a numeric code,
  // or any opaque token. This is deliberate: SimpleFIN expresses non-ISO/crypto currencies as a
  // URL, so a narrower "ISO-only" predicate would LEAK exactly those at a wrong 1:1 — the silent
  // corruption the guard exists to prevent. (To narrow to ISO-only, the owner flips isNonUsdHolding
  // in one line; these pins would then move to "kept".)
  it('withholds crypto/non-ISO URL, 3-letter crypto, and opaque tokens (account-consistent rule)', () => {
    const { holdings, withheldNonUsd, skipped } = mapSimplefinHoldings([
      h({ id: 'url', symbol: 'BITO', shares: '1', market_value: '50.00', currency: 'https://mysimplefin.org/currency/btc' }),
      h({ id: 'btc', symbol: 'BTCX', shares: '1', market_value: '60000.00', currency: 'BTC' }),
      h({ id: 'num', symbol: 'NUMC', shares: '1', market_value: '10.00', currency: '978' }), // EUR numeric code
    ]);
    expect(holdings).toHaveLength(0);
    expect(withheldNonUsd).toBe(3);
    expect(skipped).toBe(0);
  });
});
