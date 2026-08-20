/**
 * Month-flow breakdowns — the rows behind a bar on the income-vs-spending chart.
 *
 * Written to the same discipline as its sibling `category-breakdown.test.ts`,
 * because it makes the same promise on a different predicate: the PARITY
 * assertion comes first — both functions are handed the SAME array, and every
 * figure `monthlyFlows` produces must equal the plain sum of the rows
 * `buildMonthFlowBreakdowns` lists for it.
 *
 * Parity alone would pass if BOTH functions dropped a population they should
 * have counted (the O.8 lesson: ask what value would make this fail), so every
 * population the two could disagree about is also asserted individually — a
 * pending charge, a transfer, a split container, a reader-excluded row, a
 * refund, an Income-group deposit, and the `refund` LEAF, which is the one row
 * that looks like income and is not.
 *
 * The pending case carries extra weight here: the sibling module COUNTS pending
 * rows and this one must not, so a test that only proved "the two panels agree"
 * would be blind to the exact defect that made this a separate module.
 */
import { describe, expect, it } from 'vitest';
import {
  MONTH_FLOW_BASIS,
  buildMonthFlowBreakdowns,
  monthFlowEmptyCopy,
  monthFlowNetRefundCopy,
  type MonthFlowSourceTxn,
} from '@/lib/engine/glass-box/month-flow-breakdown';
import { monthlyFlows } from '@/lib/engine/fi/insights';

const MONTH = '2026-06';

const row = (over: Partial<MonthFlowSourceTxn> = {}): MonthFlowSourceTxn => ({
  id: 'txn-1',
  date: '2026-06-10',
  amountCents: -1000,
  categoryId: 'groceries',
  rawDescriptor: 'SQ *CORNER MARKET 0042',
  merchantName: 'Corner Market',
  accountId: 'acct-1',
  status: 'POSTED',
  isTransfer: false,
  isSplitParent: false,
  excludeFromTotals: false,
  ...over,
});

/** Every population the figure and the row list could disagree about. */
const FIXTURE: MonthFlowSourceTxn[] = [
  row({ id: 'buy-1', amountCents: -4500, date: '2026-06-02' }),
  row({ id: 'buy-2', amountCents: -2000, date: '2026-06-14', categoryId: 'dining' }),
  // A merchandise return: positive, non-income category. Nets spending DOWN.
  row({ id: 'refund-1', amountCents: 1500, date: '2026-06-20', categoryId: 'shopping' }),
  // Real income.
  row({ id: 'pay-1', amountCents: 300_000, date: '2026-06-01', categoryId: 'paycheck' }),
  // The `refund` LEAF — positive, Income GROUP, and deliberately NOT income.
  row({ id: 'refund-leaf', amountCents: 900, date: '2026-06-21', categoryId: 'refund' }),
  // The three classes the flow SPLIT decides, each of which a "refunds are
  // netted against spending" sentence would describe falsely. Both critics
  // found these; neither fixture row existed when the sentence was first
  // written, which is exactly why it was wrong.
  //   (a) no category at all → INCOME (`!categoryId`)
  row({ id: 'unfiled-null', amountCents: 60_000, date: '2026-06-06', categoryId: null }),
  //   (b) filed to `uncategorized` → NOT income (group is 'Transfers & Other'),
  //       so an unidentified deposit nets against SPENDING
  row({ id: 'unfiled-uncat', amountCents: 25_000, date: '2026-06-08', categoryId: 'uncategorized' }),
  //   (c) a NEGATIVE row in an income category → spending (a payroll clawback)
  row({ id: 'clawback', amountCents: -50_000, date: '2026-06-15', categoryId: 'paycheck' }),
  // None of the following may appear in either panel.
  row({ id: 'pending-1', amountCents: -7700, date: '2026-06-11', status: 'PENDING' }),
  row({ id: 'transfer-1', amountCents: -50_000, date: '2026-06-05', isTransfer: true }),
  // O.20j: filed as Transfer with the pairing flag still false — the live leak
  // shape (76 production rows). Must leave both panels the same way a flagged
  // transfer does; `isSpendRow` already dropped this leaf.
  row({
    id: 'transfer-leaf-unflagged',
    amountCents: -1_005_127,
    date: '2026-06-12',
    categoryId: 'transfer',
    isTransfer: false,
    rawDescriptor: 'Funds Transfer to Brokerage',
  }),
  row({ id: 'split-parent', amountCents: -6000, date: '2026-06-07', isSplitParent: true }),
  row({ id: 'excluded-1', amountCents: -3300, date: '2026-06-09', excludeFromTotals: true }),
  // One month out of the chart's window entirely.
  row({ id: 'other-month', amountCents: -8800, date: '2026-05-04' }),
];

