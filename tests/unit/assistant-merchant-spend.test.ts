/**
 * Ask Aimplifi — per-merchant spend intent (#168, rebased by O.7). Pure
 * aggregator + formatter.
 *
 * `merchantSpend` is an AGGREGATE over a window, so it reads the reports
 * engine's own `isSpendRow` — the same rows `spendingByCategory` counts:
 * PENDING included, refunds netted, transfers / income / out-of-window
 * excluded. It does NOT share `largestPurchases`' purchase predicate any more;
 * that one names a row as a settled fact and stays POSTED-only. The display
 * name is derived from the DATA (the canonical with the largest matched
 * magnitude), never fabricated. Every dollar figure below is hand-verified.
 * THIS_MONTH = 2026-06; today pinned per-test.
 */
import { describe, expect, it } from 'vitest';
import {
  answerMerchantSpend,
  answerSpendTotal,
  largestPurchases,
  merchantSpend,
  toAskTxnRows,
  type AskTxnRow,
} from '@/lib/engine/assistant/answer';
import { traceMerchantSpend, traceSpendTotal } from '@/lib/engine/assistant/trace';
import { CATEGORY_BY_ID } from '@/lib/engine/categorize/categories';
import { spendingByCategory } from '@/lib/engine/reports/reports';
import type { Timeframe } from '@/lib/engine/assistant/intent';

const THIS_MONTH: Timeframe = { fromYm: '2026-06', toYm: '2026-06', label: 'this month' };

