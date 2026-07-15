/**
 * Glass-Box Assistant trace engine (docs/GLASSBOX_PLAN.md, slice 1) — the six
 * ROW-SUM intents re-select the exact transaction rows behind a headline and
 * reconcile to the penny; derivation-chain intents are never offered a fake
 * row-sum. Acceptance criteria 1–6 from the plan, written test-first.
 *
 * Lockstep is the whole safety story: rows are selected via the SAME exported
 * predicates the engines themselves use (isSpendRow / spendContributionCents
 * from reports.ts, isIncomeFlowRow from insights.ts, merchantSpend's and
 * largestPurchases' own results), so `sum(rows) === headline` holds by
 * construction — and the runtime check catches genuine drift (fail loud).
 */
import { describe, expect, it } from 'vitest';
import { buildSeedData } from '@/lib/seed/build';
import { isoDate } from '@/lib/dates';
import { normalizeMerchant } from '@/lib/engine/categorize/normalize';
import { CATEGORY_BY_ID, mergeCategoryMeta } from '@/lib/engine/categorize/categories';
import {
  isSpendRow,
  spendContributionCents,
  spendRowCategoryId,
  spendingByCategory,
  type ReportTxn,
  type SpendingBreakdown,
} from '@/lib/engine/reports/reports';
import { isIncomeFlowRow, monthlyFlows } from '@/lib/engine/fi/insights';
import { largestPurchases, merchantSpend, toPurchaseRows } from '@/lib/engine/assistant/answer';
import type { AssistantIntent, Timeframe } from '@/lib/engine/assistant/intent';
import {
  ROW_SUM_KINDS,
  traceAnswer,
  traceIncome,
  traceMerchantSpend,
  traceSpendTotal,
  type RowSumTrace,
  type TraceTxn,
} from '@/lib/engine/assistant/trace';

const TODAY = '2026-06-15';
const JUNE: Timeframe = { fromYm: '2026-06', toYm: '2026-06', label: 'this month' };

/** Fixture row helper: POSTED by default; categoryId explicit (stored category). */
const T = (
  date: string,
  amountCents: number,
  categoryId: string | null,
  rawDescriptor: string,
  extra: Partial<TraceTxn> = {},
): TraceTxn => ({
  date,
  amountCents,
  categoryId,
  rawDescriptor,
  accountId: 'a1',
  status: 'POSTED',
  isTransfer: false,
  ...extra,
});

/**
 * Hand-verified fixture (see inline sums). June 2026, today = 2026-06-15.
 * byCategory: groceries 8000; dining 8000−2000+2500 = 8500; shopping
 * 7000(pending)+4000+2600−1500 = 12100; entertainment 1000−3000 = −2000 → DROPPED.
 * total = 28600. Income (flows): 400000 only — the 'refund' leaf nets expenses.
 * Merchant 'amazon' (gross, POSTED, ≤ today): 4000+2600 = 6600 across 2.
 * Largest global: Chipotle 8000. Largest at amazon: 4000.
 */
const TXNS: TraceTxn[] = [
  T('2026-06-02', -5000, 'groceries', 'KROGER #529'),
  T('2026-06-05', -3000, 'groceries', 'KROGER #529'),
  T('2026-06-07', -8000, 'dining', 'CHIPOTLE 1122'),
  T('2026-06-09', 2000, 'dining', 'CHIPOTLE 1122'), // refund nets dining down
  T('2026-06-03', -1000, 'entertainment', 'FANDANGO'),
  T('2026-06-04', 3000, 'entertainment', 'FANDANGO'), // nets entertainment to −2000 → dropped
  T('2026-06-01', 400000, 'income', 'ACME PAYROLL'),
  T('2026-06-08', 1500, 'refund', 'MISC REFUND'), // Income-group 'refund' leaf: NOT income, NOT spend
  T('2026-06-10', -10000, null, 'ONLINE TRANSFER', { isTransfer: true }),
  T('2026-06-11', -1000, 'groceries', 'KROGER #529', { isSplitParent: true }),
  T('2026-06-12', -7000, 'shopping', 'AMZN Mktp US*PEND1', { status: 'PENDING' }), // in spend; not in merchant/largest
  T('2026-06-20', -2500, 'dining', 'CHIPOTLE 1122'), // future vs today: in spend; not in largest/merchant
  T('2026-05-30', -9999, 'groceries', 'KROGER #529'), // out of range
  T('2026-06-03', -4000, 'shopping', 'AMZN Mktp US*1A2B3'),
  T('2026-06-06', -2600, 'shopping', 'AMZN Mktp US*9Z8Y7'),
  T('2026-06-04', 1500, 'shopping', 'AMZN Mktp US*RET99'), // return: nets spend, excluded from gross merchant
];