const headlinesFor = (txns: readonly MonthFlowSourceTxn[]) =>
  monthlyFlows(txns).map((f) => ({
    month: f.month,
    incomeCents: f.incomeCents,
    expensesCents: f.expensesCents,
  }));

describe('month-flow breakdowns — parity with the figure the chart draws', () => {
  it('every bar equals the plain sum of the rows listed beneath it', () => {
    const headlines = headlinesFor(FIXTURE);
    const out = buildMonthFlowBreakdowns(FIXTURE, headlines);

    // The fixture must actually exercise both halves, or this passes vacuously.
    expect(headlines.length).toBeGreaterThan(0);
    for (const h of headlines) {
      expect(h.incomeCents + h.expensesCents).toBeGreaterThan(0);
      for (const flow of ['income', 'expense'] as const) {
        const b = out[`${h.month}:${flow}`];
        expect(b, `${h.month}:${flow} must exist`).toBeDefined();
        expect(b.sumCents, `${h.month}:${flow} must sum to its bar`).toBe(b.headlineCents);
        expect(b.reconciles).toBe(true);
      }
    }
  });

  it('builds a panel for EVERY month the chart draws, including an empty one', () => {
    // A bar a reader can tap must open something — silence is not an answer.
    const headlines = [...headlinesFor(FIXTURE), { month: '2026-04', incomeCents: 0, expensesCents: 0 }];
    const out = buildMonthFlowBreakdowns(FIXTURE, headlines);
    expect(out['2026-04:income'].rows).toEqual([]);
    expect(out['2026-04:expense'].rows).toEqual([]);
    expect(out['2026-04:expense'].reconciles).toBe(true);
  });
});

