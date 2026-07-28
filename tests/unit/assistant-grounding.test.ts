/**
 * Ask Aimplifi — seed grounding (DECISIONS #75). Proves the assistant never
 * invents a number: run the full parse → engine → format pipeline on the real
 * seed and assert each answer ties back to the SAME tested engine the dedicated
 * view uses (netWorthCents, spendingByCategory, monthlyFlows), with no drift.
 *
 * Like the trends "real-seed pinned" test, the in-memory seed predates DB
 * categorization, so categories are derived here via the shared normalizer —
 * standing in for a user's categorized transactions.
 */
import { describe, expect, it } from 'vitest';
import { isoDate } from '@/lib/dates';
import { buildSeedData } from '@/lib/seed/build';
import { formatCents, type Cents } from '@/lib/money';
import { netWorthCents } from '@/lib/engine/cash-needed/assemble';
import { normalizeMerchant } from '@/lib/engine/categorize/normalize';
import { spendingByCategory, type ReportTxn } from '@/lib/engine/reports/reports';
import { monthlyFlows } from '@/lib/engine/fi/insights';
import { computeSpendingTrends, type TrendTxn } from '@/lib/engine/trends/trends';
import { toTrendTxns } from '@/server/trends';
import { parseAssistantQuery, type Timeframe } from '@/lib/engine/assistant/intent';
import {
  answerIncome,
  answerLargest,
  answerMerchantSpend,
  answerNetWorth,
  answerSpendByCategory,
  answerSpendTotal,
  assistantAccounts,
  largestPurchases,
  merchantSpend,
  type AskTxnRow,
} from '@/lib/engine/assistant/answer';

const TODAY = isoDate('2026-06-10'); // the pinned demo date
const seed = buildSeedData('2026-06-10');
const fmt = (n: number) => formatCents(n as Cents);

const reportTxns: ReportTxn[] = seed.transactions.map((t) => ({
  date: t.date,
  amountCents: t.amountCents,
  categoryId: normalizeMerchant(t.rawDescriptor).categoryId,
  isTransfer: t.isTransfer,
  isSplitParent: false,
}));
// The FULL universe, unnarrowed — `toAskTxnRows`'s own shape (O.7). It is no
// longer POSTED-filtered here: `largestPurchases` applies that itself, and
// `merchantSpend` deliberately does not.
const purchaseRows: AskTxnRow[] = seed.transactions.map((t) => {
  const m = normalizeMerchant(t.rawDescriptor);
  return {
    date: t.date,
    amountCents: t.amountCents,
    status: t.status,
    // BOTH fields carry the merchant category, because that is what production
    // holds: the seed builder emits no stored category, but `prisma/seed.ts`
    // runs `categorize()` before writing, so a persisted row's `categoryId` is
    // never null — worst case it is the string 'uncategorized'.
    //
    // An O.7 critic caught this fixture set to `categoryId: null` and executed
    // the consequence: `merchantSpend` buckets by the STORED column alone, so a
    // null made every row bucket as 'uncategorized' and `isSpendRow`'s
    // Income-group exclusion never fired. The seed's 11 payroll rows became
    // "count 11, −$26,950.00" — a merchant answer production cannot produce, in
    // the one test whose job is grounding Ask against the real dataset.
    categoryId: m.categoryId ?? null,
    merchantCategoryId: m.categoryId ?? null,
    aggregateMerchant: m.aggregate,
    isTransfer: t.isTransfer,
    isSplitParent: false,
    merchant: m.canonical,
  };
});

const THIS_MONTH: Timeframe = { fromYm: '2026-06', toYm: '2026-06', label: 'this month' };
const LAST_MONTH: Timeframe = { fromYm: '2026-05', toYm: '2026-05', label: 'last month' };

describe('net worth answer == netWorthCents engine', () => {
  it('ties exactly', () => {
    const expected = netWorthCents(seed.accounts);
    // `assistantAccounts` is the one boundary conversion (TASKS L.18) — the seed rows carry no
    // frozen stamp, so this asserts the untouched path: same headline as before the disclosure.
    expect(answerNetWorth(assistantAccounts(seed.accounts, new Set())).headline).toBe(
      `Your net worth is ${fmt(expected)}.`,
    );
  });
});