const INPUT = { transactions: TXNS, today: TODAY, meta: CATEGORY_BY_ID };

const rowSum = (t: RowSumTrace) => t.rows.reduce((s, r) => s + r.contributionCents, 0);

function asRowSum(intent: AssistantIntent): RowSumTrace {
  const trace = traceAnswer(intent, INPUT);
  expect(trace.kind).toBe('row_sum');
  return trace as RowSumTrace;
}

// ── Criterion 1: every row-sum intent reconciles, sum(rows) === headline ────

describe('C1 — every ROW-SUM intent reconciles on the fixture', () => {
  it('spend_total: rows sum to the $286.00 total', () => {
    const t = asRowSum({ kind: 'spend_total', timeframe: JUNE });
    expect(t.headlineCents).toBe(28600);
    expect(rowSum(t)).toBe(28600);
    expect(t.sumCents).toBe(28600);
    expect(t.reconciled).toBe(true);
  });

  it('spend_by_category (groceries): the two Kroger rows, $80.00', () => {
    const t = asRowSum({
      kind: 'spend_by_category',
      timeframe: JUNE,
      target: { type: 'category', categoryId: 'groceries', label: 'Groceries' },
    });
    expect(t.headlineCents).toBe(8000);
    expect(t.rows.map((r) => r.contributionCents)).toEqual([5000, 3000]);
    expect(t.reconciled).toBe(true);
  });

  it('spend_by_category (group Food & Dining): groceries + dining = $165.00', () => {
    const t = asRowSum({
      kind: 'spend_by_category',
      timeframe: JUNE,
      target: { type: 'group', group: 'Food & Dining', label: 'food' },
    });
    expect(t.headlineCents).toBe(16500);
    expect(rowSum(t)).toBe(16500);
    expect(t.reconciled).toBe(true);
    // The dining refund is cited as a NEGATIVE contribution, not hidden.
    expect(t.rows.some((r) => r.contributionCents === -2000)).toBe(true);
  });

  it('spend_by_category (umbrella set): dining + shopping = $206.00', () => {
    const t = asRowSum({
      kind: 'spend_by_category',
      timeframe: JUNE,
      target: { type: 'categories', categoryIds: ['dining', 'shopping'], label: 'fun money' },
    });
    expect(t.headlineCents).toBe(8500 + 12100);
    expect(rowSum(t)).toBe(8500 + 12100);
    expect(t.reconciled).toBe(true);
  });

  it('top_categories: headline is the TOP category (shopping $121.00) and its rows', () => {
    const t = asRowSum({ kind: 'top_categories', timeframe: JUNE, limit: 3 });
    expect(t.headlineCents).toBe(12100);
    expect(rowSum(t)).toBe(12100);
    expect(t.reconciled).toBe(true);
    // All three listed categories are carried as groups, each reconciled.
    expect(t.groups?.map((g) => g.amountCents)).toEqual([12100, 8500, 8000]);
  });

  it('merchant_spend (amazon): gross $66.00 across the two POSTED purchases', () => {
    const t = asRowSum({ kind: 'merchant_spend', timeframe: JUNE, merchant: 'amazon' });
    expect(t.headlineCents).toBe(6600);
    expect(t.rows.length).toBe(2);
    expect(rowSum(t)).toBe(6600);
    expect(t.reconciled).toBe(true);
  });

  it('income: the single payroll row, $4,000.00 — the refund leaf is not income', () => {
    const t = asRowSum({ kind: 'income', timeframe: JUNE });
    expect(t.headlineCents).toBe(400000);
    expect(t.rows.length).toBe(1);
    expect(t.rows[0].contributionCents).toBe(400000);
    expect(t.reconciled).toBe(true);
  });

  it('largest_purchases: the single cited row (Chipotle $80.00) IS the headline', () => {
    const t = asRowSum({ kind: 'largest_purchases', timeframe: JUNE, limit: 3 });
    expect(t.headlineCents).toBe(8000);
    expect(t.rows.length).toBe(1);
    expect(t.rows[0].contributionCents).toBe(8000);
    expect(t.reconciled).toBe(true);
  });

  it('largest_purchases scoped to amazon: the $40.00 row', () => {
    const t = asRowSum({ kind: 'largest_purchases', timeframe: JUNE, limit: 3, merchant: 'amazon' });
    expect(t.headlineCents).toBe(4000);
    expect(t.rows[0].contributionCents).toBe(4000);
    expect(t.reconciled).toBe(true);
  });
});