describe('merchantSpend — aggregation', () => {
  const rows: AskTxnRow[] = [
    { date: '2026-06-05', amountCents: -10000, categoryId: 'groceries', merchant: 'Costco', status: 'POSTED', merchantCategoryId: null, aggregateMerchant: false },
    { date: '2026-06-10', amountCents: -7000, categoryId: 'fuel', merchant: 'Costco Gas', status: 'POSTED', merchantCategoryId: null, aggregateMerchant: false }, // prefix-matches "costco"
    { date: '2026-06-20', amountCents: -5000, categoryId: 'groceries', merchant: 'Costco', status: 'POSTED', merchantCategoryId: null, aggregateMerchant: false }, // future (> today) excluded
    { date: '2026-06-07', amountCents: -8000, isTransfer: true, categoryId: 'groceries', merchant: 'Costco', status: 'POSTED', merchantCategoryId: null, aggregateMerchant: false }, // transfer excluded
    { date: '2026-06-08', amountCents: -3000, categoryId: 'fuel', merchant: 'Chevron', status: 'POSTED', merchantCategoryId: null, aggregateMerchant: false }, // other merchant excluded
    { date: '2026-05-30', amountCents: -99999, categoryId: 'groceries', merchant: 'Costco', status: 'POSTED', merchantCategoryId: null, aggregateMerchant: false }, // out of window excluded
    { date: '2026-06-06', amountCents: 4000, categoryId: 'refund', merchant: 'Costco', status: 'POSTED', merchantCategoryId: null, aggregateMerchant: false }, // inflow excluded
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
    const tie: AskTxnRow[] = [
      { date: '2026-06-03', amountCents: -5000, categoryId: 'groceries', merchant: 'Costco', status: 'POSTED', merchantCategoryId: null, aggregateMerchant: false },
      { date: '2026-06-08', amountCents: -5000, categoryId: 'groceries', merchant: 'Costco', status: 'POSTED', merchantCategoryId: null, aggregateMerchant: false },
      { date: '2026-06-01', amountCents: -9000, categoryId: 'groceries', merchant: 'Costco', status: 'POSTED', merchantCategoryId: null, aggregateMerchant: false },
    ];
    const res = merchantSpend(tie, THIS_MONTH, 'costco', '2026-06-30');
    expect(res.items.map((i) => [i.date, i.amountCents])).toEqual([
      ['2026-06-01', 9000],
      ['2026-06-08', 5000], // later date first on the equal-amount tie
      ['2026-06-03', 5000],
    ]);
  });

  it('groups multiple Amazon canonicals under a whole-word prefix match', () => {
    const amzn: AskTxnRow[] = [
      { date: '2026-06-05', amountCents: -5000, categoryId: 'shopping', merchant: 'Amazon', status: 'POSTED', merchantCategoryId: null, aggregateMerchant: false },
      { date: '2026-06-06', amountCents: -1500, categoryId: 'subscriptions', merchant: 'Amazon Prime', status: 'POSTED', merchantCategoryId: null, aggregateMerchant: false },
    ];
    const res = merchantSpend(amzn, THIS_MONTH, 'amazon', '2026-06-30');
    expect(res.totalCents).toBe(6500);
    expect(res.count).toBe(2);
    expect(res.merchant).toBe('Amazon'); // larger contributor
  });

  it('is token-safe: "app" does not match "Apple"', () => {
    const apple: AskTxnRow[] = [{ date: '2026-06-05', amountCents: -2000, categoryId: 'software', merchant: 'Apple', status: 'POSTED', merchantCategoryId: null, aggregateMerchant: false }];
    expect(merchantSpend(apple, THIS_MONTH, 'app', '2026-06-30').count).toBe(0);
  });

  it('matches an apostrophe-less typed term to a possessive canonical (#168 P1)', () => {
    // A user types "mcdonalds"/"trader joes"/"lowes"; the table canonical has the
    // apostrophe. Punctuation folding must still match — else a confident-wrong
    // "No spending at Mcdonalds" despite real spend.
    const rows: AskTxnRow[] = [
      { date: '2026-06-05', amountCents: -1200, categoryId: 'fast-food', merchant: "McDonald's", status: 'POSTED', merchantCategoryId: null, aggregateMerchant: false },
      { date: '2026-06-06', amountCents: -4800, categoryId: 'groceries', merchant: "Trader Joe's", status: 'POSTED', merchantCategoryId: null, aggregateMerchant: false },
      { date: '2026-06-07', amountCents: -9000, categoryId: 'home-improvement', merchant: "Lowe's", status: 'POSTED', merchantCategoryId: null, aggregateMerchant: false },
    ];
    expect(merchantSpend(rows, THIS_MONTH, 'mcdonalds', '2026-06-30')).toMatchObject({ merchant: "McDonald's", totalCents: 1200, count: 1 });
    expect(merchantSpend(rows, THIS_MONTH, 'trader joes', '2026-06-30')).toMatchObject({ merchant: "Trader Joe's", totalCents: 4800, count: 1 });
    expect(merchantSpend(rows, THIS_MONTH, 'lowes', '2026-06-30')).toMatchObject({ merchant: "Lowe's", totalCents: 9000, count: 1 });
    // and the apostrophe-typed form still works
    expect(merchantSpend(rows, THIS_MONTH, "mcdonald's", '2026-06-30').count).toBe(1);
  });

  it('excludes the transfer categoryId even without the isTransfer flag', () => {
    const xfer: AskTxnRow[] = [{ date: '2026-06-05', amountCents: -2000, categoryId: 'transfer', merchant: 'Costco', status: 'POSTED', merchantCategoryId: null, aggregateMerchant: false }];
    expect(merchantSpend(xfer, THIS_MONTH, 'costco', '2026-06-30').count).toBe(0);
  });

  it('empty result keeps the title-cased query as the display name', () => {
    const res = merchantSpend([], THIS_MONTH, 'whole foods', '2026-06-30');
    expect(res).toEqual({
      merchant: 'Whole Foods',
      totalCents: 0,
      count: 0,
      purchaseCount: 0,
      purchaseCents: 0,
      refundCount: 0,
      refundCents: 0,
      pendingPurchaseCents: 0,
      pendingRefundCents: 0,
      excludedAggregateCount: 0,
      excludedLoanPaymentCount: 0,
      excludedLoanPaymentCents: 0,
      items: [],
      countedOnHandoverDays: 0, // U.20: required, like the breakdown's, and 0 is the empty-set truth
    });
  });
});

// ── O.7: the basis, and the two locks that make it non-revert-safe ───────────

