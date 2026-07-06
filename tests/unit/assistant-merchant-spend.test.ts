/**
 * Ask Aimplifi — per-merchant spend intent (#168). Pure aggregator + formatter.
 * `merchantSpend` reuses the same `isPurchaseRow` definition as largest/trends,
 * so a transfer / income / out-of-window / future row can never be counted, and
 * the display name is derived from the DATA (the canonical with the largest
 * matched total), never fabricated. Every dollar figure below is hand-verified.
 * THIS_MONTH = 2026-06; today pinned per-test.
 */
import { describe, expect, it } from 'vitest';
import { answerMerchantSpend, merchantSpend, type PurchaseRow } from '@/lib/engine/assistant/answer';
import type { Timeframe } from '@/lib/engine/assistant/intent';

const THIS_MONTH: Timeframe = { fromYm: '2026-06', toYm: '2026-06', label: 'this month' };

describe('merchantSpend — aggregation', () => {
  const rows: PurchaseRow[] = [
    { date: '2026-06-05', amountCents: -10000, categoryId: 'groceries', merchant: 'Costco' },
    { date: '2026-06-10', amountCents: -7000, categoryId: 'fuel', merchant: 'Costco Gas' }, // prefix-matches "costco"
    { date: '2026-06-20', amountCents: -5000, categoryId: 'groceries', merchant: 'Costco' }, // future (> today) excluded
    { date: '2026-06-07', amountCents: -8000, isTransfer: true, categoryId: 'groceries', merchant: 'Costco' }, // transfer excluded
    { date: '2026-06-08', amountCents: -3000, categoryId: 'fuel', merchant: 'Chevron' }, // other merchant excluded
    { date: '2026-05-30', amountCents: -99999, categoryId: 'groceries', merchant: 'Costco' }, // out of window excluded
    { date: '2026-06-06', amountCents: 4000, categoryId: 'refund', merchant: 'Costco' }, // inflow excluded
  ];

  it('sums only in-window, non-transfer, non-future, outflow purchases for the merchant', () => {
    const res = merchantSpend(rows, THIS_MONTH, 'costco', '2026-06-15');
    expect(res.totalCents).toBe(17000); // 10000 + 7000
    expect(res.count).toBe(2);
  });

  it('derives the display name from the largest-contributing canonical (proper casing)', () => {
    const res = merchantSpend(rows, THIS_MONTH, 'costco', '2026-06-15');
    // Costco ($100) > Costco Gas ($70) → "Costco", not the title-cased query
    expect(res.merchant).toBe('Costco');
  });

  it('returns matched items amount-desc, most-recent-first on a tie', () => {
    const tie: PurchaseRow[] = [
      { date: '2026-06-03', amountCents: -5000, categoryId: 'groceries', merchant: 'Costco' },
      { date: '2026-06-08', amountCents: -5000, categoryId: 'groceries', merchant: 'Costco' },
      { date: '2026-06-01', amountCents: -9000, categoryId: 'groceries', merchant: 'Costco' },
    ];
    const res = merchantSpend(tie, THIS_MONTH, 'costco', '2026-06-30');
    expect(res.items.map((i) => [i.date, i.amountCents])).toEqual([
      ['2026-06-01', 9000],
      ['2026-06-08', 5000], // later date first on the equal-amount tie
      ['2026-06-03', 5000],
    ]);
  });

  it('groups multiple Amazon canonicals under a whole-word prefix match', () => {
    const amzn: PurchaseRow[] = [
      { date: '2026-06-05', amountCents: -5000, categoryId: 'shopping', merchant: 'Amazon' },
      { date: '2026-06-06', amountCents: -1500, categoryId: 'subscriptions', merchant: 'Amazon Prime' },
    ];
    const res = merchantSpend(amzn, THIS_MONTH, 'amazon', '2026-06-30');
    expect(res.totalCents).toBe(6500);
    expect(res.count).toBe(2);
    expect(res.merchant).toBe('Amazon'); // larger contributor
  });

  it('is token-safe: "app" does not match "Apple"', () => {
    const apple: PurchaseRow[] = [{ date: '2026-06-05', amountCents: -2000, categoryId: 'software', merchant: 'Apple' }];
    expect(merchantSpend(apple, THIS_MONTH, 'app', '2026-06-30').count).toBe(0);
  });

  it('matches an apostrophe-less typed term to a possessive canonical (#168 P1)', () => {
    // A user types "mcdonalds"/"trader joes"/"lowes"; the table canonical has the
    // apostrophe. Punctuation folding must still match — else a confident-wrong
    // "No spending at Mcdonalds" despite real spend.
    const rows: PurchaseRow[] = [
      { date: '2026-06-05', amountCents: -1200, categoryId: 'fast-food', merchant: "McDonald's" },
      { date: '2026-06-06', amountCents: -4800, categoryId: 'groceries', merchant: "Trader Joe's" },
      { date: '2026-06-07', amountCents: -9000, categoryId: 'home-improvement', merchant: "Lowe's" },
    ];
    expect(merchantSpend(rows, THIS_MONTH, 'mcdonalds', '2026-06-30')).toMatchObject({ merchant: "McDonald's", totalCents: 1200, count: 1 });
    expect(merchantSpend(rows, THIS_MONTH, 'trader joes', '2026-06-30')).toMatchObject({ merchant: "Trader Joe's", totalCents: 4800, count: 1 });
    expect(merchantSpend(rows, THIS_MONTH, 'lowes', '2026-06-30')).toMatchObject({ merchant: "Lowe's", totalCents: 9000, count: 1 });
    // and the apostrophe-typed form still works
    expect(merchantSpend(rows, THIS_MONTH, "mcdonald's", '2026-06-30').count).toBe(1);
  });

  it('excludes the transfer categoryId even without the isTransfer flag', () => {
    const xfer: PurchaseRow[] = [{ date: '2026-06-05', amountCents: -2000, categoryId: 'transfer', merchant: 'Costco' }];
    expect(merchantSpend(xfer, THIS_MONTH, 'costco', '2026-06-30').count).toBe(0);
  });

  it('empty result keeps the title-cased query as the display name', () => {
    const res = merchantSpend([], THIS_MONTH, 'whole foods', '2026-06-30');
    expect(res).toEqual({ merchant: 'Whole Foods', totalCents: 0, count: 0, items: [] });
  });
});