// ── Criterion 2: spend_total is hierarchical; net-refund categories excluded ─

describe('C2 — spend_total reconciles hierarchically, net-refund category excluded', () => {
  const t = asRowSum({ kind: 'spend_total', timeframe: JUNE });

  it('groups sum to the total exactly', () => {
    const groups = t.groups ?? [];
    expect(groups.reduce((s, g) => s + g.amountCents, 0)).toBe(t.headlineCents);
  });

  it('each group’s rows sum to its own amount', () => {
    for (const g of t.groups ?? []) {
      expect(g.rows.reduce((s, r) => s + r.contributionCents, 0)).toBe(g.amountCents);
    }
  });

  it('the entertainment category (nets to a refund) is excluded — no group, no rows', () => {
    expect(t.groups?.some((g) => g.key === 'entertainment')).toBe(false);
    expect(t.rows.some((r) => r.categoryId === 'entertainment')).toBe(false);
    // …exactly as spendingByCategory excludes it from the headline.
    const breakdown = spendingByCategory(TXNS as ReportTxn[], JUNE);
    expect(breakdown.byCategory.some((c) => c.categoryId === 'entertainment')).toBe(false);
    expect(t.headlineCents).toBe(breakdown.totalCents);
  });

  it('a dropped category asked for directly cites no rows and no figure (never a wrong sum)', () => {
    const dropped = asRowSum({
      kind: 'spend_by_category',
      timeframe: JUNE,
      target: { type: 'category', categoryId: 'entertainment', label: 'Entertainment' },
    });
    expect(dropped.headlineCents).toBe(0);
    expect(dropped.rows).toEqual([]);
    expect(dropped.reconciled).toBe(true); // vacuous — the answer shows no figure to tap
  });
});

// ── Criterion 3: merchant_spend cites only POSTED purchases, gross ──────────

describe('C3 — merchant_spend trace: POSTED purchases only, gross', () => {
  const t = asRowSum({ kind: 'merchant_spend', timeframe: JUNE, merchant: 'amazon' });

  it('the PENDING amazon row is not cited (POSTED only)', () => {
    expect(t.rows.some((r) => r.contributionCents === 7000)).toBe(false);
  });

  it('the return is not cited or netted (gross by design), and the basis says so', () => {
    expect(t.rows.some((r) => r.contributionCents < 0)).toBe(false);
    expect(t.headlineCents).toBe(6600); // NOT 6600 − 1500
    expect(t.basis.join(' ')).toMatch(/return|refund/i);
  });

  it('matches merchantSpend’s own result exactly (lockstep, not re-derivation)', () => {
    const res = merchantSpend(toPurchaseRows(TXNS), JUNE, 'amazon', TODAY);
    expect(t.headlineCents).toBe(res.totalCents);
    expect(t.rows.length).toBe(res.count);
  });
});

// ── Criterion 4: derivation intents are never offered a row-sum trace ───────

