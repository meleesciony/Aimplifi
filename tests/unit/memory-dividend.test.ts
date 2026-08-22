/**
 * P2.2 — memory-dividend / who-notices gate on the Life Energy list.
 * No money math. The line is only about discretionary buys outside dials.
 */
import { describe, expect, it } from 'vitest';
import { addMonthsClamped, isoDate } from '@/lib/dates';
import { CATEGORY_BY_ID } from '@/lib/engine/categorize/categories';
import { categorize } from '@/lib/engine/categorize/pipeline';
import { COACH_COPY } from '@/lib/engine/fi/coach-copy';
import {
  lifeEnergyShowsMemoryDividend,
  memoryDividendApplies,
} from '@/lib/engine/fi/memory-dividend';
import { buildSeedData } from '@/lib/seed/build';

const demoDials = ['travel', 'dining'] as const;

describe('memoryDividendApplies — outside dials, discretionary only', () => {
  it('test_regression__memory_dividend_skips_a_money_dial_category', () => {
    expect(memoryDividendApplies('dining', demoDials, CATEGORY_BY_ID)).toBe(false);
    expect(memoryDividendApplies('travel', demoDials, CATEGORY_BY_ID)).toBe(false);
    // O.17a: a dial is an id, not a group. Air travel is not the Travel leaf.
    expect(memoryDividendApplies('air-travel', demoDials, CATEGORY_BY_ID)).toBe(true);
  });

  it('test_regression__memory_dividend_skips_rent_and_uncategorized', () => {
    expect(memoryDividendApplies('rent', demoDials, CATEGORY_BY_ID)).toBe(false);
    expect(memoryDividendApplies('groceries', demoDials, CATEGORY_BY_ID)).toBe(false);
    expect(memoryDividendApplies('uncategorized', demoDials, CATEGORY_BY_ID)).toBe(false);
    expect(memoryDividendApplies(null, demoDials, CATEGORY_BY_ID)).toBe(false);
    expect(memoryDividendApplies('not-a-real-id', demoDials, CATEGORY_BY_ID)).toBe(false);
  });

  it('a discretionary category that is not a dial qualifies', () => {
    expect(memoryDividendApplies('shopping', demoDials, CATEGORY_BY_ID)).toBe(true);
    expect(memoryDividendApplies('electronics', demoDials, CATEGORY_BY_ID)).toBe(true);
    expect(memoryDividendApplies('fitness', demoDials, CATEGORY_BY_ID)).toBe(true);
  });

  it('with no dials declared, every discretionary category qualifies', () => {
    expect(memoryDividendApplies('dining', [], CATEGORY_BY_ID)).toBe(true);
    expect(memoryDividendApplies('rent', [], CATEGORY_BY_ID)).toBe(false);
  });
});

describe('lifeEnergyShowsMemoryDividend — one qualifying row is enough', () => {
  it('test_regression__memory_dividend_hidden_when_every_row_is_a_dial_or_a_need', () => {
    expect(
      lifeEnergyShowsMemoryDividend(
        [{ categoryId: 'rent' }, { categoryId: 'travel' }, { categoryId: 'dining' }],
        demoDials,
        CATEGORY_BY_ID,
      ),
    ).toBe(false);
    expect(lifeEnergyShowsMemoryDividend([], demoDials, CATEGORY_BY_ID)).toBe(false);
  });

  it('a mixed list shows the line because shopping is outside the dials', () => {
    expect(
      lifeEnergyShowsMemoryDividend(
        [{ categoryId: 'rent' }, { categoryId: 'shopping' }, { categoryId: 'travel' }],
        demoDials,
        CATEGORY_BY_ID,
      ),
    ).toBe(true);
  });
});

describe('demo seed — last-90-days top 5 vs travel/dining dials', () => {
  it('test_regression__memory_dividend_demo_seed_shows_the_line', () => {
    const seed = buildSeedData('2026-06-10');
    const today = isoDate('2026-06-10');
    const cutoff = addMonthsClamped(today, -3);
    const items = seed.transactions
      .filter(
        (t) =>
          !t.isTransfer &&
          t.status === 'POSTED' &&
          t.amountCents < 0 &&
          t.date >= cutoff,
      )
      .sort((a, b) => a.amountCents - b.amountCents)
      .slice(0, 5)
      .map((t) => ({
        categoryId: categorize({
          rawDescriptor: t.rawDescriptor,
          amountCents: t.amountCents,
          date: t.date,
          accountId: t.accountId,
        }).categoryId,
      }));
    expect(lifeEnergyShowsMemoryDividend(items, demoDials, CATEGORY_BY_ID)).toBe(true);
  });
});

describe('copy — a lens, not a page-position claim', () => {
  it('test_regression__memory_dividend_copy_does_not_claim_this_card_or_below', () => {
    const text = COACH_COPY.memoryDividend();
    expect(text).toMatch(/money dials/i);
    expect(text).toMatch(/memory you'll keep/i);
    expect(text).not.toMatch(/\bthis card\b/i);
    expect(text).not.toMatch(/\bbelow\b/i);
  });
});
