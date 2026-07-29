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
  KEYWORD_RULE_PRIORITY,
  decodeKeywords,
  encodeKeywords,
  keywordSpecificity,
  keywordsMatch,
  parseKeywords,
} from '@/lib/engine/categorize/keyword-rule';
import { toRuleLike } from '@/server/rules';
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
    // "Macy's" is what the normalizer produces for this descriptor — verified by
    // execution, not assumed. (It produced 'Macys Lenox Square' until the O.13
    // brand-coverage fix taught the table the plural spelling, and this fixture
    // failing on that change is the test doing its job.)
    const merchantRule = rule({ id: 'm-1', merchantCanonical: "Macy's", priority: 100 });
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

/**
 * The STORED half: mapping a row to a rule, and precedence (O.13a).
 *
 * `toRuleLike` is where the feature's worst possible bug lives. A keyword rule
 * carries no merchantId, and in `RuleLike` a null `merchantCanonical` means "ANY
 * merchant" — so a row that ANNOUNCED a keyword key and has none left would file
 * every transaction in the account. That is the same trap the orphaned-merchant
 * case already guards, and it gets the same answer: refuse the row.
 */
describe('toRuleLike — the stored keyword key', () => {
  const base = {
    id: 'r1',
    merchantId: null,
    minAmountCents: null,
    maxAmountCents: null,
    weekendOnly: null,
    weekdayOnly: null,
    accountId: null,
    categoryId: 'clothing',
    priority: KEYWORD_RULE_PRIORITY,
  };

  it('decodes the stored key onto the rule', () => {
    const out = toRuleLike({ ...base, matchKeywords: 'tjmaxx 0181' }, new Map());
    expect(out?.matchKeywords).toEqual(['tjmaxx', '0181']);
  });

  it('REFUSES a row that declares a keyword key and has none left', () => {
    // Fail-old: without this the rule has no merchant, no keywords and no other
    // condition — it matches every transaction the pipeline ever sees.
    expect(toRuleLike({ ...base, matchKeywords: '' }, new Map())).toBeNull();
    expect(toRuleLike({ ...base, matchKeywords: '   ' }, new Map())).toBeNull();
  });

  it('leaves a pre-O.13a row (no key at all) exactly as it was', () => {
    const out = toRuleLike({ ...base, priority: 100, matchKeywords: null }, new Map());
    expect(out).not.toBeNull();
    expect(out!.matchKeywords).toBeNull();
  });
});

describe('precedence between rules that both match', () => {
  function kw(id: string, words: string, categoryId: string) {
    return rule({ id, matchKeywords: parseKeywords(words), categoryId, priority: KEYWORD_RULE_PRIORITY });
  }

  it('a TYPED key outranks an explicit merchant rule on the same row', () => {
    const merchantRule = rule({ id: 'm-1', merchantCanonical: 'Tjmaxx', categoryId: 'shopping', priority: 100 });
    const out = categorize({ ...TXN, rawDescriptor: TJMAXX }, [merchantRule, kw('kw-1', 'tjmaxx', 'clothing')]);
    expect(out.categoryId).toBe('clothing');
    expect(out.matchedRuleId).toBe('kw-1');
  });

  it('the MORE SPECIFIC key wins, in either input order', () => {
    const broad = kw('kw-broad', 'costco', 'groceries');
    const narrow = kw('kw-narrow', 'costco gas', 'fuel');
    const txn = { ...TXN, rawDescriptor: 'COSTCO GAS #0455 ATLANTA GA' };
    expect(categorize(txn, [broad, narrow]).matchedRuleId).toBe('kw-narrow');
    expect(categorize(txn, [narrow, broad]).matchedRuleId).toBe('kw-narrow');
  });

  it('two equally specific keys resolve by id, not by input order', () => {
    const a = kw('kw-aaa', 'pasta', 'dining');
    const b = kw('kw-bbb', 'mirko', 'groceries');
    const txn = { ...TXN, rawDescriptor: 'MIRKO PASTA' };
    expect(categorize(txn, [a, b]).matchedRuleId).toBe('kw-aaa');
    expect(categorize(txn, [b, a]).matchedRuleId).toBe('kw-aaa');
  });
});