describe('C4 — derivation-chain intents get a not_row_sum marker', () => {
  const kinds = ['net_worth', 'forecast', 'cash_needed', 'savings_rate', 'safe_to_spend', 'subscriptions'] as const;
  for (const kind of kinds) {
    it(`${kind} → not_row_sum`, () => {
      const trace = traceAnswer({ kind } as AssistantIntent, INPUT);
      expect(trace.kind).toBe('not_row_sum');
      expect(ROW_SUM_KINDS.has(kind)).toBe(false);
    });
  }

  it('ROW_SUM_KINDS contains exactly the six traceable kinds', () => {
    expect([...ROW_SUM_KINDS].sort()).toEqual(
      ['income', 'largest_purchases', 'merchant_spend', 'spend_by_category', 'spend_total', 'top_categories'].sort(),
    );
  });
});

// ── Criterion 5: the reconciliation check is real, not vacuous ──────────────

describe('C5 — false-negative guard: drift is caught, doctored results are reported', () => {
  it('a doctored breakdown (headline off by one cent) → reconciled: false, true sum kept', () => {
    const breakdown = spendingByCategory(TXNS as ReportTxn[], JUNE);
    const doctored: SpendingBreakdown = { ...breakdown, totalCents: breakdown.totalCents + 1 };
    const t = traceSpendTotal(doctored, TXNS, JUNE, CATEGORY_BY_ID);
    expect(t.reconciled).toBe(false);
    expect(t.sumCents).toBe(breakdown.totalCents); // the honest sum, not the doctored one
  });

  it('a doctored merchant result → reconciled: false', () => {
    const res = merchantSpend(toPurchaseRows(TXNS), JUNE, 'amazon', TODAY);
    const t = traceMerchantSpend({ ...res, totalCents: res.totalCents + 1 });
    expect(t.reconciled).toBe(false);
  });

  it('a doctored income flow → reconciled: false', () => {
    const flows = monthlyFlows(TXNS).map((f) => (f.month === '2026-06' ? { ...f, incomeCents: (f.incomeCents + 1) as typeof f.incomeCents } : f));
    const t = traceIncome(flows, TXNS, JUNE);
    expect(t.reconciled).toBe(false);
  });

  it('a drifted predicate (naïve flat sum of all spend rows) would NOT reconcile here', () => {
    // Proves the equality assertion has teeth: a re-derivation that forgets the
    // net-refund category drop produces a different figure on this fixture.
    const naive = TXNS.filter((t) => isSpendRow(t, JUNE, CATEGORY_BY_ID)).reduce(
      (s, t) => s + spendContributionCents(t),
      0,
    );
    const breakdown = spendingByCategory(TXNS as ReportTxn[], JUNE);
    expect(naive).not.toBe(breakdown.totalCents); // 26600 (includes the −2000) ≠ 28600
  });
});

// ── Critic 2026-07-15 F1/F3: custom category meta is load-bearing ───────────

describe('F1 — custom category meta: the trace uses the SAME merged meta the answer did', () => {
  // A custom "Golf" category (cuid-style id) in the Shopping group, with spend.
  const GOLF_META = mergeCategoryMeta([{ id: 'cknq1golf', name: 'Golf', group: 'Shopping', discretionary: true }]);
  const golfTxns: TraceTxn[] = [
    ...TXNS,
    T('2026-06-05', -12000, 'cknq1golf', 'PGA SUPERSTORE'),
  ];
  const golfInput = { transactions: golfTxns, today: TODAY, meta: GOLF_META };

  it('group-target (Shopping) includes the custom category, reconciled, correctly labeled', () => {
    const trace = traceAnswer(
      {
        kind: 'spend_by_category',
        timeframe: JUNE,
        target: { type: 'group', group: 'Shopping', label: 'shopping' },
      },
      golfInput,
    ) as RowSumTrace;
    expect(trace.kind).toBe('row_sum');
    // shopping 12100 + golf 12000 — the same figure answerSpendByCategory serves
    // when the server passes mergeCategoryMeta(custom).
    const breakdown = spendingByCategory(golfTxns as ReportTxn[], JUNE, GOLF_META);
    const shoppingGroup = breakdown.byGroup.find((g) => g.group === 'Shopping');
    expect(trace.headlineCents).toBe(shoppingGroup?.amountCents);
    expect(trace.headlineCents).toBe(24100);
    expect(trace.reconciled).toBe(true);
    expect(trace.groups?.find((g) => g.key === 'cknq1golf')?.label).toBe('Golf'); // never "Uncategorized"
  });

  it('spend_total with custom meta reconciles and buckets the custom rows', () => {
    const trace = traceAnswer({ kind: 'spend_total', timeframe: JUNE }, golfInput) as RowSumTrace;
    expect(trace.headlineCents).toBe(28600 + 12000);
    expect(trace.reconciled).toBe(true);
  });
});

