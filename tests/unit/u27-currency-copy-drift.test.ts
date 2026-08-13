/**
 * U.27 — currency copy family consistency (opened 2026-08-12 by the U.23 rendered-claims
 * critic, P2-6/P2-8; DECISIONS #141 set the standard, #459 fixed the drift).
 *
 * (a) DECISIONS #141 standardized this family on "U.S. dollars" (never "foreign currency" —
 * crypto via Plaid's `unofficial_currency_code` is a first-class withheld case and isn't
 * foreign), but four more authors had drifted to the bare "US dollars"/"US dollar" —
 * `household-copy.ts` (x2), `keyword-rules.ts`, and a `money.ts` docblock. A grep-based scan
 * of every `.ts`/`.tsx` file under `src/` for the informal, unpunctuated form is the lock: it
 * catches the exact shape of drift this row found, wherever the NEXT author reintroduces it,
 * without needing to know their file name in advance. Word-boundaried and case-sensitive so it
 * cannot fire on "U.S. dollars" itself (the periods break the "US" token) or on an unrelated
 * word that merely contains the substring (e.g. "campus dollars" — "us" there is lowercase and
 * mid-word, so `\bUS\b` never matches it).
 *
 * (b) `formatWithheldCurrencies`'s mixed printable+opaque phrasing ("EUR and others") parsed as
 * "accounts in EUR, and other ACCOUNTS" — a plausible misreading right beside sentences this
 * same string feeds that already talk about accounts. Fixed to "EUR and other currencies";
 * locked here again at the family level (currency.test.ts locks the function's own branches)
 * because both #141's shipped banner and U.23's export note render this exact string, and a
 * regression here would be silent to both surfaces' own suites if either drifted independently.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { formatWithheldCurrencies, withheldBannerCopy, withheldExportNote } from '@/lib/providers/currency';

const BARE_US_DOLLAR = /\bUS dollars?\b/;

function* walkTs(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      yield* walkTs(p);
    } else if (/\.(ts|tsx)$/.test(name)) {
      yield p;
    }
  }
}

describe('U.27(a) — no source file uses the informal "US dollar(s)" (family standard: "U.S. dollars")', () => {
  it('test_regression__bare-us-dollars-without-periods', () => {
    const offenders: string[] = [];
    for (const file of walkTs('src')) {
      const text = readFileSync(file, 'utf8');
      if (BARE_US_DOLLAR.test(text)) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});

describe('U.27(b) — formatWithheldCurrencies names the noun ("and other currencies", not bare "others")', () => {
  it('mixed printable + opaque tokens spell out the noun', () => {
    expect(formatWithheldCurrencies(['EUR', 'https://x.test/crypto'])).toBe(
      'EUR and other currencies',
    );
  });
  it('never emits the bare, ambiguous "and others" suffix', () => {
    const cases = [
      ['EUR'],
      ['EUR', 'GBP'],
      ['https://x.test/a'],
      ['EUR', 'https://x.test/a', 'https://x.test/b'],
      ['840', 'EUR', 'US'],
    ];
    for (const currencies of cases) {
      expect(formatWithheldCurrencies(currencies)).not.toMatch(/\band others\b/);
    }
  });
  it('the fix reaches both rendered consumers — the #141 banner and the U.23 export note', () => {
    const summary = { count: 2, currencies: ['EUR', 'https://x.test/crypto'] };
    expect(withheldBannerCopy(summary)?.description).toContain('EUR and other currencies');
    expect(withheldExportNote(summary)).toContain('EUR and other currencies');
    expect(withheldBannerCopy(summary)?.description).not.toMatch(/\band others\b/);
    expect(withheldExportNote(summary)).not.toMatch(/\band others\b/);
  });
});
