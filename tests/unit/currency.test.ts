/**
 * Currency guard — pure helpers (DECISIONS #135; #127 live-ingest audit #3/#10).
 * The app does NO foreign exchange; these canonicalize a feed's currency code and decide
 * whether an account is denominated in a currency the net-worth read paths will trust
 * (USD only today). null = legacy/demo/manual = assumed USD, so existing data is unaffected.
 */
import { describe, expect, it } from 'vitest';
import {
  canonicalizeCurrency,
  formatWithheldCurrencies,
  isSupportedCurrency,
  resolvePlaidCurrency,
  summarizeWithheldAccounts,
  withheldBannerCopy,
  withheldInlineNote,
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

describe('summarizeWithheldAccounts — the disclosure input (#135 residual: no silent vanish)', () => {
  it('returns the zero summary for no accounts and for all-supported accounts', () => {
    expect(summarizeWithheldAccounts([])).toEqual({ count: 0, currencies: [] });
    expect(
      summarizeWithheldAccounts([{ currency: null }, { currency: 'USD' }, { currency: null }]),
    ).toEqual({ count: 0, currencies: [] });
  });
  it('counts every withheld account but dedupes + sorts the currency list', () => {
    expect(
      summarizeWithheldAccounts([
        { currency: 'GBP' },
        { currency: 'EUR' },
        { currency: 'USD' }, // supported — not counted
        { currency: 'EUR' }, // second EUR account — counted, listed once
        { currency: null }, // assumed USD — not counted
      ]),
    ).toEqual({ count: 3, currencies: ['EUR', 'GBP'] });
  });
  it('is the exact complement of isSupportedCurrency (non-ISO tokens are withheld too)', () => {
    expect(
      summarizeWithheldAccounts([{ currency: 'https://x.test/btc' }, { currency: 'US' }]),
    ).toEqual({ count: 2, currencies: ['US', 'https://x.test/btc'] });
  });
  it('is idempotent over pre-filtered rows (the server passes only non-USD rows)', () => {
    const rows = [{ currency: 'EUR' }, { currency: 'GBP' }];
    expect(summarizeWithheldAccounts(rows)).toEqual({ count: 2, currencies: ['EUR', 'GBP'] });
  });
});

describe('formatWithheldCurrencies — user-facing label, opaque tokens never pasted into copy', () => {
  it('joins letter-code tokens (ISO or unofficial/crypto)', () => {
    expect(formatWithheldCurrencies(['EUR'])).toBe('EUR');
    expect(formatWithheldCurrencies(['EUR', 'GBP'])).toBe('EUR, GBP');
    expect(formatWithheldCurrencies(['BTC', 'DOGE'])).toBe('BTC, DOGE');
  });
  it('folds an opaque token (SimpleFIN currency URL) into "others"', () => {
    expect(formatWithheldCurrencies(['https://x.test/btc'])).toBe('other currencies');
    expect(formatWithheldCurrencies(['EUR', 'https://x.test/btc'])).toBe('EUR and others');
  });
  it('folds feed tokens that are not display names: numeric ISO, 2-letter fragments (checker)', () => {
    expect(formatWithheldCurrencies(['840'])).toBe('other currencies'); // numeric ISO-4217
    expect(formatWithheldCurrencies(['US'])).toBe('other currencies'); // reads as a country
    expect(formatWithheldCurrencies(['840', 'EUR'])).toBe('EUR and others');
  });
  it('uppercases lowercase feed codes and dedupes case-variants WITHOUT claiming "others"', () => {
    expect(formatWithheldCurrencies(['doge'])).toBe('DOGE');
    expect(formatWithheldCurrencies(['doge', 'DOGE'])).toBe('DOGE'); // one currency, no "and others"
    expect(formatWithheldCurrencies(['doge', 'EUR'])).toBe('DOGE, EUR'); // re-sorted after uppercasing
  });
});

describe('withheldBannerCopy — every grammar branch locked (checker: singular path shipped untested)', () => {
  it('returns null for the zero summary (the banner renders nothing)', () => {
    expect(withheldBannerCopy({ count: 0, currencies: [] })).toBeNull();
  });
  it('singular, printable code: "an account in EUR is left out … counting it"', () => {
    const copy = withheldBannerCopy({ count: 1, currencies: ['EUR'] });
    expect(copy?.title).toBe('1 account not included — not in U.S. dollars');
    expect(copy?.description).toContain('an account in EUR is left out');
    expect(copy?.description).toContain('counting it at a one-to-one rate');
  });
  it('singular, opaque token: folds to SINGULAR "another currency" (never "an account in other currencies")', () => {
    const copy = withheldBannerCopy({ count: 1, currencies: ['https://x.test/btc'] });
    expect(copy?.description).toContain('an account in another currency is left out');
    expect(copy?.description).not.toContain('an account in other currencies');
  });
  it('plural, printable codes: "2 accounts … accounts in EUR, GBP are left out … counting them"', () => {
    const copy = withheldBannerCopy({ count: 2, currencies: ['EUR', 'GBP'] });
    expect(copy?.title).toBe('2 accounts not included — not in U.S. dollars');
    expect(copy?.description).toContain('accounts in EUR, GBP are left out');
    expect(copy?.description).toContain('counting them at a one-to-one rate');
  });
  it('plural, opaque-only: keeps the plural "other currencies … are"', () => {
    const copy = withheldBannerCopy({ count: 2, currencies: ['https://x.test/a', 'https://x.test/b'] });
    expect(copy?.description).toContain('accounts in other currencies are left out');
  });
  it('crypto is not "foreign": the title says "not in U.S. dollars" over a BTC listing', () => {
    const copy = withheldBannerCopy({ count: 1, currencies: ['BTC'] });
    expect(copy?.title).toBe('1 account not included — not in U.S. dollars');
    expect(copy?.title).not.toContain('foreign');
    expect(copy?.description).toContain('an account in BTC is left out');
  });
});

describe('withheldInlineNote — inline projection/total assumption (#135 residual 25)', () => {
  it('returns null for the zero summary (all-USD surfaces render nothing → byte-identical)', () => {
    expect(withheldInlineNote({ count: 0, currencies: [] })).toBeNull();
  });
  it('singular: "Excludes 1 account not in U.S. dollars"', () => {
    expect(withheldInlineNote({ count: 1, currencies: ['EUR'] })).toContain(
      'Excludes 1 account not in U.S. dollars',
    );
  });
  it('plural: "Excludes N accounts not in U.S. dollars"', () => {
    expect(withheldInlineNote({ count: 3, currencies: ['EUR', 'GBP'] })).toContain(
      'Excludes 3 accounts not in U.S. dollars',
    );
  });
  it('states the assumption, no shame language (coaching guardrail)', () => {
    const note = withheldInlineNote({ count: 2, currencies: ['EUR', 'GBP'] })!;
    expect(note).toMatch(/doesn't convert other currencies/i);
    expect(note).not.toMatch(/wasted|guilty|stop|should have/i);
  });
});
