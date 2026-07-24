/**
 * The /cards identity line (#298) — the lock on the owner-reported defect of 2026-07-24.
 *
 * His live /cards screen showed THREE cards named `CREDIT CARD` and TWO named `Venture`, each with
 * its own amount due, on the surface that issues payment instructions. Nothing on the page said
 * which card a figure belonged to, and the headline read "Do this first: pay Venture $9,250.93"
 * while he held two Ventures.
 *
 * Hand-verified expectations; see docs/EDGE_CASES.md §Card-identity.
 */
import { describe, expect, it } from 'vitest';

import {
  type CardIdentityInput,
  NO_CARD_NUMBER,
  cardIdentityLabels,
} from '@/components/finance/card-identity-view';

const card = (cardId: string, cardName: string): CardIdentityInput => ({ cardId, cardName });

describe('cardIdentityLabels — the ordinary case', () => {
  it('renders the last-4 for each card that has one', () => {
    const out = cardIdentityLabels([card('a', 'Venture'), card('b', 'Spark Miles')], {
      a: '6271',
      b: '5154',
    });
    expect(out).toEqual({ a: '····6271', b: '····5154' });
  });

  it('renders NOTHING for a uniquely-named card with no last-4 — no empty chip, no noise', () => {
    const out = cardIdentityLabels([card('a', 'Venture'), card('b', 'Spark Miles')], {
      a: null,
      b: null,
    });
    expect(out).toEqual({});
  });

  it('is safe with a missing mask map entirely', () => {
    expect(cardIdentityLabels([card('a', 'Venture')], {})).toEqual({});
  });

  it('returns nothing for no cards', () => {
    expect(cardIdentityLabels([], {})).toEqual({});
  });
});

describe('test_regression__cards_with_the_same_name_must_be_distinguishable', () => {
  it("THE REPORTED SHAPE: three cards named CREDIT CARD are told apart by their last-4", () => {
    const out = cardIdentityLabels(
      [card('a', 'CREDIT CARD'), card('b', 'CREDIT CARD'), card('c', 'CREDIT CARD')],
      { a: '0977', b: '2927', c: '4105' },
    );
    expect(out).toEqual({ a: '····0977', b: '····2927', c: '····4105' });
    expect(new Set(Object.values(out)).size).toBe(3);
  });

  it('numbers EVERY card when two would otherwise render identically', () => {
    // Same name, no last-4 on either — nothing in the data separates them.
    const out = cardIdentityLabels([card('a', 'CREDIT CARD'), card('b', 'CREDIT CARD')], {
      a: null,
      b: null,
    });
    expect(out).toEqual({
      a: `1. ${NO_CARD_NUMBER}`,
      b: `2. ${NO_CARD_NUMBER}`,
    });
  });

  it('numbers the already-unique cards too, so a number never reads as a card property', () => {
    const out = cardIdentityLabels(
      [card('a', 'CREDIT CARD'), card('b', 'CREDIT CARD'), card('c', 'Venture')],
      { a: null, b: null, c: '6271' },
    );
    expect(out).toEqual({
      a: `1. ${NO_CARD_NUMBER}`,
      b: `2. ${NO_CARD_NUMBER}`,
      c: '3. ····6271',
    });
  });

  it('two cards sharing a name AND a last-4 are still told apart', () => {
    const out = cardIdentityLabels([card('a', 'CREDIT CARD'), card('b', 'CREDIT CARD')], {
      a: '0977',
      b: '0977',
    });
    expect(new Set(Object.values(out)).size).toBe(2);
    expect(out).toEqual({ a: '1. ····0977', b: '2. ····0977' });
  });

  it('leaves distinct names alone even when one has no last-4', () => {
    const out = cardIdentityLabels([card('a', 'Venture'), card('b', 'Spark Miles')], {
      a: '6271',
      b: null,
    });
    expect(out).toEqual({ a: '····6271' });
  });
});

