/**
 * Category breakdowns — the rows behind a category figure.
 *
 * The one assertion that matters here is the PARITY one, and it is written
 * first: both functions are handed the SAME array, and every figure
 * `spendingByCategory` produces must equal the plain sum of the rows
 * `buildCategoryBreakdowns` lists for it. That is the whole claim the expandable
 * panel makes on three surfaces ("these rows add up to exactly the figure
 * above"), so it is pinned against a fixture that contains every population the
 * two could disagree about — a refund, a pending charge, a reader-excluded row,
 * a transfer, a split parent, an income row, and a row one month out of window.
 *
 * A fixture that cannot express the failure certifies nothing (the O.8 lesson),
 * so each of those rows is also asserted individually below: parity alone would
 * pass if BOTH functions dropped a population they should have counted.
 */
import { describe, expect, it } from 'vitest';
import {
  BREAKDOWN_BASIS,
  breakdownEmptyCopy,
  breakdownNetRefundCopy,
  buildCategoryBreakdowns,
  type BreakdownSourceTxn,
} from '@/lib/engine/glass-box/category-breakdown';
import { spendingByCategory } from '@/lib/engine/reports/reports';
import { registerDisplayName } from '@/lib/engine/transactions/display-name';
import { normalizeMerchant } from '@/lib/engine/categorize/normalize';

const MONTH = '2026-06';

const row = (over: Partial<BreakdownSourceTxn> = {}): BreakdownSourceTxn => ({
  id: 'txn-1',
  date: '2026-06-10',
  amountCents: -1000,
  categoryId: 'groceries',
  rawDescriptor: 'SQ *CORNER MARKET 0042',
  merchantName: 'Corner Market',
  status: 'POSTED',
  isTransfer: false,
  isSplitParent: false,
  excludeFromTotals: false,
  ...over,
});

/** Every population the figure and the row list could disagree about. */
const MIXED: BreakdownSourceTxn[] = [
  row({ id: 'a', date: '2026-06-03', amountCents: -4500, merchantName: 'Corner Market' }),
  row({ id: 'b', date: '2026-06-11', amountCents: -2000, merchantName: 'Corner Market' }),
  // A refund NETS DOWN its category — the case a gross-of-charges list gets wrong.
  row({ id: 'c', date: '2026-06-14', amountCents: 1200, merchantName: 'Corner Market' }),
  // Pending is IN every one of these figures.
  row({ id: 'd', date: '2026-06-20', amountCents: -800, status: 'PENDING' }),
  // A different category, so the keying is exercised.
  row({ id: 'e', date: '2026-06-05', amountCents: -9900, categoryId: 'travel', merchantName: 'Airline' }),
  // ── everything below must appear in NEITHER the figure nor the rows ──
  row({ id: 'x1', amountCents: -5000, excludeFromTotals: true }),
  row({ id: 'x2', amountCents: -5000, isTransfer: true }),
  row({ id: 'x3', amountCents: -5000, isSplitParent: true }),
  row({ id: 'x4', amountCents: -5000, categoryId: 'transfer' }),
  row({ id: 'x5', amountCents: 500000, categoryId: 'paycheck' }),
  row({ id: 'x6', amountCents: -5000, date: '2026-05-28' }),
  row({ id: 'x7', amountCents: -5000, date: '2026-07-02' }),
];

const headlinesFrom = (txns: readonly BreakdownSourceTxn[]) =>
  new Map(
    spendingByCategory(txns, { fromYm: MONTH, toYm: MONTH }).byCategory.map((c) => [
      c.categoryId,
      c.amountCents,
    ]),
  );

