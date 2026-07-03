/**
 * Shared ticker validator (#127 tail) — ONE rule for manual `addHolding` AND SimpleFIN holdings
 * ingest, so the two can never drift (the #127 audit noted them as coupled). The "/" widening
 * accepts slash share-class + crypto-pair tickers a plain alphanumeric rule dropped.
 */
import { describe, expect, it } from 'vitest';
import { TICKER_RE, parseTicker } from '@/lib/engine/investments/ticker';

describe('parseTicker', () => {
  it('accepts plain, dotted, dashed, and — newly — slash tickers; trims + upper-cases', () => {
    expect(parseTicker('aapl')).toBe('AAPL');
    expect(parseTicker('  msft ')).toBe('MSFT');
    expect(parseTicker('BRK.B')).toBe('BRK.B');
    expect(parseTicker('BTC-USD')).toBe('BTC-USD');
    expect(parseTicker('BRK/B')).toBe('BRK/B'); // slash share-class (#127 tail)
    expect(parseTicker('btc/usd')).toBe('BTC/USD'); // crypto pair
  });

  it('rejects empty / whitespace / null / undefined → null', () => {
    expect(parseTicker('')).toBeNull();
    expect(parseTicker('   ')).toBeNull();
    expect(parseTicker(null)).toBeNull();
    expect(parseTicker(undefined)).toBeNull();
  });

  it('rejects spaces (OCC option symbols) and over-length; 20 chars is the boundary', () => {
    expect(parseTicker('AAPL 240119C00150000')).toBeNull(); // space + >20 chars → documented skip
    expect(parseTicker('A'.repeat(21))).toBeNull();
    expect(parseTicker('A'.repeat(20))).toBe('A'.repeat(20));
  });

  it('rejects other punctuation — only ".", "-", "/" are allowed', () => {
    expect(parseTicker('BRK_B')).toBeNull();
    expect(parseTicker('BRK*B')).toBeNull();
    expect(parseTicker('BR@K')).toBeNull();
  });

  it('TICKER_RE is the single raw source; it is case-SENSITIVE (parseTicker normalizes first)', () => {
    expect(TICKER_RE.test('BRK/B')).toBe(true);
    expect(TICKER_RE.test('aapl')).toBe(false); // lowercase only passes AFTER parseTicker upper-cases
  });
});