describe('month-flow breakdowns — the populations the two could disagree about', () => {
  const out = buildMonthFlowBreakdowns(FIXTURE, headlinesFor(FIXTURE));
  const expense = out[`${MONTH}:expense`];
  const income = out[`${MONTH}:income`];
  const ids = (b: { rows: { transactionId: string | null }[] }) => b.rows.map((r) => r.transactionId);

  it('a PENDING charge is in NEITHER panel — this chart is posted-only', () => {
    // The load-bearing difference from `category-breakdown.ts`, which counts it.
    expect(ids(expense)).not.toContain('pending-1');
    expect(ids(income)).not.toContain('pending-1');
  });

  it('transfers, split containers and reader-excluded rows are in neither panel', () => {
    for (const id of ['transfer-1', 'transfer-leaf-unflagged', 'split-parent', 'excluded-1']) {
      expect(ids(expense), id).not.toContain(id);
      expect(ids(income), id).not.toContain(id);
    }
  });

  it('test_regression__o20j_transfer_category_unflagged_stays_out_of_month_flow_panels', () => {
    // Fail-old: before O.20j, countsInFlows admitted categoryId=transfer when
    // isTransfer was false, so the glass-box panel (and the chart bar it tracks)
    // listed the leak row. Deleting the category gate from countsInFlows must
    // put transfer-leaf-unflagged back into the expense panel.
    expect(ids(expense)).not.toContain('transfer-leaf-unflagged');
    expect(ids(income)).not.toContain('transfer-leaf-unflagged');
    const alone = buildMonthFlowBreakdowns(
      [
        row({
          id: 'xfer-only',
          amountCents: -1_005_127,
          categoryId: 'transfer',
          isTransfer: false,
          rawDescriptor: 'Venmo payment',
        }),
        row({ id: 'keep', amountCents: -2_000, categoryId: 'dining' }),
      ],
      [{ month: MONTH, incomeCents: 0, expensesCents: 2_000 }],
    );
    expect(alone[`${MONTH}:expense`].rows.map((r) => r.transactionId)).toEqual(['keep']);
    expect(alone[`${MONTH}:expense`].sumCents).toBe(2_000);
  });

  it('a refund is a NEGATIVE row inside spending, never a positive one inside income', () => {
    const refund = expense.rows.find((r) => r.transactionId === 'refund-1');
    expect(refund?.amountCents).toBe(-1500);
    expect(ids(income)).not.toContain('refund-1');
  });

  it('the `refund` LEAF counts against spending even though its group is Income', () => {
    const leaf = expense.rows.find((r) => r.transactionId === 'refund-leaf');
    expect(leaf?.amountCents).toBe(-900);
    expect(ids(income)).not.toContain('refund-leaf');
  });

  it('a paycheck lands in income, oriented positive', () => {
    const pay = income.rows.find((r) => r.transactionId === 'pay-1');
    expect(pay?.amountCents).toBe(300_000);
    expect(ids(expense)).not.toContain('pay-1');
  });

  it('a row outside the charted months is dropped', () => {
    // Built with headlines that deliberately OMIT 2026-05 while the fixture
    // still contains a May row. The earlier version of this test passed
    // `headlinesFor(FIXTURE)`, which includes every month present — so `wanted`
    // excluded nothing and deleting the window check left it green (a critic
    // proved that by deletion). Now the check is load-bearing.
    const juneOnly = headlinesFor(FIXTURE).filter((h) => h.month === MONTH);
    expect(juneOnly).toHaveLength(1);
    const out = buildMonthFlowBreakdowns(FIXTURE, juneOnly);
    expect(Object.keys(out).sort()).toEqual([`${MONTH}:expense`, `${MONTH}:income`]);
    const allIds = [...out[`${MONTH}:expense`].rows, ...out[`${MONTH}:income`].rows].map(
      (r) => r.transactionId,
    );
    expect(allIds).not.toContain('other-month');
    // And the June figures are unchanged by the exclusion.
    expect(out[`${MONTH}:expense`].reconciles).toBe(true);
  });

  it('purchases are oriented as spend, so the rows sum to the positive bar', () => {
    expect(expense.rows.find((r) => r.transactionId === 'buy-1')?.amountCents).toBe(4500);
    // 4500 + 2000 − 1500 − 900 − 25000 + 50000 = 29100, and that is the bar.
    expect(expense.sumCents).toBe(29_100);
    expect(expense.headlineCents).toBe(29_100);
  });

  it('an inflow with NO category counts as income', () => {
    // `!t.categoryId` is the first branch of the split, and it is a live
    // population (server/backfill.ts selects on exactly this).
    expect(income.rows.find((r) => r.transactionId === 'unfiled-null')?.amountCents).toBe(60_000);
    expect(ids(expense)).not.toContain('unfiled-null');
  });

  it('an inflow filed to Uncategorized does NOT — it nets against spending', () => {
    // The mirror of the case above, and the reason the basis sentence names
    // both: 'uncategorized' sits in 'Transfers & Other', not Income.
    expect(expense.rows.find((r) => r.transactionId === 'unfiled-uncat')?.amountCents).toBe(-25_000);
    expect(ids(income)).not.toContain('unfiled-uncat');
  });

  it('an OUTFLOW in an income category is spending, not negative income', () => {
    // The split tests the sign first, so a payroll clawback adds to the bar.
    expect(expense.rows.find((r) => r.transactionId === 'clawback')?.amountCents).toBe(50_000);
    expect(ids(income)).not.toContain('clawback');
  });

  it('rows are oldest-first, the way a statement reads', () => {
    const dates = expense.rows.map((r) => r.date);
    expect([...dates].sort()).toEqual(dates);
  });
});

describe('month-flow breakdowns — a month whose returns outran its purchases', () => {
  // `monthlyFlows` clamps with Math.max(0, expenses); the panel must NAME that
  // rather than report a defect.
  const REFUND_HEAVY: MonthFlowSourceTxn[] = [
    row({ id: 'small-buy', amountCents: -1000, date: '2026-06-03' }),
    row({ id: 'big-return', amountCents: 9000, date: '2026-06-04', categoryId: 'shopping' }),
    // Real income in the same month, so the income-side assertions below are
    // about a populated panel rather than an empty one.
    row({ id: 'pay', amountCents: 400_000, date: '2026-06-01', categoryId: 'paycheck' }),
  ];

  it('holds the bar at zero, flags the clamp, and does NOT claim to reconcile', () => {
    const headlines = headlinesFor(REFUND_HEAVY);
    const out = buildMonthFlowBreakdowns(REFUND_HEAVY, headlines);
    const b = out[`${MONTH}:expense`];
    expect(b.headlineCents).toBe(0);
    expect(b.sumCents).toBe(-8000);
    expect(b.reconciles).toBe(false);
    expect(b.clampedByNetRefund).toBe(true);
  });

  it('the income side reconciles and is never clamped', () => {
    // Not a guard in the code (income rows are positive by `isIncomeFlowRow`,
    // so the clamp condition is unreachable there) — this pins the PROPERTY
    // that makes the guard unnecessary, over a panel that actually has rows.
    const out = buildMonthFlowBreakdowns(REFUND_HEAVY, headlinesFor(REFUND_HEAVY));
    const income = out[`${MONTH}:income`];
    expect(income.rows.length).toBeGreaterThan(0);
    expect(income.sumCents).toBe(400_000);
    expect(income.reconciles).toBe(true);
    expect(income.clampedByNetRefund).toBe(false);
  });

  it('the clamp sentence states a MAGNITUDE, never a negative after “by”', () => {
    // The production call site passes `breakdown.sumCents`, which is ALWAYS
    // negative when this sentence renders. The first version of this test
    // passed a positive literal the caller could never produce, and the shipped
    // copy read "outran purchases by −$80.00" — the opposite of the truth.
    const out = buildMonthFlowBreakdowns(REFUND_HEAVY, headlinesFor(REFUND_HEAVY));
    const sum = out[`${MONTH}:expense`].sumCents;
    expect(sum).toBeLessThan(0); // the value the caller actually holds
    const sentence = monthFlowNetRefundCopy(sum, 'Jun 2026');
    expect(sentence).toContain('outran purchases by $80.00');
    expect(sentence).not.toMatch(/by\s*[-−]/);
  });
});