describe('buildCategoryBreakdowns — parity with the figure it explains', () => {
  it('every category figure equals the plain sum of the rows listed for it', () => {
    const headlines = headlinesFrom(MIXED);
    const out = buildCategoryBreakdowns(MIXED, MONTH, headlines);

    // The fixture must actually produce more than one category, or "every"
    // is a claim about a single trivial case.
    expect(headlines.size).toBeGreaterThan(1);
    for (const [categoryId, figure] of headlines) {
      expect(out[categoryId].sumCents, `category ${categoryId}`).toBe(figure);
      expect(out[categoryId].reconciles, `category ${categoryId}`).toBe(true);
    }
  });

  it('nets a refund down rather than listing it as spending', () => {
    const out = buildCategoryBreakdowns(MIXED, MONTH, headlinesFrom(MIXED));
    const groceries = out['groceries'];
    // 45.00 + 20.00 + 8.00 − 12.00 = 61.00, hand-verified.
    expect(groceries.sumCents).toBe(6100);
    const refund = groceries.rows.find((r) => r.transactionId === 'c');
    expect(refund?.amountCents).toBe(-1200);
    // …and the panel therefore cannot be read as "these are the charges":
    // the refund is a NEGATIVE row inside a positive total.
    expect(groceries.rows.filter((r) => r.amountCents < 0)).toHaveLength(1);
  });

  it('counts pending charges and says which rows they are', () => {
    const out = buildCategoryBreakdowns(MIXED, MONTH, headlinesFrom(MIXED));
    const pending = out['groceries'].rows.filter((r) => r.isPending);
    expect(pending.map((r) => r.transactionId)).toEqual(['d']);
  });

  it.each([
    ['a reader-excluded row', 'x1'],
    ['a transfer', 'x2'],
    ['a split parent', 'x3'],
    ['the transfer category', 'x4'],
    ['an income row', 'x5'],
    ['the month before', 'x6'],
    ['the month after', 'x7'],
  ])('never lists %s', (_label, id) => {
    const out = buildCategoryBreakdowns(MIXED, MONTH, headlinesFrom(MIXED));
    const listed = Object.values(out).flatMap((b) => b.rows.map((r) => r.transactionId));
    expect(listed).not.toContain(id);
  });

  it('lists rows oldest first', () => {
    const out = buildCategoryBreakdowns(MIXED, MONTH, headlinesFrom(MIXED));
    const dates = out['groceries'].rows.map((r) => r.date);
    expect(dates).toEqual([...dates].sort());
  });
});

describe('buildCategoryBreakdowns — the states a panel has to tell apart', () => {
  it('returns an entry for a requested category with no rows, and reconciles at zero', () => {
    const out = buildCategoryBreakdowns([], MONTH, new Map([['travel', 0]]));
    expect(out['travel'].rows).toEqual([]);
    expect(out['travel'].reconciles).toBe(true);
    expect(out['travel'].clampedByNetRefund).toBe(false);
  });

  it('reports a real mismatch rather than an empty list under a live number', () => {
    // A figure with no rows behind it is the shape an upstream defect takes;
    // the panel must be able to say so (an-empty-set-is-not-a-fact-about-money).
    const out = buildCategoryBreakdowns([], MONTH, new Map([['travel', 5000]]));
    expect(out['travel'].reconciles).toBe(false);
    expect(out['travel'].clampedByNetRefund).toBe(false);
  });

  it('names the net-refund clamp instead of calling it a mismatch', () => {
    // Both figure builders hold a net-refund category at zero rather than
    // printing negative spend, so the rows legitimately do not sum to it.
    const rows = [row({ id: 'r1', amountCents: -2000 }), row({ id: 'r2', amountCents: 6000 })];
    const out = buildCategoryBreakdowns(rows, MONTH, new Map([['groceries', 0]]));
    expect(out['groceries'].sumCents).toBe(-4000);
    expect(out['groceries'].reconciles).toBe(false);
    expect(out['groceries'].clampedByNetRefund).toBe(true);
  });

  it('does not call a plain mismatch a net refund', () => {
    const out = buildCategoryBreakdowns([row({ amountCents: -2000 })], MONTH, new Map([['groceries', 9999]]));
    expect(out['groceries'].clampedByNetRefund).toBe(false);
  });
});

