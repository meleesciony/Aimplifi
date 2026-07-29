/**
 * User-authored keyword match keys (TASKS O.13a) — the owner's named ask:
 *
 *   "You have the ability to change things like 'contains tjmax'. Because the
 *    card number and other numbers always change."
 *
 * The happy path here is one line; the FAILURE DIRECTIONS are the file. A rule
 * files money without asking again, so the tests that matter are the ones that
 * prove it matches too LITTLE rather than too much:
 *
 *   - an EMPTY key matches nothing, even though a keyword rule carries
 *     `merchantCanonical: null` which means "any merchant" in `ruleMatches` —
 *     the file-everything trap, and the reason this file exists;
 *   - matching is LITERAL, so `tjmaxx` does not match `TJ MAXX`: an under-match
 *     leaves the row in review where the reader sees it;
 *   - every keyword must be present, so adding one can only narrow;
 *   - an absent key changes nothing about existing rules.
 */
import { describe, expect, it } from 'vitest';

import {
  decodeKeywords,
  encodeKeywords,
  keywordSpecificity,
  keywordsMatch,
  parseKeywords,
} from '@/lib/engine/categorize/keyword-rule';
import { type RuleLike, categorize } from '@/lib/engine/categorize/pipeline';

/** The owner's real statement text, from his Simplifi screenshot. */
const TJMAXX = 'tjmaxx 0181 0966';
/** The SAME shop next month: store and sequence numbers have both moved. */
const TJMAXX_NEXT = 'TJMAXX 0499 1122';

function rule(over: Partial<RuleLike>): RuleLike {
  return {
    id: 'r1',
    merchantCanonical: null,
    minAmountCents: null,
    maxAmountCents: null,
    weekendOnly: null,
    weekdayOnly: null,
    accountId: null,
    categoryId: 'clothing',
    priority: 110,
    ...over,
  };
}

const TXN = { amountCents: -2198, date: '2026-07-27', accountId: 'acct-1' };

describe('parseKeywords', () => {
  it('splits on commas OR whitespace, folds case, drops blanks, keeps first-seen order', () => {
    expect(parseKeywords('tjmaxx, 0181  0966')).toEqual(['tjmaxx', '0181', '0966']);
    expect(parseKeywords('  TJMaxx\t0181\n')).toEqual(['tjmaxx', '0181']);
    expect(parseKeywords(',,,   ')).toEqual([]);
  });

  it('collapses duplicates so one condition is not counted twice', () => {
    expect(parseKeywords('tjmaxx tjmaxx TJMAXX')).toEqual(['tjmaxx']);
  });
});

describe('the storage codec', () => {
  it('round-trips, and a null/blank column decodes to the empty key', () => {
    const keys = parseKeywords('tjmaxx 0181');
    expect(decodeKeywords(encodeKeywords(keys))).toEqual(keys);
    expect(decodeKeywords(null)).toEqual([]);
    expect(decodeKeywords(undefined)).toEqual([]);
    expect(decodeKeywords('')).toEqual([]);
    expect(encodeKeywords([])).toBe('');
  });
});

describe('keywordsMatch — what it REFUSES', () => {
  it('refuses an EMPTY key, even against a descriptor containing everything', () => {
    // The whole point: `merchantCanonical: null` already means "any merchant", so
    // an empty key must not become a file-everything rule.
    expect(keywordsMatch([], TJMAXX)).toBe(false);
    expect(keywordsMatch([], '')).toBe(false);
  });

  it('requires EVERY keyword, so adding one can only narrow the match', () => {
    expect(keywordsMatch(['tjmaxx', '0181'], TJMAXX)).toBe(true);
    expect(keywordsMatch(['tjmaxx', '0181'], TJMAXX_NEXT)).toBe(false);
  });

  it('matches LITERALLY — `tjmaxx` is not `TJ MAXX` (deliberate under-match)', () => {
    expect(keywordsMatch(['tjmaxx'], 'TJ MAXX #0181 ATLANTA GA')).toBe(false);
    expect(keywordsMatch(['tj', 'maxx'], 'TJ MAXX #0181 ATLANTA GA')).toBe(true);
  });
});

describe('keywordsMatch — what it accepts', () => {
  it("holds across the moving numbers, which is the owner's entire request", () => {
    expect(keywordsMatch(['tjmaxx'], TJMAXX)).toBe(true);
    expect(keywordsMatch(['tjmaxx'], TJMAXX_NEXT)).toBe(true);
  });

  it('is case-insensitive on both sides and order-free', () => {
    expect(keywordsMatch(['TJMAXX'], TJMAXX)).toBe(true);
    expect(keywordsMatch(['0966', 'tjmaxx'], TJMAXX)).toBe(true);
  });

  it('matches inside a longer token', () => {
    expect(keywordsMatch(['amzn'], 'AMZN MKTP US*2X4Y5')).toBe(true);
  });
});