describe('month-flow breakdowns — the basis each panel states', () => {
  it('names all four exclusions the flows predicate applies', () => {
    for (const flow of ['income', 'expense'] as const) {
      const s = MONTH_FLOW_BASIS[flow].toLowerCase();
      expect(s, 'transfers').toContain('transfer');
      expect(s, 'pending').toContain('pending');
      expect(s, 'splits').toContain('split');
      expect(s, 'reader-excluded').toContain('excluded from totals');
    }
  });

  it('states the POSTED-only rule rather than inheriting the category panel’s', () => {
    // The sibling module's sentence says pending rows ARE counted. If this ever
    // starts agreeing with it word for word, one of the two is lying.
    expect(MONTH_FLOW_BASIS.expense).toMatch(/posted spending only/i);
    expect(MONTH_FLOW_BASIS.income).toMatch(/posted income only/i);
  });

  it('names all THREE consequences of the flow split, not just refunds', () => {
    // Each of these is a row class the panels actually render, and a sentence
    // that named only refunds was falsified by rows inside the panel it
    // described. See the module docblock.
    expect(MONTH_FLOW_BASIS.expense, 'outflow in an income category').toMatch(
      /going out counts here even when it sits in an income category/i,
    );
    expect(MONTH_FLOW_BASIS.expense, 'inflow filed to Uncategorized').toMatch(/Uncategorized/);
    expect(MONTH_FLOW_BASIS.income, 'inflow with no category').toMatch(/no category at all/i);
    expect(MONTH_FLOW_BASIS.income, 'the refund leaf').toMatch(/counts against that month/i);
  });

  it('no sentence claims where anything sits on the screen', () => {
    // Position is a fact about the component, not the engine: the first draft
    // said "on the basis above" (it renders below) and "the rows below" (they
    // render above). Both critics found it.
    for (const s of [
      MONTH_FLOW_BASIS.income,
      MONTH_FLOW_BASIS.expense,
      monthFlowEmptyCopy('income', 'Jun 2026'),
      monthFlowEmptyCopy('expense', 'Jun 2026'),
      monthFlowNetRefundCopy(-8000, 'Jun 2026'),
    ]) {
      expect(s, s).not.toMatch(/\babove\b/i);
    }
    // "the rules below" is the ONE positional phrase kept, and it is true: the
    // basis paragraph renders under the empty line in the same box.
    expect(monthFlowEmptyCopy('income', 'Jun 2026')).toMatch(/rules below/);
  });

  it('the empty and clamped sentences carry their own window, never "this month"', () => {
    expect(monthFlowEmptyCopy('income', 'Jun 2026')).toContain('Jun 2026');
    expect(monthFlowEmptyCopy('expense', 'Jun 2026')).toContain('Jun 2026');
    expect(monthFlowNetRefundCopy(-8000, 'Jun 2026')).toContain('Jun 2026');
    for (const s of [
      monthFlowEmptyCopy('income', 'Jun 2026'),
      monthFlowNetRefundCopy(-8000, 'Jun 2026'),
    ]) {
      expect(s).not.toMatch(/this month/i);
      expect(s).not.toMatch(/that bar/i);
    }
  });
});