describe('buildCategoryBreakdowns — how a row is named', () => {
  const one = (over: Partial<BreakdownSourceTxn>) =>
    buildCategoryBreakdowns([row(over)], MONTH, new Map([['groceries', 1000]]))['groceries'].rows[0];

  it("prefers the register's display name over the bank text", () => {
    const r = one({ merchantName: 'My Corner Shop', rawDescriptor: 'SQ *CORNER MARKET 0042' });
    expect(r.label).toBe('My Corner Shop');
    // The bank text is kept as the second line — it is what the categorizer read.
    expect(r.rawDescriptor).toBe('SQ *CORNER MARKET 0042');
  });

  it('falls back to the bank text, and then to a phrase rather than a blank line', () => {
    expect(one({ merchantName: null }).label).toBe('SQ *CORNER MARKET 0042');
    expect(one({ merchantName: '   ' }).label).toBe('SQ *CORNER MARKET 0042');
    expect(one({ merchantName: null, rawDescriptor: null }).label).toBe('No description');
  });

  it('omits the bank text when it adds nothing', () => {
    expect(one({ merchantName: 'Corner Market', rawDescriptor: 'Corner Market' }).rawDescriptor).toBeNull();
    expect(one({ merchantName: null, rawDescriptor: 'Corner Market' }).rawDescriptor).toBeNull();
  });

  it('carries a transaction id when the caller has one, and null when it does not', () => {
    expect(one({ id: 'txn-77' }).transactionId).toBe('txn-77');
    expect(one({ id: undefined }).transactionId).toBeNull();
  });

  it('gives two identical charges on one day distinct keys', () => {
    const same = { date: '2026-06-04', amountCents: -1500, id: undefined };
    const out = buildCategoryBreakdowns(
      [row(same), row(same)],
      MONTH,
      new Map([['groceries', 3000]]),
    );
    const keys = out['groceries'].rows.map((r) => r.key);
    expect(new Set(keys).size).toBe(2);
  });
});

/**
 * The cross-engine locks, against the real seeded dataset rather than a fixture.
 *
 * These are the pins `server/trends.ts` and `server/reports.ts` cite in their own
 * comments, and they exist because the fixture tests above cannot see the thing
 * most likely to break: the SERVER's choice of which array, which month and which
 * figure to hand the builder. `getSpendingTrends` in particular builds from
 * `snap.transactions` while the movers were computed from
 * `toTrendTxns(snap.transactions)`; those select the same rows only for as long as
 * the shaping step keeps copying every field `isSpendRow` reads, which is exactly
 * the narrowing O.6 had to remove once already.
 */
