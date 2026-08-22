/**
 * P2.2 — memory-dividend reflection. Reuses discretionary + dial flags.
 * No new money math. The line must not appear on necessities or dials,
 * and copy must not claim "this card" or "below".
 */
import { describe, expect, it } from 'vitest';
import { CATEGORY_BY_ID } from '@/lib/engine/categorize/categories';
import { COACH_COPY } from '@/lib/engine/fi/coach-copy';
import {
  composeMemoryDividend,
  memoryDividendApplies,
} from '@/lib/engine/fi/memory-dividend';

const meta = CATEGORY_BY_ID;

describe('memoryDividendApplies — discretionary and not a dial', () => {
  it('test_regression__memory_dividend_skips_dials_and_necessities', () => {
    expect(
      memoryDividendApplies([{ categoryId: 'shopping' }], [], meta),
    ).toBe(true);
    expect(
      memoryDividendApplies([{ categoryId: 'shopping' }], ['shopping'], meta),
    ).toBe(false);
    expect(
      memoryDividendApplies([{ categoryId: 'travel' }], ['travel', 'dining'], meta),
    ).toBe(false);
    expect(
      memoryDividendApplies([{ categoryId: 'rent' }], [], meta),
    ).toBe(false);
    expect(
      memoryDividendApplies([{ categoryId: 'rent' }, { categoryId: 'travel' }], ['travel'], meta),
    ).toBe(false);
    expect(
      memoryDividendApplies(
        [{ categoryId: 'rent' }, { categoryId: 'shopping' }],
        ['travel', 'dining'],
        meta,
      ),
    ).toBe(true);
    expect(memoryDividendApplies([], ['shopping'], meta)).toBe(false);
    expect(memoryDividendApplies([{ categoryId: null }], [], meta)).toBe(false);
    expect(memoryDividendApplies([{ categoryId: 'uncategorized' }], [], meta)).toBe(false);
  });
});

describe('composeMemoryDividend — one basis for Coach and Ask', () => {
  it('reflects only when a listed buy is discretionary and not a dial', () => {
    const shown = composeMemoryDividend({
      items: [{ categoryId: 'shopping' }],
      moneyDialIds: ['travel', 'dining'],
      meta,
    });
    expect(shown).toEqual({
      kind: 'reflect',
      show: true,
      line: COACH_COPY.memoryDividend(),
    });

    const silentDials = composeMemoryDividend({
      items: [{ categoryId: 'travel' }, { categoryId: 'dining' }],
      moneyDialIds: ['travel', 'dining'],
      meta,
    });
    expect(silentDials.kind).toBe('not_applicable');
    expect(silentDials.show).toBe(false);
    expect(silentDials.line).toBe(COACH_COPY.memoryDividendNotApplicable());

    const silentRent = composeMemoryDividend({
      items: [{ categoryId: 'rent' }],
      moneyDialIds: [],
      meta,
    });
    expect(silentRent.kind).toBe('not_applicable');
    expect(silentRent.show).toBe(false);

    const empty = composeMemoryDividend({ items: [], moneyDialIds: [], meta });
    expect(empty).toEqual({
      kind: 'empty',
      show: false,
      line: COACH_COPY.memoryDividendEmpty(),
    });
  });

  it('test_regression__memory_dividend_copy_does_not_claim_this_card_or_below', () => {
    const texts = [
      COACH_COPY.memoryDividend(),
      COACH_COPY.memoryDividendEmpty(),
      COACH_COPY.memoryDividendNotApplicable(),
    ];
    for (const text of texts) {
      expect(text).not.toMatch(/\bthis card\b/i);
      expect(text).not.toMatch(/\bbelow\b/i);
    }
  });
});
