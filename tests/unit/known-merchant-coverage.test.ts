/**
 * National-brand coverage in the merchant table (TASKS O.13, owner report
 * 2026-07-29 with a screenshot of his register):
 *
 *   "How is categorizer not identifying macys? A major big box brand."
 *   "Lenox square is name of mall"
 *
 * THE ROOT CAUSE, and it is the interesting part. The table DID know these
 * brands — as the stems `MACY`, `DILLARD`, `KOHL` inside the generic keyword
 * tier's alternation, which is wrapped in `\b(...)\b`. `\bMACY\b` cannot match
 * `MACYS`: the trailing S removes the word boundary the pattern requires. So the
 * possessive spelling matched (`MACY'S #123`, where the apostrophe IS a boundary)
 * and the plural spelling every bank actually sends did not. One character of
 * regex, 22 of 80 major-brand descriptors earning no category.
 *
 * Every case below is written as the RAW text a real feed sends — brand, then
 * store number, then the mall or city — because that trailing noise is what the
 * owner's row had and what a `^`-anchored prefix pattern has to tolerate.
 */
import { describe, expect, it } from 'vitest';

import { normalizeMerchant } from '@/lib/engine/categorize/normalize';

describe("the owner's own uncategorized rows", () => {
  it('files Macys under the brand name, not the shopping mall', () => {
    const m = normalizeMerchant('MACYS LENOX SQUARE');
    expect(m.categoryId).toBe('clothing');
    // The NAME matters as much as the category: the register printed the brand
    // welded to the mall it sits in. A specific-tier entry fixes both.
    expect(m.canonical).toBe("Macy's");
  });

  it('files the Dunkin/Baskin combo store code', () => {
    const m = normalizeMerchant('DD/BR Q35');
    expect(m.categoryId).toBe('coffee'); // Dunkin alone is already coffee — same counter, same answer
    expect(m.canonical).toBe("Dunkin' / Baskin-Robbins");
  });

  it('files in-park Disney vendors as entertainment', () => {
    expect(normalizeMerchant('WDW HYPERIONPOPCORN').categoryId).toBe('entertainment');
    expect(normalizeMerchant('EPCOT FACEPAINT').categoryId).toBe('entertainment');
  });
});

describe('the plural-spelling class the boundary bug hid', () => {
  // Fail-old: each left column matched NOTHING before this fix, while its
  // apostrophe twin matched all along.
  const cases: [string, string, string][] = [
    ['MACYS LENOX SQUARE', "Macy's", 'clothing'],
    ["MACY'S #123", "Macy's", 'clothing'],
    ['DILLARDS 0012', "Dillard's", 'clothing'],
    ['KOHLS 1234', "Kohl's", 'clothing'],
    ['BLOOMINGDALES ATLANTA', "Bloomingdale's", 'clothing'],
    ['SAKS FIFTH AVE 0231', 'Saks Fifth Avenue', 'clothing'],
    ['CABELAS #12', "Cabela's", 'hobbies'],
    ['VICTORIAS SECRET 4455', "Victoria's Secret", 'clothing'],
  ];
  for (const [raw, canonical, categoryId] of cases) {
    it(`${raw} → ${canonical} / ${categoryId}`, () => {
      const m = normalizeMerchant(raw);
      expect(m.canonical).toBe(canonical);
      expect(m.categoryId).toBe(categoryId);
    });
  }
});

describe('brands added with the processor prefix they actually bill under', () => {
  it('recognizes Joss & Main behind the JM* order id that changes every purchase', () => {
    // This is the O.13a keyword class solved without needing a rule: the digits
    // after the prefix are an order id, so no derived key could ever repeat.
    for (const raw of ['JOSS & MAIN', 'JM* JOSSMAIN4640018831', 'JM*JOSS MAIN 12']) {
      const m = normalizeMerchant(raw);
      expect(m.categoryId, raw).toBe('furnishings');
    }
  });
});

/**
 * The refusals. Widening a brand table is exactly where a confident wrong answer
 * gets shipped, and the failure direction is not symmetric: an unmatched row waits
 * in review where the reader can see it, while a mis-matched row is filed silently.
 */
describe('what was deliberately NOT added', () => {
  it('leaves GAP alone — the word is not only a clothing brand', () => {
    // `\bGAP\b` would file 'GAP INSURANCE' as clothing. A three-letter English
    // word is not a safe key, and the owner is better served by review.
    expect(normalizeMerchant('GAP INSURANCE PREMIUM').categoryId).not.toBe('clothing');
  });

  it("leaves 'AT HOME' alone for the same reason", () => {
    expect(normalizeMerchant('WORK AT HOME SERVICES').categoryId).not.toBe('furnishings');
  });

  it('does not key the park vendors on the word DISNEY — the streaming service keeps its own identity', () => {
    // Measured: the table already resolves this to 'Disney Plus' / entertainment.
    // The invariant worth locking is that it stays ITS OWN merchant rather than
    // being swallowed by a park canonical, since a subscription and a day at Epcot
    // are different things to a reader looking at a list of names.
    const plus = normalizeMerchant('DISNEY PLUS');
    expect(plus.canonical).toBe('Disney Plus');
    expect(plus.canonical).not.toBe('Walt Disney World');
  });
});