describe('test_regression__card_identity_cannot_be_forged_by_a_card_name', () => {
  /**
   * #297's critic falsified suffix-appending: the rewrite writes into the same string space it
   * compares. The prefix here cannot be reached by a name, because the digits are followed by '.'
   * at a fixed offset. These names try to forge a tie anyway.
   */
  const hostile: { name: string; rows: CardIdentityInput[]; masks: Record<string, string | null> }[] =
    [
      {
        name: 'a name that looks like our own numbering',
        rows: [card('a', '1. ····0977'), card('b', '1. ····0977')],
        masks: { a: null, b: null },
      },
      {
        name: 'a name containing the no-number phrase',
        rows: [card('a', NO_CARD_NUMBER), card('b', NO_CARD_NUMBER)],
        masks: { a: null, b: null },
      },
      {
        name: 'names differing only by invisible characters',
        rows: [card('a', 'CREDIT CARD'), card('b', 'CREDIT CARD '), card('c', 'CREDIT​CARD')],
        masks: { a: null, b: null, c: null },
      },
      {
        name: 'a mask carrying a bidi override',
        rows: [card('a', 'Venture'), card('b', 'Venture')],
        masks: { a: '‮0977', b: '0977' },
      },
      {
        name: 'ten cards, all identical',
        rows: Array.from({ length: 10 }, (_, i) => card(`c${i}`, 'CREDIT CARD')),
        masks: {},
      },
    ];

  it.each(hostile)('no two identity lines can tie — $name', ({ rows, masks }) => {
    const out = cardIdentityLabels(rows, masks);
    const values = Object.values(out);
    expect(values).toHaveLength(rows.length);
    expect(new Set(values).size).toBe(rows.length);
  });

  it('strips a bidi override rather than rendering it', () => {
    const out = cardIdentityLabels([card('a', 'Venture'), card('b', 'Venture')], {
      a: '‮0977',
      b: '2927',
    });
    for (const v of Object.values(out)) expect(v).not.toContain('‮');
  });
});

describe('cardIdentityLabels — never invents a card number', () => {
  it('does not parse a last-4 out of the NAME (the #292 mis-read direction)', () => {
    // "Roth IRA (2021)" and the x in "Amex" both mis-read as a last-4 in #292. A mis-read printed
    // as THIS card's number would be a false claim about which card to pay.
    const out = cardIdentityLabels([card('a', 'Roth IRA (2021)'), card('b', 'Amex Gold')], {
      a: null,
      b: null,
    });
    expect(out).toEqual({});
  });

  it('says plainly that no number arrived, rather than printing a placeholder digit', () => {
    const out = cardIdentityLabels([card('a', 'CREDIT CARD'), card('b', 'CREDIT CARD')], {});
    for (const v of Object.values(out)) {
      expect(v).toContain(NO_CARD_NUMBER);
      expect(v).not.toContain('····');
    }
  });
});

/**
 * CRITIC CYCLE 1 (#298) — a fresh-context critic returned 4 P1s + 4 P2s, each with an executed
 * repro. Every one is locked below.
 */
describe('test_regression__card_identity_compares_what_is_painted', () => {
  it('a card NAMED like another card+mask still forces the numbering', () => {
    // Executed by the critic: "Venture" + mask 0977 paints "Venture ····0977", and so does a card
    // literally named "Venture ····0977" with no mask. Any separator-joined key calls those two
    // distinct and skips the numbering, leaving two identical headings on screen.
    const out = cardIdentityLabels(
      [card('a', 'Venture'), card('b', 'Venture ····0977')],
      { a: '0977', b: null },
    );
    const values = Object.values(out);
    expect(values).toHaveLength(2);
    expect(new Set(values).size).toBe(2);
  });
});

describe('test_regression__card_identity_never_prints_more_than_a_last_four', () => {
  it('a full card number in the mask column is reduced to its last four', () => {
    // Nothing enforces schema.prisma's "last 4 only" comment; Plaid's value is stored verbatim.
    const out = cardIdentityLabels([card('a', 'Venture')], { a: '4111111111111111' });
    expect(out.a).toBe('····1111');
    expect(out.a).not.toContain('4111111111111');
  });

  it('does not claim four digits when the issuer sent fewer', () => {
    const out = cardIdentityLabels([card('a', 'Venture')], { a: '12' });
    expect(out.a).toBe('ending 12');
    expect(out.a).not.toContain('····');
  });

  it('treats a mask with no digits at all as no number', () => {
    expect(cardIdentityLabels([card('a', 'Venture')], { a: '  ' })).toEqual({});
    expect(cardIdentityLabels([card('a', 'Venture')], { a: 'n/a' })).toEqual({});
  });

  it('strips separators a feed might include', () => {
    expect(cardIdentityLabels([card('a', 'Venture')], { a: '••••0977' }).a).toBe('····0977');
  });
});

describe('test_regression__card_identity_numbers_follow_the_given_order', () => {
  it('numbers by position in the array it is handed, so the caller can pass DISPLAY order', () => {
    // The component passes `ordered` (sorted by due date), so the numbers read 1,2,3 down the page.
    // Numbering the unsorted engine output printed "3." above "1." — a position it did not have.
    const out = cardIdentityLabels(
      [card('c', 'CREDIT CARD'), card('a', 'CREDIT CARD'), card('b', 'CREDIT CARD')],
      {},
    );
    expect(out.c.startsWith('1. ')).toBe(true);
    expect(out.a.startsWith('2. ')).toBe(true);
    expect(out.b.startsWith('3. ')).toBe(true);
  });
});