describe('the shipped server functions hand the panel the figure they print', () => {
  it('reports-breakdown-parity: every category figure equals its listed rows', async () => {
    const { getReports } = await import('@/server/reports');
    const data = await getReports('user-demo');

    expect(data.breakdown.byCategory.length).toBeGreaterThan(1);
    let sawRows = false;
    for (const c of data.breakdown.byCategory) {
      const b = data.breakdowns[c.categoryId];
      expect(b, `no breakdown for ${c.categoryId}`).toBeDefined();
      expect(b.sumCents, `category ${c.categoryId}`).toBe(c.amountCents);
      expect(b.reconciles, `category ${c.categoryId}`).toBe(true);
      if (b.rows.length > 0) sawRows = true;
    }
    // Anti-vacuity: parity over a set of empty breakdowns proves nothing.
    expect(sawRows).toBe(true);
  });

  it('O.19: the header total is the sum of the WHOLE category list — the premise the "Everything else" row renders on', async () => {
    // The owner's screenshots showed "$28,253.04 total" above twelve rows that
    // sum to ~$19k: the view capped the list while the header summed everything.
    // The fix renders the tail's subtotal from the same array — which is only
    // honest while totalCents IS that array's sum. Pin the premise here so an
    // engine change that breaks it (a total that starts including what the list
    // does not) fails a test that names the row relying on it.
    const { getReports } = await import('@/server/reports');
    const data = await getReports('user-demo');
    const sum = data.breakdown.byCategory.reduce((s, c) => s + c.amountCents, 0);
    expect(data.breakdown.totalCents).toBe(sum);
    // MEASURED 2026-07-31: the demo month carries 11 spend categories, so the
    // "Everything else" row does not render on the demo (11 rows already sum
    // visibly to the total, which is correct). The >12 hard case therefore
    // cannot live here — the e2e seeds its own throwaway user with a 13-plus
    // category month and asserts the row against that fixture.
    expect(data.breakdown.byCategory.length).toBeGreaterThan(1);
  });

  it('trends-breakdown-parity: every mover figure equals its listed rows, over comparedYm', async () => {
    const { getSpendingTrends } = await import('@/server/trends');
    const trends = await getSpendingTrends('user-demo');

    expect(trends.comparedYm).not.toBeNull();
    expect(trends.movers.length).toBeGreaterThan(1);
    let sawRows = false;
    for (const m of trends.movers) {
      const b = trends.breakdowns[m.categoryId];
      expect(b, `no breakdown for ${m.categoryId}`).toBeDefined();
      expect(b.sumCents, `mover ${m.categoryId}`).toBe(m.currentCents);
      expect(b.reconciles, `mover ${m.categoryId}`).toBe(true);
      if (b.rows.length > 0) sawRows = true;
      // The window: a listed row may only come from the month the figure describes.
      for (const r of b.rows) expect(r.date.slice(0, 7)).toBe(trends.comparedYm);
    }
    expect(sawRows).toBe(true);
  });

  it('trends: a mover that fell to nothing is an EMPTY breakdown, not a mismatch', async () => {
    // The demo seed carries this shape (Travel, $0.00 in the compared month) and
    // it is the row a reader most wants explained. Asserting it is present is what
    // stops the empty-panel copy from being unreachable — and it is the case the
    // first draft of the e2e tripped over by taking the topmost mover.
    const { getSpendingTrends } = await import('@/server/trends');
    const trends = await getSpendingTrends('user-demo');
    const fellToZero = trends.movers.filter((m) => m.currentCents === 0);
    expect(fellToZero.length).toBeGreaterThan(0);
    for (const m of fellToZero) {
      const b = trends.breakdowns[m.categoryId];
      expect(b.rows).toEqual([]);
      expect(b.reconciles).toBe(true);
      expect(b.clampedByNetRefund).toBe(false);
    }
  });
});

describe('the display name a row is given', () => {
  // The rule the panel shares with the register (`registerDisplayName`). Until
  // O.18 it was the same two-branch expression written out at six call sites,
  // and a critic measured that deleting its FIRST branch was invisible to the
  // whole suite: on the demo seed all 847 merchant canonicals happen to equal
  // the normalizer's reading of the bank text, so no fixture in the repo could
  // tell the branches apart. The rename case is the one that matters and it now
  // has a test.
  it("prefers the reader's own renamed payee over the bank text", () => {
    expect(
      registerDisplayName({
        merchant: { canonical: 'Mum’s Pharmacy' },
        rawDescriptor: 'SQ *WALGREENS #4471 CHICAGO IL',
      }),
    ).toBe('Mum’s Pharmacy');
  });

  it('falls back to the normalizer only when there is no joined merchant', () => {
    const raw = 'SQ *WALGREENS #4471 CHICAGO IL';
    const fallback = registerDisplayName({ rawDescriptor: raw });
    expect(fallback).toBe(normalizeMerchant(raw).canonical);
    expect(registerDisplayName({ merchant: null, rawDescriptor: raw })).toBe(fallback);
  });

  it('is the rule the breakdown actually applies', () => {
    // Not a restatement of the function: this drives it through the builder, so
    // a call site that stopped using it would fail here.
    const out = buildCategoryBreakdowns(
      [
        {
          date: '2026-06-04',
          amountCents: -2500,
          categoryId: 'groceries',
          rawDescriptor: 'SQ *WALGREENS #4471 CHICAGO IL',
          merchantName: registerDisplayName({
            merchant: { canonical: 'Mum’s Pharmacy' },
            rawDescriptor: 'SQ *WALGREENS #4471 CHICAGO IL',
          }),
        },
      ],
      MONTH,
      new Map([['groceries', 2500]]),
    );
    expect(out['groceries'].rows[0].label).toBe('Mum’s Pharmacy');
    // …and the bank text survives beside it, since that is what was categorized.
    expect(out['groceries'].rows[0].rawDescriptor).toBe('SQ *WALGREENS #4471 CHICAGO IL');
  });
});