describe('spend answers == spendingByCategory engine', () => {
  it('spend_total ties to the breakdown total (and the seed has June spend)', () => {
    const i = parseAssistantQuery('how much did I spend this month', TODAY);
    expect(i.kind).toBe('spend_total');
    const breakdown = spendingByCategory(reportTxns, THIS_MONTH);
    expect(breakdown.totalCents).toBeGreaterThan(0);
    expect(answerSpendTotal(breakdown, THIS_MONTH).headline).toBe(`You spent ${fmt(breakdown.totalCents)} this month.`);
  });

  it('spend_by_category groceries ties to that category bucket', () => {
    const i = parseAssistantQuery('how much did I spend on groceries last month', TODAY);
    expect(i.kind).toBe('spend_by_category');
    const breakdown = spendingByCategory(reportTxns, LAST_MONTH);
    const groceries = breakdown.byCategory.find((c) => c.categoryId === 'groceries')?.amountCents ?? 0;
    expect(groceries).toBeGreaterThan(0); // the seed has grocery spend (KROGER/COSTCO…)
    const a = answerSpendByCategory(breakdown, { type: 'category', categoryId: 'groceries', label: 'Groceries' }, LAST_MONTH);
    expect(a.headline).toBe(`You spent ${fmt(groceries)} on Groceries last month.`);
  });
});

describe('income answer == monthlyFlows engine (FULL rows, like the server)', () => {
  it('ties to last month income (pinned $7,400.00)', () => {
    // The server passes snap.transactions straight to monthlyFlows (preserving
    // categoryId + isSplitParent at runtime) — NOT a stripped subset (F3). Mirror that.
    const flows = monthlyFlows(seed.transactions);
    const may = flows.find((f) => f.month === '2026-05');
    expect(may).toBeDefined();
    expect(may!.incomeCents).toBe(740000); // pinned: May biweekly payroll
    expect(answerIncome(may!.incomeCents, LAST_MONTH).headline).toBe('You brought in $7,400.00 last month.');
  });
});

describe('F3 regression — full rows net refunds and exclude split parents', () => {
  it('monthlyFlows(full rows with categoryId) nets a refund and drops a split parent', () => {
    const rows = [
      { date: '2026-06-01', amountCents: 500000, rawDescriptor: 'ACME PAYROLL', accountId: 'a', isTransfer: false, status: 'POSTED', categoryId: 'income', isSplitParent: false },
      { date: '2026-06-05', amountCents: -20000, rawDescriptor: 'TARGET', accountId: 'a', isTransfer: false, status: 'POSTED', categoryId: 'shopping', isSplitParent: false },
      { date: '2026-06-09', amountCents: 5000, rawDescriptor: 'TARGET REFUND', accountId: 'a', isTransfer: false, status: 'POSTED', categoryId: 'shopping', isSplitParent: false },
      // a split parent container that must be excluded (its children carry amounts)
      { date: '2026-06-10', amountCents: -9999, rawDescriptor: 'SPLIT PARENT', accountId: 'a', isTransfer: false, status: 'POSTED', categoryId: 'shopping', isSplitParent: true },
    ];
    const jun = monthlyFlows(rows).find((f) => f.month === '2026-06')!;
    // refund nets DOWN shopping spend (200 − 50 = 150), NOT counted as income; split parent ignored
    expect(jun.incomeCents).toBe(500000);
    expect(jun.expensesCents).toBe(15000);
    // had the server stripped categoryId (the old bug), the +50 refund would have been income (505000).
  });
});

describe('largest purchases == /trends computeLargest (POSTED only), pinned', () => {
  it('matches the trends engine exactly and excludes pending charges', () => {
    // Build the trends input the SAME way the /trends server does — and after O.6
    // that is `toTrendTxns` itself rather than a hand-rolled copy of it, which is
    // the point: a critic found this fixture still passing the normalizer's
    // category as `categoryId` while production had moved to the stored column,
    // so the two sides of the parity assertion were reading different bases and
    // the test could not fail on the difference.
    //
    // Note also there is NO status pre-filter here: every row is handed to the
    // engine, which narrows to settled rows for `largest` itself. Feeding the
    // pending rows in is what makes the assertion meaningful, because it is now
    // the engine's own split — not this test's filter — keeping the pending
    // Amazon row out of both sides.
    const trendTxns: TrendTxn[] = toTrendTxns(seed.transactions);
    const trendsLargest = computeSpendingTrends({ txns: trendTxns, today: '2026-06-10' }).largest;
    const mine = largestPurchases(purchaseRows, THIS_MONTH, trendsLargest.length || 5, '2026-06-10');
    expect(mine).toEqual(trendsLargest); // byte-for-byte parity with /trends (same window, <= today, tie-break)

    // Pinned full top-5 (pending Amazon -$43.18 correctly EXCLUDED). #249: the
    // engineered Blue Bottle anomaly ($214.36 on 2026-06-02) is now #1 — the SAME
    // charge the Unusual Charge Radar flags, so Ask and the radar agree by
    // construction; Publix ($42.58) dropped to #6.
    expect(mine.slice(0, 5).map((t) => [t.merchant, t.amountCents])).toEqual([
      ['Blue Bottle Coffee', 21436],
      ['Costco', 15844],
      ["Lowe's", 15658],
      ["Trader Joe's", 5180],
      ['Store Card Purchase', 4350],
    ]);
    expect(answerLargest(mine, THIS_MONTH).headline).toBe('Your biggest purchase this month was $214.36 at Blue Bottle Coffee.');
  });
});