describe('answerMerchantSpend — formatting', () => {
  it('formats the headline, count detail, and per-purchase facts', () => {
    const res = merchantSpend(
      [
        { date: '2026-06-05', amountCents: -10000, categoryId: 'groceries', merchant: 'Costco' },
        { date: '2026-06-10', amountCents: -7000, categoryId: 'fuel', merchant: 'Costco Gas' },
      ],
      THIS_MONTH,
      'costco',
      '2026-06-30',
    );
    const a = answerMerchantSpend(res, THIS_MONTH);
    expect(a.headline).toBe('You spent $170.00 at Costco this month.');
    expect(a.detail).toBe('Across 2 purchases.');
    expect(a.facts[0]).toEqual({ label: 'Costco · Jun 5, 2026', value: '$100.00' });
    expect(a.facts[1]).toEqual({ label: 'Costco Gas · Jun 10, 2026', value: '$70.00' });
    expect(a.source).toEqual({ label: 'See activity', href: '/transactions' });
  });

  it('uses the singular "purchase" for a single match', () => {
    const res = merchantSpend([{ date: '2026-06-05', amountCents: -2500, categoryId: 'fast-food', merchant: 'Chipotle' }], THIS_MONTH, 'chipotle', '2026-06-30');
    const a = answerMerchantSpend(res, THIS_MONTH);
    expect(a.headline).toBe('You spent $25.00 at Chipotle this month.');
    expect(a.detail).toBe('Across 1 purchase.');
  });

  it('gives an honest empty answer when the merchant has no spend', () => {
    const a = answerMerchantSpend(merchantSpend([], THIS_MONTH, 'target', '2026-06-30'), THIS_MONTH);
    expect(a.headline).toBe('No spending at Target this month.');
    expect(a.facts).toEqual([]);
    expect(a.detail).toBeUndefined();
  });
});