describe('headlineCents is carried, not recomputed', () => {
  // A critic mutated `headlineCents: cents(headline)` to `cents(0)` and all 26
  // tests passed: the field is read only by the mismatch copy, and every other
  // test asserts the branch where no mismatch exists. It is the number the panel
  // tells the reader it could not reconcile against, so it is worth one lock.
  it('is the figure the caller passed, not the row sum', () => {
    const out = buildCategoryBreakdowns([row({ amountCents: -2000 })], MONTH, new Map([['groceries', 9999]]));
    expect(out['groceries'].headlineCents).toBe(9999);
    expect(out['groceries'].sumCents).toBe(2000);
  });

  it('equals the row sum exactly when it reconciles', () => {
    const out = buildCategoryBreakdowns([row({ amountCents: -2000 })], MONTH, new Map([['groceries', 2000]]));
    expect(out['groceries'].headlineCents).toBe(2000);
    expect(out['groceries'].headlineCents).toBe(out['groceries'].sumCents);
  });
});

describe('the panel copy', () => {
  it('never says "this month" — the three surfaces do not share a window', () => {
    // /budgets and /reports panels describe the CURRENT month; /trends' describe
    // `comparedYm`, the last COMPLETE one, directly beneath a Pace card headed
    // with the current month. A deictic window word is therefore true on two
    // surfaces and false on the third — the defect both O.18 critics found, and
    // it was live: the demo's Fuel mover reads $0.00 for May while /budgets
    // prints $68.27 of Fuel for June.
    //
    // EVERY string this module can emit is covered, not an enumerated pair: the
    // first fix corrected one branch and left its sibling two lines away saying
    // "this month" (`a-disclosure-is-several-claims-in-one-sentence`).
    const emitted = [
      BREAKDOWN_BASIS,
      breakdownEmptyCopy('May 2026'),
      breakdownNetRefundCopy('-$140.00', 'May 2026'),
    ];
    for (const s of emitted) {
      expect(s).not.toMatch(/this month|last month|this period|so far|currently/i);
    }
  });

  it('makes both window-bearing sentences name the window they were given', () => {
    // A required argument makes a caller answer; this is what makes a WRONG
    // answer visible rather than a missing one silent.
    expect(breakdownEmptyCopy('May 2026')).toContain('May 2026');
    expect(breakdownNetRefundCopy('-$140.00', 'May 2026')).toContain('May 2026');
    expect(breakdownNetRefundCopy('-$140.00', 'May 2026')).toContain('-$140.00');
  });

  it('answers the empty case rather than apologising for it', () => {
    // On /trends a category that fell to nothing is the row a reader most wants
    // explained, so this string has to READ as an answer.
    const s = breakdownEmptyCopy('Jul 2026');
    expect(s).toMatch(/nothing was filed/i);
    expect(s).not.toMatch(/sorry|error|unavailable|failed/i);
  });

  it('names income among the populations the figure leaves out', () => {
    // The first draft enumerated three of the five `isSpendRow` drops. The two it
    // missed are the `transfer` category id and the whole Income group, and the
    // second is not academic: /budgets records an executed case where a
    // `paycheck -$500` clawback used to render as $500 of budget spend.
    expect(BREAKDOWN_BASIS).toMatch(/income/i);
  });

  it('names each population the shared predicate drops, and the one it keeps', () => {
    // The sentence is the panel's only disclosure and it is printed on every
    // surface, so a clause quietly disappearing from it is a silent widening of
    // what readers think they are looking at.
    // Each string is a whole clause, never a bare token: an earlier draft asserted
    // `'not'`, which almost any English sentence satisfies.
    for (const clause of [
      'Pending charges are included',
      'transfers between',
      'the container row left by a split',
      'not your spending',
    ]) {
      expect(BREAKDOWN_BASIS).toContain(clause);
    }
    // It may not claim a window: /trends' panels describe the last COMPLETE
    // month while /budgets' describe the current one.
    expect(BREAKDOWN_BASIS).not.toMatch(/this month|last month/i);
  });
});