// ── Critic 2026-07-15 F2: answer→tap drift is reported, never green-checked ─

describe('F2 — expectedHeadlineCents: input drift between answer and tap fails reconciliation', () => {
  it('a row synced after the answer → tap-time recomputation is flagged unreconciled', () => {
    const drifted: TraceTxn[] = [...TXNS, T('2026-06-14', -9900, 'groceries', 'KROGER #529')];
    const trace = traceAnswer(
      { kind: 'spend_total', timeframe: JUNE },
      { transactions: drifted, today: TODAY, meta: CATEGORY_BY_ID, expectedHeadlineCents: 28600 },
    ) as RowSumTrace;
    expect(trace.headlineCents).toBe(38500); // internally consistent…
    expect(trace.sumCents).toBe(38500);
    expect(trace.reconciled).toBe(false); // …but NOT the number the user tapped
  });

  it('matching expectedHeadlineCents leaves a clean trace reconciled', () => {
    const trace = traceAnswer(
      { kind: 'spend_total', timeframe: JUNE },
      { ...INPUT, expectedHeadlineCents: 28600 },
    ) as RowSumTrace;
    expect(trace.reconciled).toBe(true);
  });

  it('the drift check also guards the reshape kinds (merchant_spend)', () => {
    const trace = traceAnswer(
      { kind: 'merchant_spend', timeframe: JUNE, merchant: 'amazon' },
      { ...INPUT, expectedHeadlineCents: 6600 + 100 },
    ) as RowSumTrace;
    expect(trace.headlineCents).toBe(6600);
    expect(trace.reconciled).toBe(false);
  });
});

// ── Criterion 6: reports.ts extraction is byte-identical ────────────────────

describe('C6 — spendingByCategory output is identical to the pre-refactor reference', () => {
  /** The pre-extraction spendingByCategory loop, copied verbatim as a reference. */
  function referenceTotals(txns: readonly ReportTxn[], range: { fromYm: string; toYm: string }) {
    const totals = new Map<string, number>();
    for (const t of txns) {
      if (t.isSplitParent || t.isTransfer) continue;
      const ym = t.date.slice(0, 7);
      if (ym < range.fromYm || ym > range.toYm) continue;
      const id = t.categoryId ?? 'uncategorized';
      if (id === 'transfer') continue;
      const cat = CATEGORY_BY_ID.get(id);
      if (cat?.group === 'Income') continue;
      if (t.amountCents < 0) totals.set(id, (totals.get(id) ?? 0) + -t.amountCents);
      else totals.set(id, (totals.get(id) ?? 0) - t.amountCents);
    }
    return totals;
  }

  it('shared-predicate totals equal the reference on the fixture (incl. edge rows)', () => {
    const viaShared = new Map<string, number>();
    for (const t of TXNS) {
      if (!isSpendRow(t, JUNE, CATEGORY_BY_ID)) continue;
      const id = spendRowCategoryId(t);
      viaShared.set(id, (viaShared.get(id) ?? 0) + spendContributionCents(t));
    }
    expect(viaShared).toEqual(referenceTotals(TXNS as ReportTxn[], JUNE));
  });

  it('each byCategory amount equals the sum of its isSpendRow rows (never for dropped ones)', () => {
    const breakdown = spendingByCategory(TXNS as ReportTxn[], JUNE);
    for (const c of breakdown.byCategory) {
      const rows = TXNS.filter((t) => isSpendRow(t, JUNE, CATEGORY_BY_ID) && spendRowCategoryId(t) === c.categoryId);
      expect(rows.reduce((s, t) => s + spendContributionCents(t), 0)).toBe(c.amountCents);
    }
  });

  it('isIncomeFlowRow composes to monthlyFlows income exactly', () => {
    const flows = monthlyFlows(TXNS);
    const june = flows.find((f) => f.month === '2026-06');
    const viaPredicate = TXNS.filter((t) => t.date.slice(0, 7) === '2026-06' && isIncomeFlowRow(t)).reduce(
      (s, t) => s + t.amountCents,
      0,
    );
    expect(viaPredicate).toBe(june?.incomeCents);
  });
});