describe('merchantSpend — the aggregate basis (O.7)', () => {
  const TODAY = '2026-06-15';
  // One merchant, one category, so the merchant total and the category total are
  // claims about the SAME money and must agree to the cent.
  const rows: AskTxnRow[] = [
    { date: '2026-06-02', amountCents: -12000, categoryId: 'groceries', merchant: 'Costco', status: 'POSTED', merchantCategoryId: null, aggregateMerchant: false },
    { date: '2026-06-12', amountCents: -5000, categoryId: 'groceries', merchant: 'Costco', status: 'PENDING', merchantCategoryId: null, aggregateMerchant: false },
    { date: '2026-06-08', amountCents: 2000, categoryId: 'groceries', merchant: 'Costco', status: 'POSTED', merchantCategoryId: null, aggregateMerchant: false }, // return
  ];

  it('counts PENDING and nets refunds: $120 − $20 + $50 pending = $150.00', () => {
    const res = merchantSpend(rows, THIS_MONTH, 'costco', TODAY);
    // Fails BOTH ways if the basis is reverted: POSTED-only gives 10000 (and
    // gross-only gives 17000), so neither narrowing can come back unnoticed.
    expect(res.totalCents).toBe(15000);
    expect(res.purchaseCount).toBe(2);
    expect(res.purchaseCents).toBe(17000);
    expect(res.refundCount).toBe(1);
    expect(res.refundCents).toBe(2000);
    expect(res.pendingPurchaseCents).toBe(5000);
    expect(res.pendingRefundCents).toBe(0);
    // The signed items always sum to the headline — the trace asserts this at runtime.
    expect(res.items.reduce((s, i) => s + i.amountCents, 0)).toBe(15000);
  });

  it('names the canonical with the most ACTIVITY, not the largest net', () => {
    // Refund-heavy merchants broke the old net-based rule: Costco has $190 of
    // activity ($120 out, $70 back) and Costco Gas only $50, so "Costco" is the
    // store the reader means — but its NET is $50, a tie the old rule could lose,
    // and a net-negative canonical could never be named at all. Reverting
    // `Math.abs(...)` to `-t.amountCents` picks "Costco Gas" and fails here.
    const mixed: AskTxnRow[] = [
      { date: '2026-06-02', amountCents: -12000, categoryId: 'groceries', merchant: 'Costco', status: 'POSTED', merchantCategoryId: null, aggregateMerchant: false },
      { date: '2026-06-03', amountCents: 7000, categoryId: 'groceries', merchant: 'Costco', status: 'POSTED', merchantCategoryId: null, aggregateMerchant: false },
      { date: '2026-06-04', amountCents: -5100, categoryId: 'fuel', merchant: 'Costco Gas', status: 'POSTED', merchantCategoryId: null, aggregateMerchant: false },
    ];
    expect(merchantSpend(mixed, THIS_MONTH, 'costco', TODAY).merchant).toBe('Costco');
  });

  it('THE POINT: the merchant total equals the category total over the same rows', () => {
    // "How much did I spend at Costco this month" and "how much did I spend on
    // groceries this month" describe identical money here, so Ask may not answer
    // them differently (O.6's rule; this divergence is what O.7 existed to close).
    const merchant = merchantSpend(rows, THIS_MONTH, 'costco', TODAY).totalCents;
    const category = spendingByCategory(rows, THIS_MONTH).byCategory.find((c) => c.categoryId === 'groceries');
    expect(category?.amountCents).toBe(15000);
    expect(merchant).toBe(category?.amountCents);
  });

  it('largestPurchases does NOT follow: it still refuses the pending row', () => {
    // The two consumers of `toAskTxnRows` now disagree ON PURPOSE. Deleting the
    // `status === 'POSTED'` line from `largestPurchases` makes the pending $50
    // the answer here, so the narrowing cannot be dropped silently.
    const top = largestPurchases(rows, THIS_MONTH, 5, TODAY, undefined, 'costco');
    expect(top.map((t) => t.amountCents)).toEqual([12000]);
  });

  it('the one surviving divergence from /reports is the future-dated row, and it is deliberate', () => {
    const future: AskTxnRow[] = [
      ...rows,
      { date: '2026-06-25', amountCents: -9900, categoryId: 'groceries', merchant: 'Costco', status: 'POSTED', merchantCategoryId: null, aggregateMerchant: false },
    ];
    // `spendingByCategory` has no `<= today` guard, so it counts money that has
    // not moved; "you spent" may not. Documented in `merchantSpend`'s docblock —
    // if that guard is ever dropped, this assertion changes with it.
    expect(merchantSpend(future, THIS_MONTH, 'costco', TODAY).totalCents).toBe(15000);
    expect(spendingByCategory(future, THIS_MONTH).byCategory.find((c) => c.categoryId === 'groceries')?.amountCents).toBe(24900);
  });
});

