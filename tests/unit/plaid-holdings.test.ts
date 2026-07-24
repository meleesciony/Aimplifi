/**
 * Pure mapper tests for Plaid /investments/holdings/get → Pulse Holding rows (TASKS 4.3).
 * The network call is UNVERIFIED (no sandbox creds), so this — the boundary where Plaid's
 * float-dollar positions become integer cents — is the labeled coverage. Mirrors
 * simplefin-holdings.test.ts: authoritative total kept verbatim, per-share derived from the
 * total (NOT Plaid's institution_price), cost basis best-effort, cash sweeps dropped, non-USD
 * withheld, un-mappable rows skipped (never thrown), same-symbol lots aggregated.
 */
import { describe, expect, it } from 'vitest';
import {
  type PlaidHolding,
  type PlaidSecurity,
  mapPlaidHoldings,
} from '@/lib/providers/plaid-holdings';

// Realistic securities: an equity, an ETF, a cash sweep, a tickerless mutual fund, a crypto.
const SECURITIES: PlaidSecurity[] = [
  { security_id: 'sec-aapl', ticker_symbol: 'AAPL', name: 'Apple Inc.', type: 'equity' },
  { security_id: 'sec-vti', ticker_symbol: 'VTI', name: 'Vanguard Total Stock Market ETF', type: 'etf' },
  { security_id: 'sec-cash', ticker_symbol: 'CUR:USD', name: 'Cash', type: 'cash' },
  { security_id: 'sec-mf', ticker_symbol: null, name: 'Some Mutual Fund (CUSIP only)', type: 'mutual fund' },
  { security_id: 'sec-btc', ticker_symbol: 'BTC', name: 'Bitcoin', type: 'cryptocurrency' },
];

const holding = (over: Partial<PlaidHolding> & Pick<PlaidHolding, 'security_id'>): PlaidHolding => ({
  account_id: 'acct-1',
  institution_value: 0,
  quantity: 0,
  iso_currency_code: 'USD',
  unofficial_currency_code: null,
  ...over,
});

describe('mapPlaidHoldings — clean positions', () => {
  it('maps shares, cost basis, and authoritative total; derives per-share from the total', () => {
    const { holdings, skipped, withheldNonUsd } = mapPlaidHoldings(
      [
        holding({ security_id: 'sec-aapl', quantity: 100, cost_basis: 15000, institution_value: 20000, institution_price: 200 }),
        holding({ security_id: 'sec-vti', quantity: 200, cost_basis: 40000, institution_value: 50000, institution_price: 250 }),
      ],
      SECURITIES,
    );
    expect(skipped).toBe(0);
    expect(withheldNonUsd).toBe(0);
    expect(holdings).toEqual([
      { symbol: 'AAPL', name: 'Apple Inc.', quantity: 100, costBasisCents: 1500000, priceCents: 20000, marketValueCents: 2000000 },
      { symbol: 'VTI', name: 'Vanguard Total Stock Market ETF', quantity: 200, costBasisCents: 4000000, priceCents: 25000, marketValueCents: 5000000 },
    ]);
  });

  it('derives per-share from institution_value, IGNORING Plaid institution_price', () => {
    // institution_price is deliberately wrong (999) — the mapper must NOT use it.
    const { holdings } = mapPlaidHoldings(
      [holding({ security_id: 'sec-aapl', quantity: 100, institution_value: 20000, institution_price: 999 })],
      SECURITIES,
    );
    expect(holdings[0].priceCents).toBe(20000); // round($20,000 ÷ 100), not $999
    expect(holdings[0].marketValueCents).toBe(2000000);
  });

  it('cost_basis null → 0 (position kept, gain becomes unknown downstream)', () => {
    const { holdings } = mapPlaidHoldings(
      [holding({ security_id: 'sec-aapl', quantity: 10, institution_value: 2000, cost_basis: null })],
      SECURITIES,
    );
    expect(holdings[0].costBasisCents).toBe(0);
    expect(holdings[0].marketValueCents).toBe(200000);
  });

  it('results are sorted by symbol', () => {
    const { holdings } = mapPlaidHoldings(
      [
        holding({ security_id: 'sec-vti', quantity: 1, institution_value: 100 }),
        holding({ security_id: 'sec-aapl', quantity: 1, institution_value: 100 }),
      ],
      SECURITIES,
    );
    expect(holdings.map((h) => h.symbol)).toEqual(['AAPL', 'VTI']);
  });
});

describe('mapPlaidHoldings — the penny lot (DECISIONS #129 parity)', () => {
  it('a low-price / high-quantity lot keeps its 1¢ authoritative total (does not vanish to $0)', () => {
    const { holdings } = mapPlaidHoldings(
      [holding({ security_id: 'sec-aapl', quantity: 1_000_000, institution_value: 0.01 })],
      SECURITIES,
    );
    expect(holdings[0].priceCents).toBe(0); // $0.01 ÷ 1,000,000 rounds to $0/share …
    expect(holdings[0].marketValueCents).toBe(1); // … but the 1¢ total is authoritative
  });
});