describe('merchant_spend == summed seed purchases for that merchant (#168), pinned', () => {
  it('answers "how much did I spend at costco" from the real seed, no invented number', () => {
    const i = parseAssistantQuery('how much did I spend at costco this month', TODAY);
    expect(i.kind).toBe('merchant_spend');
    if (i.kind !== 'merchant_spend') return;
    expect(i.merchant).toBe('costco');
    const res = merchantSpend(purchaseRows, i.timeframe, i.merchant, '2026-06-10');
    // Independent recomputation over the SAME rows — and it mirrors the O.7
    // basis, so it stays a real check rather than agreeing by luck: no status
    // filter (pending counts) and no sign filter (a refund nets). These rows
    // carry no stored category, so they bucket as `uncategorized`, whose group
    // is neither Income nor `transfer` — nothing here is group-excluded.
    const expected = purchaseRows.filter((t) => {
      const c = t.merchant.toLowerCase();
      return (
        t.date.slice(0, 7) === '2026-06' &&
        t.date <= '2026-06-10' &&
        !t.isTransfer &&
        !t.isSplitParent &&
        (c === 'costco' || c.startsWith('costco '))
      );
    });
    const expectedTotal = expected.reduce((s, t) => s - t.amountCents, 0);
    expect(res.totalCents).toBe(expectedTotal);
    expect(res.count).toBe(expected.length);
    expect(res.totalCents).toBeGreaterThan(0);
    expect(res.merchant).toBe('Costco');
    // The seed's biggest June purchase ($158.44 at Costco) is one of these.
    expect(res.totalCents).toBeGreaterThanOrEqual(15844);
    expect(answerMerchantSpend(res, THIS_MONTH).headline).toBe(`You spent ${fmt(res.totalCents)} at Costco this month.`);
  });

  it('O.7: the seed\'s pending Amazon charge is counted, not dropped', () => {
    // The demo's only June Amazon row on or before today is PENDING (−$43.18,
    // build.ts:541), so under the old POSTED-only basis this engine returned
    // ZERO rows for a charge sitting in the register. Reverting the basis makes
    // count 0 and this fails.
    //
    // Scope of the claim, corrected after an e2e run falsified the first version:
    // this is an ENGINE fact, not a user-visible one. "How much did I spend at
    // Amazon" never reaches `merchant_spend` — `resolveSpendTarget` runs first
    // and the deliberate Amazon→shopping synonym (#168) routes it to a category
    // answer. The user-visible version of this change is locked on Blue Bottle
    // in ask.spec.ts, which does route here.
    const res = merchantSpend(purchaseRows, THIS_MONTH, 'amazon', '2026-06-10');
    expect(res.count).toBe(1);
    expect(res.totalCents).toBe(4318);
    expect(res.pendingPurchaseCents).toBe(4318);
    const a = answerMerchantSpend(res, THIS_MONTH);
    expect(a.headline).toBe('You spent $43.18 at Amazon this month.');
    // …and it says WHY it disagrees with a bank statement, rather than counting
    // unsettled money silently.
    expect(a.detail).toBe('Across 1 purchase. Includes $43.18 still pending.');
  });

  it('O.7: the seed\'s Blue Bottle total is the one a reader can actually reach', () => {
    // This IS parser-reachable (no category synonym intercepts it), so it is the
    // demo figure that visibly moved: $239.38 POSTED-only → $246.13 with the
    // seeded pending $6.75 (build.ts:540). ask.spec.ts asserts the same two
    // strings against the rendered page.
    const res = merchantSpend(purchaseRows, THIS_MONTH, 'blue bottle', '2026-06-10');
    expect(res.totalCents).toBe(24613);
    expect(res.pendingPurchaseCents).toBe(675);
    const a = answerMerchantSpend(res, THIS_MONTH);
    expect(a.headline).toBe('You spent $246.13 at Blue Bottle Coffee this month.');
    expect(a.detail).toContain('Includes $6.75 still pending.');
  });

  it('an apostrophe-less "trader joes" matches the possessive seed canonical (#168 P1)', () => {
    // The seed descriptor 'TRADER JOE S #735' normalizes to "Trader Joe's"; a user
    // typing "trader joes" (no apostrophe) must still get their real spend, not a
    // false "No spending". The pinned largest test proves TJ's ($51.80) is in June.
    const i = parseAssistantQuery('how much did I spend at trader joes this month', TODAY);
    expect(i.kind).toBe('merchant_spend');
    if (i.kind !== 'merchant_spend') return;
    const res = merchantSpend(purchaseRows, i.timeframe, i.merchant, '2026-06-10');
    expect(res.merchant).toBe("Trader Joe's");
    expect(res.count).toBeGreaterThanOrEqual(1);
    expect(res.totalCents).toBeGreaterThanOrEqual(5180);
  });
});