describe('answerMerchantSpend — formatting', () => {
  it('formats the headline, count detail, and per-purchase facts', () => {
    const res = merchantSpend(
      [
        { date: '2026-06-05', amountCents: -10000, categoryId: 'groceries', merchant: 'Costco', status: 'POSTED', merchantCategoryId: null, aggregateMerchant: false },
        { date: '2026-06-10', amountCents: -7000, categoryId: 'fuel', merchant: 'Costco Gas', status: 'POSTED', merchantCategoryId: null, aggregateMerchant: false },
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
    const res = merchantSpend([{ date: '2026-06-05', amountCents: -2500, categoryId: 'fast-food', merchant: 'Chipotle', status: 'POSTED', merchantCategoryId: null, aggregateMerchant: false }], THIS_MONTH, 'chipotle', '2026-06-30');
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

// ── O.7 critics: the two guards the basis change nearly gave away ────────────

describe('toAskTxnRows — the builder narrows nothing and merges nothing', () => {
  const snap = (rawDescriptor: string, categoryId: string | null, status = 'POSTED') => [
    { date: '2026-06-05', amountCents: -5000, rawDescriptor, status, isTransfer: false, isSplitParent: false, categoryId },
  ];

  it('carries the merchant category BESIDE the stored one, never merged into it', () => {
    // Mutation-proof for the decision `AskTxnRow`'s docblock spends a paragraph
    // defending. A critic restored the merge (`t.categoryId ?? m.categoryId`) and
    // all 4,640 tests stayed green, so the most-argued line in the slice was
    // unlocked. Merging makes `categoryId` non-null here and fails.
    const [row] = toAskTxnRows(snap('CHIPOTLE 1122', null));
    expect(row.categoryId).toBeNull();
    expect(row.merchantCategoryId).toBe('fast-food');
  });

  it('keeps PENDING rows — the status narrowing belongs to largestPurchases', () => {
    expect(toAskTxnRows(snap('CHIPOTLE 1122', null, 'PENDING'))[0].status).toBe('PENDING');
  });

  it('flags aggregate pseudo-merchants from the normalizer, not from a local list', () => {
    expect(toAskTxnRows(snap('ZELLE PAYMENT TO GREENLEAF', null))[0].aggregateMerchant).toBe(true);
    expect(toAskTxnRows(snap('CHIPOTLE 1122', null))[0].aggregateMerchant).toBe(false);
  });
});

describe('merchantSpend — pseudo-merchants are not stores (O.7 critics, both found it)', () => {
  const TODAY = '2026-06-15';
  // Built through the REAL normalizer, so the test cannot pass by hand-setting a
  // flag the production path would not set.
  const rows = toAskTxnRows([
    { date: '2026-06-04', amountCents: -4927, rawDescriptor: 'ATM WITHDRAWAL 0421', status: 'POSTED', isTransfer: false, isSplitParent: false, categoryId: null },
    { date: '2026-06-06', amountCents: -4000, rawDescriptor: 'APPLE CASH SENT', status: 'POSTED', isTransfer: false, isSplitParent: false, categoryId: null },
    { date: '2026-06-07', amountCents: 10000, rawDescriptor: 'APPLE CASH RECEIVED', status: 'POSTED', isTransfer: false, isSplitParent: false, categoryId: null },
    { date: '2026-06-08', amountCents: -2500, rawDescriptor: 'CHIPOTLE 1122', status: 'POSTED', isTransfer: false, isSplitParent: false, categoryId: null },
  ]);

  it('refuses to total an ATM instead of reporting cash as money spent', () => {
    // The old `isPurchaseRow` rejected the whole `Transfers & Other` group, which
    // was silently doing this job too; `isSpendRow` admits that group (correctly,
    // for a category figure), so moving the basis produced "You spent $49.27 at
    // ATM Withdrawal this month" on the demo seed. Deleting the `aggregateMerchant`
    // filter brings that sentence straight back and fails here.
    const res = merchantSpend(rows, THIS_MONTH, 'atm', TODAY);
    expect(res.count).toBe(0);
    expect(res.totalCents).toBe(0);
    expect(res.excludedAggregateCount).toBe(1);
    const a = answerMerchantSpend(res, THIS_MONTH);
    // Not "No spending at Atm" either — that denies money the reader can see.
    expect(a.headline).toBe("ATM Withdrawal isn't a single store, so there's no merchant total for it this month.");
    expect(a.headlineCents).toBeUndefined();
  });

  it('does not invent a refund out of a two-way app payment', () => {
    // Apple Cash moves money both ways under one canonical. `isSpendRow` has no
    // sign guard, so the receipt read as a return: "Refunds at Apple Cash this
    // month exceeded purchases by $60.00" — nobody sent that reader a refund.
    const a = answerMerchantSpend(merchantSpend(rows, THIS_MONTH, 'apple cash', TODAY), THIS_MONTH);
    expect(a.headline).not.toMatch(/refund/i);
    expect(a.headline).toBe("Apple Cash isn't a single store, so there's no merchant total for it this month.");
  });

  it('a real merchant with no stored category is still answered (the O.6 P0 stays fixed)', () => {
    // The guard is `aggregateMerchant`, NOT the old group exclusion — so an
    // unfiled Chipotle charge still counts instead of vanishing.
    expect(merchantSpend(rows, THIS_MONTH, 'chipotle', TODAY).totalCents).toBe(2500);
  });
});

// ── O.7: the headline is now NET, so it must say so, and a non-positive total
// is several different facts rather than one shared "no spending" (L.29).

describe('answerMerchantSpend — stating the new basis (O.7)', () => {
  const row = (amountCents: number, status = 'POSTED', date = '2026-06-05'): AskTxnRow => ({
    date,
    amountCents,
    categoryId: 'groceries',
    merchant: 'Costco',
    status,
    aggregateMerchant: false,
    merchantCategoryId: null,
  });
  const answerFor = (rows: AskTxnRow[]) =>
    answerMerchantSpend(merchantSpend(rows, THIS_MONTH, 'costco', '2026-06-30'), THIS_MONTH);

  it('names both figures when a refund nets the headline down', () => {
    const a = answerFor([row(-10000), row(2500, 'POSTED', '2026-06-07')]);
    expect(a.headline).toBe('You spent $75.00 at Costco this month.');
    // Without this clause the reader sees one $100.00 purchase under a $75.00
    // headline and has no way to account for the gap.
    expect(a.detail).toBe('Across 1 purchase totalling $100.00, less $25.00 returned.');
    // The refund is a listed row too, signed — never a positive row that would
    // read as another purchase. It sorts last (amount-desc), so on a long list
    // the detail clause above is what carries it.
    expect(a.facts).toEqual([
      { label: 'Costco · Jun 5, 2026', value: '$100.00' },
      { label: 'Costco · Jun 7, 2026', value: '-$25.00' },
    ]);
  });

  it('discloses pending money inline rather than counting it silently', () => {
    const a = answerFor([row(-10000), row(-4000, 'PENDING', '2026-06-09')]);
    expect(a.headline).toBe('You spent $140.00 at Costco this month.');
    expect(a.detail).toBe('Across 2 purchases. Includes $40.00 still pending.');
  });

  it('a pending REFUND is not described as a pending charge', () => {
    // Plaid emits pending credits, so `pendingCents` can be negative. The old
    // single-sentence clause would have called this "1 pending charge".
    const a = answerFor([row(-10000), row(1500, 'PENDING', '2026-06-09')]);
    expect(a.headline).toBe('You spent $85.00 at Costco this month.');
    expect(a.detail).toBe('Across 1 purchase totalling $100.00, less $15.00 returned. Includes $15.00 in pending refunds.');
  });

  it('says nothing new when there is nothing new to say (pre-O.7 copy, verbatim)', () => {
    const a = answerFor([row(-10000), row(-7000, 'POSTED', '2026-06-06')]);
    expect(a.detail).toBe('Across 2 purchases.');
  });

  it('a fully-offset merchant is NOT "no spending" — money moved', () => {
    const a = answerFor([row(-5000), row(5000, 'POSTED', '2026-06-09')]);
    expect(a.headline).toBe('Your purchases at Costco this month were fully offset by refunds.');
    expect(a.detail).toBe('$50.00 spent, $50.00 returned.');
    // No tap-through: the printed figures are not the row sum, and the trace
    // contract forbids offering a reconciliation the rows cannot honor.
    expect(a.headlineCents).toBeUndefined();
  });

  it('refunds beating purchases names the difference, not a zero', () => {
    const a = answerFor([row(-5000), row(8000, 'POSTED', '2026-06-09')]);
    expect(a.headline).toBe('Refunds at Costco this month exceeded purchases by $30.00.');
    expect(a.detail).toBe('$50.00 spent, $80.00 returned.');
    expect(a.headlineCents).toBeUndefined();
  });

  it('refunds with no purchases at all says exactly that', () => {
    const a = answerFor([row(3000)]);
    expect(a.headline).toBe('No purchases at Costco this month.');
    expect(a.detail).toBe('$30.00 came back in refunds.');
    expect(a.headlineCents).toBeUndefined();
  });

  it('only the truly-empty match keeps the "no spending" sentence', () => {
    expect(answerFor([]).headline).toBe('No spending at Costco this month.');
  });

  it('a $0 verification hold is neither a purchase nor a refund', () => {
    // Banks post $0 authorisations (fuel pumps, hotels). Classifying `c >= 0` as
    // a purchase made this answer say "fully offset by refunds" about a merchant
    // with no refunds at all — three false clauses from one row.
    const a = answerFor([row(0, 'PENDING')]);
    expect(a.headline).toBe('No spending at Costco this month.');
    expect(a.detail).toBeUndefined();
  });
});

// ── O.7 critics: the corrected basis copy, pinned so it cannot revert silently.
// Both critics flagged that changed money copy with no test is #328's
// revert-safety finding repeating one slice later, on the strings this time.

describe('the spend-family basis copy states only what the predicate does', () => {
  const FALSE_CLAUSE = /credit-card payments/i;

  it('does not claim credit-card payments are excluded — isSpendRow does not exclude them', () => {
    // `isSpendRow` drops rows FLAGGED as transfers and the `transfer` category,
    // but not the `credit-card-payment` CATEGORY, which Plaid assigns straight
    // from LOAN_PAYMENTS_CREDIT_CARD_PAYMENT (plaid-map.ts:420). A payment to a
    // card this app does not hold has no counterpart to pair, stays unflagged,
    // and is counted — so the old sentence was false. Restoring it fails here.
    const total = answerSpendTotal(
      { totalCents: 50000, countedOnHandoverDays: 0, uncountedOnHandoverDays: [], byCategory: [], byGroup: [] },
      THIS_MONTH,
    );
    // C.26 added the date clause to both sentences (critic cycle 1, P1-6: they
    // read as the COMPLETE rule and the newest exclusion was missing). The O.7
    // assertion this test exists for is the FALSE_CLAUSE one below; the exact
    // strings are pinned alongside it so neither sentence drifts silently.
    expect(total.detail).toBe(
      "Purchases only — transfers and income are excluded, and anything dated after today isn't counted yet.",
    );
    expect(total.detail).not.toMatch(FALSE_CLAUSE);

    const trace = traceSpendTotal({ totalCents: 0, countedOnHandoverDays: 0, uncountedOnHandoverDays: [], byCategory: [], byGroup: [] }, [], THIS_MONTH, CATEGORY_BY_ID);
    expect(trace.basis.join(' ')).not.toMatch(FALSE_CLAUSE);
    expect(trace.basis[0]).toBe(
      'Purchases only — transfers and income are excluded; refunds count against their category; ' +
        'anything dated after today is not counted yet.',
    );
  });

  it('the merchant basis line states pending inclusion and refund netting, and claims neither of the two things it does not do', () => {
    const t = traceMerchantSpend(merchantSpend([], THIS_MONTH, 'costco', '2026-06-30'));
    const basis = t.basis.join(' ');
    expect(basis).toMatch(/pending/i);
    expect(basis).toMatch(/refund/i);
    expect(basis).toMatch(/after today/i);
    expect(basis).not.toMatch(FALSE_CLAUSE);
    expect(basis).not.toMatch(/posted/i); // it is no longer POSTED-only
  });
});

// ─── O.19b — the capped row list states its tail ─────────────────────────────
// The headline figures sum ALL matched rows while the fact list caps at five;
// the tail line is summed from the same `items` array (which sums to
// `totalCents` by contract), SIGNED, so a refund-heavy tail shows "-$X" rather
// than hiding the truncation bias O.10c records.
describe('O.19b — merchant row list states its remainder', () => {
  const purchase = (date: string, cents: number): AskTxnRow => ({
    date,
    amountCents: -cents,
    categoryId: 'groceries',
    merchant: 'Costco',
    status: 'POSTED',
    merchantCategoryId: null,
    aggregateMerchant: false,
  });
  // A counted refund: positive inflow in a SPEND category (income-category
  // inflows are excluded by isSpendRow, per the aggregation tests above).
  const refund = (date: string, cents: number): AskTxnRow => ({
    date,
    amountCents: cents,
    categoryId: 'groceries',
    merchant: 'Costco',
    status: 'POSTED',
    merchantCategoryId: null,
    aggregateMerchant: false,
  });

  it('7 rows: five listed + a signed tail line recomposing the net headline', () => {
    const rows = [
      purchase('2026-06-01', 6000),
      purchase('2026-06-02', 5000),
      purchase('2026-06-03', 4000),
      purchase('2026-06-04', 3000),
      purchase('2026-06-05', 2000),
      purchase('2026-06-06', 1000),
      refund('2026-06-07', 500),
    ];
    const res = merchantSpend(rows, THIS_MONTH, 'costco', '2026-06-30');
    expect(res.totalCents).toBe(20500); // 21000 gross − 500 refund
    const a = answerMerchantSpend(res, THIS_MONTH);
    expect(a.headline).toBe('You spent $205.00 at Costco this month.');
    expect(a.facts).toHaveLength(6);
    expect(a.facts[5].label).toBe('2 more transactions');
    expect(a.facts[5].value).toBe('$5.00'); // $10.00 purchase − $5.00 refund in the tail
  });

  it('refund-heavy tail renders signed negative — the bias is visible, not hidden', () => {
    const rows = [
      purchase('2026-06-01', 3000),
      purchase('2026-06-02', 2000),
      purchase('2026-06-03', 1000),
      purchase('2026-06-04', 900),
      purchase('2026-06-05', 800),
      refund('2026-06-06', 600),
      refund('2026-06-07', 700),
    ];
    const a = answerMerchantSpend(merchantSpend(rows, THIS_MONTH, 'costco', '2026-06-30'), THIS_MONTH);
    expect(a.facts[5].label).toBe('2 more transactions');
    expect(a.facts[5].value).toBe('-$13.00'); // both tail rows are refunds
  });

  it('abstains at exactly five rows', () => {
    const rows = [
      purchase('2026-06-01', 3000),
      purchase('2026-06-02', 2000),
      purchase('2026-06-03', 1000),
      purchase('2026-06-04', 900),
      purchase('2026-06-05', 800),
    ];
    const a = answerMerchantSpend(merchantSpend(rows, THIS_MONTH, 'costco', '2026-06-30'), THIS_MONTH);
    expect(a.facts).toHaveLength(5);
    expect(a.facts.every((f) => !f.label.endsWith('more transactions'))).toBe(true);
  });
});
