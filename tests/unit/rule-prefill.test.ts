/**
 * TASKS O.13b — pre-filling a rule key from the transaction the reader clicked.
 *
 * The load-bearing property is NOT "we pick good keywords". It is that the
 * suggested key MATCHES THE ROW IT CAME FROM: the reader clicked a transaction,
 * so the count he is shown must include that transaction, or the surface has
 * lied to him before he has typed anything. Every case here asserts that
 * round-trip through the real matcher rather than eyeballing the token list.
 */
import { describe, expect, it } from 'vitest';
import {
  MIN_KEYWORD_LENGTH,
  keywordsMatch,
  parseKeywords,
} from '@/lib/engine/categorize/keyword-rule';
import { suggestRuleKeywords } from '@/lib/engine/categorize/rule-prefill';

/** The owner's own descriptors, from his register screenshots. */
const OWNER_DESCRIPTORS = [
  'costco whse 1084',
  'COSTCO WHSE #0981',
  'tjmaxx 0181 0966',
  'TJMAXX 0499 1122',
  'Tst*mirko Pasta Buckhead',
  'MIRKO PASTA',
  'MACYS LENOX SQUARE',
  'Cardone Eq Fund Cef Xv Ppd ~ Tran: 88213',
];

describe('suggestRuleKeywords', () => {
  it('always produces a key that matches the descriptor it came from', () => {
    for (const d of OWNER_DESCRIPTORS) {
      const { keywords } = suggestRuleKeywords(d);
      expect(keywords.length).toBeGreaterThan(0);
      expect(keywordsMatch(keywords, d)).toBe(true);
    }
  });

  it('preserves the bank’s own token order, so the chips read like the statement', () => {
    expect(suggestRuleKeywords('costco whse 1084').keywords).toEqual([
      'costco',
      'whse',
      '1084',
    ]);
  });

  it('keeps the volatile tokens IN the key — widening is the reader’s gesture, not ours', () => {
    // The whole point of O.13b is that deleting `1084` is HIS move. If we
    // dropped it here, the count he sees would be the consequence of our guess.
    const { keywords, volatile } = suggestRuleKeywords('costco whse 1084');
    expect(keywords).toContain('1084');
    expect(volatile).toEqual(['1084']);
  });

  it('flags store numbers, processor prefixes and ACH rail words as volatile', () => {
    expect(suggestRuleKeywords('Tst*mirko Pasta Buckhead').volatile).toEqual([
      'tst*mirko',
    ]);
    const cardone = suggestRuleKeywords('Cardone Eq Fund Cef Xv Ppd ~ Tran: 88213');
    expect(cardone.volatile).toEqual(expect.arrayContaining(['ppd', 'tran:', '88213']));
    // …and the payee itself is never flagged.
    expect(cardone.volatile).not.toContain('cardone');
  });

  it('marks volatile as a strict subset of the key, so a chip hint can never point at nothing', () => {
    for (const d of OWNER_DESCRIPTORS) {
      const { keywords, volatile } = suggestRuleKeywords(d);
      for (const v of volatile) expect(keywords).toContain(v);
    }
  });

  it('drops tokens the store would refuse, instead of offering then rejecting them', () => {
    // `Eq` and `Xv` are below the floor; offering them as chips would produce a
    // key the save path rejects on a rule the reader thinks he authored.
    const { keywords } = suggestRuleKeywords('Cardone Eq Fund Cef Xv Ppd');
    expect(keywords).not.toContain('eq');
    expect(keywords).not.toContain('xv');
    for (const k of keywords) expect(k.length).toBeGreaterThanOrEqual(MIN_KEYWORD_LENGTH);
  });

  it('returns an EMPTY key for an empty or unusable descriptor, never a match-everything key', () => {
    for (const d of ['', '   ', ',,,', 'a b c', '|']) {
      expect(suggestRuleKeywords(d).keywords).toEqual([]);
    }
  });

  it('tokenizes exactly as the builder tokenizes text the reader types', () => {
    // A prefilled chip and a typed chip must be the same kind of thing, or the
    // key stops round-tripping through the builder's FormData contract.
    for (const d of OWNER_DESCRIPTORS) {
      const { keywords } = suggestRuleKeywords(d);
      expect(parseKeywords(keywords.join(' '))).toEqual(keywords);
    }
  });

  it('is deterministic', () => {
    for (const d of OWNER_DESCRIPTORS) {
      expect(suggestRuleKeywords(d)).toEqual(suggestRuleKeywords(d));
    }
  });

  it('spans the owner’s two-canonical Mirko pair once the store-specific chips are deleted', () => {
    // The live defect O.13a was built for: one restaurant, two canonicals, two
    // categories. `mirko` alone spans both — and the prefill's job is to make
    // that reachable by DELETING chips from a real row, with no typing.
    const { keywords } = suggestRuleKeywords('Tst*mirko Pasta Buckhead');
    expect(keywordsMatch(keywords, 'MIRKO PASTA')).toBe(false);
    const widened = keywords.filter((k) => k !== 'tst*mirko' && k !== 'buckhead');
    expect(widened).toEqual(['pasta']);
    expect(keywordsMatch(['mirko'], 'Tst*mirko Pasta Buckhead')).toBe(true);
    expect(keywordsMatch(['mirko'], 'MIRKO PASTA')).toBe(true);
  });
});
