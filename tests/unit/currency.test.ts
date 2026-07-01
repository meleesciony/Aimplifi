/**
 * Currency guard — pure helpers (DECISIONS #135; #127 live-ingest audit #3/#10).
 * The app does NO foreign exchange; these canonicalize a feed's currency code and decide
 * whether an account is denominated in a currency the net-worth read paths will trust
 * (USD only today). null = legacy/demo/manual = assumed USD, so existing data is unaffected.
 */
import { describe, expect, it } from 'vitest';
import {
  canonicalizeCurrency,
  isSupportedCurrency,
  resolvePlaidCurrency,
} from '@/lib/providers/currency';

describe('canonicalizeCurrency', () => {
  it('upper-cases a 3-letter ISO code (trimming whitespace)', () => {
    expect(canonicalizeCurrency('usd')).toBe('USD');
    expect(canonicalizeCurrency('USD')).toBe('USD');
    expect(canonicalizeCurrency('eur')).toBe('EUR');
    expect(canonicalizeCurrency(' jpy ')).toBe('JPY');
  });
  it('returns null for null / undefined / empty / whitespace (assumed USD)', () => {
    expect(canonicalizeCurrency(null)).toBeNull();
    expect(canonicalizeCurrency(undefined)).toBeNull();
    expect(canonicalizeCurrency('')).toBeNull();
    expect(canonicalizeCurrency('   ')).toBeNull();
  });
  it('keeps a non-ISO token as-is (trimmed) so it can never equal USD', () => {
    // SimpleFIN uses a URL for non-ISO currencies (crypto); a 4-letter or 2-letter token is non-ISO too.
    expect(canonicalizeCurrency('https://x.test/btc')).toBe('https://x.test/btc');
    expect(canonicalizeCurrency(' DOGE ')).toBe('DOGE');
    expect(canonicalizeCurrency('US')).toBe('US');
  });
});

describe('resolvePlaidCurrency — ISO preferred over unofficial/crypto', () => {
  it('uses iso_currency_code when present', () => {
    expect(resolvePlaidCurrency('USD', null)).toBe('USD');
    expect(resolvePlaidCurrency('EUR', 'BTC')).toBe('EUR'); // ISO wins over a stray unofficial code
  });
  it('falls back to unofficial_currency_code', () => {
    expect(resolvePlaidCurrency(null, 'BTC')).toBe('BTC');
    expect(resolvePlaidCurrency(undefined, 'ETH')).toBe('ETH');
  });
  it('returns null when neither code is reported (assumed USD)', () => {
    expect(resolvePlaidCurrency(null, null)).toBeNull();
    expect(resolvePlaidCurrency(undefined)).toBeNull();
  });
  it('does NOT let a blank/whitespace iso shadow a populated unofficial code (fail-open guard, critic P2)', () => {
    // `iso ?? unofficial` would keep '' (not null) and canonicalize to null = assumed USD,
    // summing a crypto/unofficial account at 1:1 — the bug the guard exists to prevent.
    expect(resolvePlaidCurrency('', 'BTC')).toBe('BTC');
    expect(resolvePlaidCurrency('   ', 'BTC')).toBe('BTC');
    expect(resolvePlaidCurrency('', null)).toBeNull(); // blank iso, no unofficial → assumed USD
  });
});

describe('isSupportedCurrency — USD-only, null assumed USD (golden-safe)', () => {
  it('treats null / undefined as supported (legacy, demo, manual rows)', () => {
    expect(isSupportedCurrency(null)).toBe(true);
    expect(isSupportedCurrency(undefined)).toBe(true);
  });
  it('treats canonical USD as supported', () => {
    expect(isSupportedCurrency('USD')).toBe(true);
  });
  it('withholds every other currency code', () => {
    for (const c of ['EUR', 'JPY', 'GBP', 'BTC', 'https://x.test/btc', 'US']) {
      expect(isSupportedCurrency(c)).toBe(false);
    }
  });
});