// ── Criterion 1 on the REAL seed: every row-sum intent reconciles ───────────

describe('Seed grounding — every ROW-SUM intent reconciles on the demo dataset', () => {
  const SEED_TODAY = isoDate('2026-06-10');
  const seed = buildSeedData('2026-06-10');
  const seedTxns: TraceTxn[] = seed.transactions.map((t) => ({
    date: t.date,
    amountCents: t.amountCents,
    rawDescriptor: t.rawDescriptor,
    accountId: t.accountId,
    status: t.status,
    isTransfer: t.isTransfer,
    isSplitParent: false,
    categoryId: normalizeMerchant(t.rawDescriptor).categoryId,
  }));
  const seedInput = { transactions: seedTxns, today: SEED_TODAY as string, meta: CATEGORY_BY_ID };
  const THIS_MONTH: Timeframe = { fromYm: '2026-06', toYm: '2026-06', label: 'this month' };

  const seedTrace = (intent: AssistantIntent): RowSumTrace => {
    const trace = traceAnswer(intent, seedInput);
    expect(trace.kind).toBe('row_sum');
    return trace as RowSumTrace;
  };

  it('spend_total reconciles, non-vacuously, to the reports engine total', () => {
    const t = seedTrace({ kind: 'spend_total', timeframe: THIS_MONTH });
    const breakdown = spendingByCategory(seedTxns as ReportTxn[], THIS_MONTH);
    expect(t.headlineCents).toBe(breakdown.totalCents);
    expect(t.headlineCents).toBeGreaterThan(0);
    expect(t.rows.length).toBeGreaterThan(0);
    expect(t.reconciled).toBe(true);
  });

  it('spend_by_category (groceries) reconciles', () => {
    const t = seedTrace({
      kind: 'spend_by_category',
      timeframe: THIS_MONTH,
      target: { type: 'category', categoryId: 'groceries', label: 'Groceries' },
    });
    expect(t.headlineCents).toBeGreaterThan(0);
    expect(t.reconciled).toBe(true);
  });

  it('top_categories reconciles', () => {
    const t = seedTrace({ kind: 'top_categories', timeframe: THIS_MONTH, limit: 3 });
    expect(t.headlineCents).toBeGreaterThan(0);
    expect(t.reconciled).toBe(true);
  });

  it('merchant_spend (costco) reconciles to merchantSpend', () => {
    const t = seedTrace({ kind: 'merchant_spend', timeframe: THIS_MONTH, merchant: 'costco' });
    const res = merchantSpend(toPurchaseRows(seedTxns), THIS_MONTH, 'costco', SEED_TODAY);
    expect(t.headlineCents).toBe(res.totalCents);
    expect(t.headlineCents).toBeGreaterThan(0);
    expect(t.reconciled).toBe(true);
  });

  it('income reconciles to monthlyFlows (last month — complete, non-vacuous)', () => {
    const LAST_MONTH: Timeframe = { fromYm: '2026-05', toYm: '2026-05', label: 'last month' };
    const t = seedTrace({ kind: 'income', timeframe: LAST_MONTH });
    const may = monthlyFlows(seedTxns).find((f) => f.month === '2026-05');
    expect(t.headlineCents).toBe(may?.incomeCents ?? -1);
    expect(t.headlineCents).toBeGreaterThan(0);
    expect(t.rows.length).toBeGreaterThan(0);
    expect(t.reconciled).toBe(true);
  });

  it('largest_purchases reconciles to the engine’s top row', () => {
    const t = seedTrace({ kind: 'largest_purchases', timeframe: THIS_MONTH, limit: 3 });
    const top = largestPurchases(toPurchaseRows(seedTxns), THIS_MONTH, 3, SEED_TODAY)[0];
    expect(t.headlineCents).toBe(top.amountCents);
    expect(t.reconciled).toBe(true);
  });
});