describe('keywordSpecificity — deterministic precedence between two keyword rules', () => {
  it('ranks more keywords above fewer, and longer text above shorter at equal count', () => {
    expect(keywordSpecificity(['costco', 'gas'])).toBeGreaterThan(keywordSpecificity(['costco']));
    expect(keywordSpecificity(['costco gas'])).toBeGreaterThan(keywordSpecificity(['costco']));
    expect(keywordSpecificity([])).toBe(0);
  });
});

describe('the pipeline honours a typed key', () => {
  it('files a matching row as a user rule, and names the rule that did it', () => {
    const out = categorize({ ...TXN, rawDescriptor: TJMAXX_NEXT }, [
      rule({ id: 'kw-1', matchKeywords: ['tjmaxx'] }),
    ]);
    expect(out.categoryId).toBe('clothing');
    expect(out.source).toBe('user-rule');
    expect(out.matchedRuleId).toBe('kw-1');
  });

  it('leaves a non-matching row alone', () => {
    const out = categorize({ ...TXN, rawDescriptor: 'MACYS LENOX SQUARE' }, [
      rule({ id: 'kw-1', matchKeywords: ['tjmaxx'] }),
    ]);
    expect(out.source).not.toBe('user-rule');
    expect(out.matchedRuleId).toBeNull();
  });

  it('NEVER files everything when the key is empty and no other condition is set', () => {
    // Fail-old: without the `keywordsMatch([]) === false` refusal this rule has
    // no conditions at all and files every transaction in the app.
    for (const rawDescriptor of [TJMAXX, 'MACYS LENOX SQUARE', 'PUBLIX #1234', 'Venmo']) {
      const out = categorize({ ...TXN, rawDescriptor }, [rule({ id: 'kw-empty', matchKeywords: [] })]);
      expect(out.source).not.toBe('user-rule');
      expect(out.matchedRuleId).toBeNull();
    }
  });

  it('ANDs the key with the existing contextual conditions', () => {
    const banded = rule({ id: 'kw-1', matchKeywords: ['tjmaxx'], minAmountCents: 5000 });
    // $21.98 is below the $50.00 floor, so the key matching is not enough.
    expect(categorize({ ...TXN, rawDescriptor: TJMAXX_NEXT }, [banded]).source).not.toBe('user-rule');
    expect(
      categorize({ ...TXN, amountCents: -9900, rawDescriptor: TJMAXX_NEXT }, [banded]).matchedRuleId,
    ).toBe('kw-1');
  });

  it('leaves a rule with NO key byte-identical to before (absent ≠ empty)', () => {
    // 'Macys Lenox Square' is what the normalizer actually produces for this
    // descriptor — verified by execution, not assumed.
    const merchantRule = rule({ id: 'm-1', merchantCanonical: 'Macys Lenox Square', priority: 100 });
    const out = categorize({ ...TXN, rawDescriptor: 'MACYS LENOX SQUARE' }, [merchantRule]);
    expect(out.matchedRuleId).toBe('m-1');
    expect(out.source).toBe('user-rule');
  });
});

/**
 * WHY THE FEATURE EXISTS — and it is not the owner's own example.
 *
 * `tjmaxx 0181 0966` and `TJMAXX 0499 1122` BOTH already normalize to the known
 * merchant `Tjmaxx` and auto-file as clothing without review (measured), so the
 * headline example in his screenshot is not a live defect here.
 *
 * The live defect is two rows down his own dashboard screenshot: one restaurant
 * reaches him under two descriptors that produce two DIFFERENT canonicals, so no
 * derived key — merchant canonical or descriptor signature — can ever unify them,
 * and they land in two different categories AND two different review states. One
 * typed keyword does unify them. That is the whole argument for O.13a, so it is
 * the case this file locks.
 */
describe('the class no DERIVED key can fix', () => {
  const TOAST = 'Tst*mirko Pasta Buckhead'; // Toast POS prefix
  const PLAIN = 'MIRKO PASTA'; // the same restaurant, billed directly

  it('produces two different canonicals for one restaurant, so a merchant rule cannot span it', () => {
    const a = categorize({ ...TXN, rawDescriptor: TOAST });
    const b = categorize({ ...TXN, rawDescriptor: PLAIN });
    expect(a.merchantCanonical).not.toBe(b.merchantCanonical);
    // And they disagree about the answer, which is what the reader sees.
    expect(a.categoryId).not.toBe(b.categoryId);
    expect(b.needsReview).toBe(true);
  });

  it('files both identically under ONE typed keyword', () => {
    const kw = [rule({ id: 'kw-mirko', matchKeywords: parseKeywords('mirko'), categoryId: 'dining' })];
    for (const rawDescriptor of [TOAST, PLAIN]) {
      const out = categorize({ ...TXN, rawDescriptor }, kw);
      expect(out.categoryId).toBe('dining');
      expect(out.matchedRuleId).toBe('kw-mirko');
      expect(out.needsReview).toBe(false);
    }
  });
});