describe('mapPlaidHoldings — cash sweeps', () => {
  it('drops a cash-type security WITHOUT counting it as skipped (it is inside the balance)', () => {
    const { holdings, skipped, withheldNonUsd } = mapPlaidHoldings(
      [
        holding({ security_id: 'sec-cash', quantity: 5000, institution_value: 5000 }),
        holding({ security_id: 'sec-aapl', quantity: 10, institution_value: 2000 }),
      ],
      SECURITIES,
    );
    expect(holdings.map((h) => h.symbol)).toEqual(['AAPL']);
    expect(skipped).toBe(0); // cash is not a glitch
    expect(withheldNonUsd).toBe(0);
  });
});

describe('mapPlaidHoldings — currency withholding (no FX)', () => {
  it('withholds a non-USD (iso) lot; counts it as withheldNonUsd, not skipped', () => {
    const { holdings, skipped, withheldNonUsd } = mapPlaidHoldings(
      [
        holding({ security_id: 'sec-aapl', quantity: 10, institution_value: 2000 }),
        holding({ security_id: 'sec-vti', quantity: 10, institution_value: 3000, iso_currency_code: 'EUR' }),
      ],
      SECURITIES,
    );
    expect(holdings.map((h) => h.symbol)).toEqual(['AAPL']);
    expect(withheldNonUsd).toBe(1);
    expect(skipped).toBe(0);
  });

  it('withholds a crypto lot carried on unofficial_currency_code (iso null)', () => {
    const { holdings, withheldNonUsd } = mapPlaidHoldings(
      [holding({ security_id: 'sec-btc', quantity: 2, institution_value: 100000, iso_currency_code: null, unofficial_currency_code: 'BTC' })],
      SECURITIES,
    );
    expect(holdings).toHaveLength(0);
    expect(withheldNonUsd).toBe(1);
  });

  it('a blank iso does not shadow a populated crypto code (fail-open)', () => {
    const { withheldNonUsd } = mapPlaidHoldings(
      [holding({ security_id: 'sec-btc', quantity: 1, institution_value: 50000, iso_currency_code: '  ', unofficial_currency_code: 'BTC' })],
      SECURITIES,
    );
    expect(withheldNonUsd).toBe(1);
  });
});

describe('mapPlaidHoldings — un-mappable rows are skipped, never thrown', () => {
  it('skips a tickerless real security (no way to key it)', () => {
    const { holdings, skipped } = mapPlaidHoldings(
      [holding({ security_id: 'sec-mf', quantity: 10, institution_value: 2000 })],
      SECURITIES,
    );
    expect(holdings).toHaveLength(0);
    expect(skipped).toBe(1);
  });

  it('skips a holding whose security_id is absent from securities[]', () => {
    const { holdings, skipped } = mapPlaidHoldings(
      [holding({ security_id: 'sec-unknown', quantity: 10, institution_value: 2000 })],
      SECURITIES,
    );
    expect(holdings).toHaveLength(0);
    expect(skipped).toBe(1);
  });

  it('skips a short/zero position (quantity <= 0)', () => {
    const { holdings, skipped } = mapPlaidHoldings(
      [
        holding({ security_id: 'sec-aapl', quantity: -5, institution_value: 1000 }),
        holding({ security_id: 'sec-vti', quantity: 0, institution_value: 1000 }),
      ],
      SECURITIES,
    );
    expect(holdings).toHaveLength(0);
    expect(skipped).toBe(2);
  });

  it('skips a non-finite / non-recordable value', () => {
    const { holdings, skipped } = mapPlaidHoldings(
      [holding({ security_id: 'sec-aapl', quantity: 10, institution_value: Number.NaN })],
      SECURITIES,
    );
    expect(holdings).toHaveLength(0);
    expect(skipped).toBe(1);
  });

  it('skips an over-ceiling position (>$21.4M) instead of overflowing the Int column', () => {
    const { holdings, skipped } = mapPlaidHoldings(
      [holding({ security_id: 'sec-aapl', quantity: 1, institution_value: 30_000_000 })],
      SECURITIES,
    );
    expect(holdings).toHaveLength(0);
    expect(skipped).toBe(1);
  });

  it('never throws on wholly garbage input', () => {
    expect(() =>
      mapPlaidHoldings(
        [holding({ security_id: 'sec-aapl', quantity: Number.POSITIVE_INFINITY, institution_value: -1 })],
        SECURITIES,
      ),
    ).not.toThrow();
  });

  it('empty input → empty result', () => {
    expect(mapPlaidHoldings([], SECURITIES)).toEqual({ holdings: [], skipped: 0, withheldNonUsd: 0 });
    expect(mapPlaidHoldings()).toEqual({ holdings: [], skipped: 0, withheldNonUsd: 0 });
  });
});

describe('mapPlaidHoldings — same-symbol aggregation', () => {
  it('aggregates two lots of the same security into one position (sums shares, cost, value)', () => {
    const { holdings } = mapPlaidHoldings(
      [
        holding({ security_id: 'sec-aapl', quantity: 100, cost_basis: 15000, institution_value: 20000 }),
        holding({ security_id: 'sec-aapl', quantity: 50, cost_basis: 8000, institution_value: 10000 }),
      ],
      SECURITIES,
    );
    expect(holdings).toHaveLength(1);
    expect(holdings[0]).toMatchObject({
      symbol: 'AAPL',
      quantity: 150,
      costBasisCents: 2300000, // $15,000 + $8,000
      marketValueCents: 3000000, // $20,000 + $10,000
      priceCents: 20000, // round($30,000 ÷ 150)
    });
  });
});
