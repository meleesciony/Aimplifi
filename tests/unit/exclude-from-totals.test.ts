/**
 * O.15 slice 2 — the exclusion basis. One property, checked at every summer:
 * an excluded row leaves the total EXACTLY as if it were deleted, and an
 * un-excluded row leaves every figure byte-identical to before the field
 * existed (absent/null/false all mean "counts").
 *
 * The known-answer style is deliberate: each case computes the total twice —
 * once with the row present-and-excluded, once with the row physically
 * removed — and asserts the two agree. That is the definition of "one basis":
 * exclusion may never invent a third value.
 */
import { describe, expect, it } from 'vitest';
import { isExcludedFromTotals } from '@/lib/engine/transactions/exclude';
import { isSpendRow, spendingByCategory } from '@/lib/engine/reports/reports';
import { monthlyFlows, isIncomeFlowRow } from '@/lib/engine/fi/insights';
import { detectUnusualCharges } from '@/lib/engine/anomaly/detect';
import { buildMerchantProfile } from '@/lib/engine/merchant/profile';
import { discretionaryDailyOutflows } from '@/lib/engine/radar/burn';
import { summarizeSharedMovement } from '@/lib/engine/household/digest';
import { summarizeTransactions, type TxnView } from '@/lib/engine/transactions/query';
import { isoDate } from '@/lib/dates';

const RANGE = { fromYm: '2026-06', toYm: '2026-06' };

const spendRow = (over: Record<string, unknown> = {}) => ({
  date: '2026-06-10',
  amountCents: -21240,
  categoryId: 'groceries',
  isTransfer: false,
  isSplitParent: false,
  ...over,
});

describe('isExcludedFromTotals — the single predicate', () => {
  it('true ONLY on an explicit true; absent, null and false all count', () => {
    expect(isExcludedFromTotals({})).toBe(false);
    expect(isExcludedFromTotals({ excludeFromTotals: null })).toBe(false);
    expect(isExcludedFromTotals({ excludeFromTotals: false })).toBe(false);
    expect(isExcludedFromTotals({ excludeFromTotals: true })).toBe(true);
  });
});

describe('reports / budgets basis (isSpendRow)', () => {
  it('an excluded row is refused; the same row un-excluded is admitted', () => {
    expect(isSpendRow(spendRow(), RANGE)).toBe(true);
    expect(isSpendRow(spendRow({ excludeFromTotals: true }), RANGE)).toBe(false);
  });

  it('spendingByCategory with the row excluded equals the breakdown with the row deleted', () => {
    const kept = spendRow({ amountCents: -5000, categoryId: 'dining' });
    const excluded = spendRow({ excludeFromTotals: true });
    const withExcluded = spendingByCategory([kept, excluded], RANGE);
    const withDeleted = spendingByCategory([kept], RANGE);
    expect(withExcluded).toEqual(withDeleted);
    expect(withExcluded.totalCents).toBe(5000);
  });
});

describe('coach flows basis (monthlyFlows / countsInFlows)', () => {
  const flowRow = (over: Record<string, unknown> = {}) => ({
    date: '2026-06-10',
    amountCents: -21240,
    rawDescriptor: 'COSTCO WHSE',
    accountId: 'a1',
    isTransfer: false,
    status: 'POSTED',
    categoryId: 'groceries',
    ...over,
  });

  it('an excluded outflow leaves expenses; an excluded inflow leaves income', () => {
    const income = flowRow({ amountCents: 500000, categoryId: 'paycheck', rawDescriptor: 'PAYROLL' });
    const withBoth = monthlyFlows([income, flowRow()]);
    expect(withBoth[0].expensesCents).toBe(21240);
    expect(withBoth[0].incomeCents).toBe(500000);

    const excludedSpend = monthlyFlows([income, flowRow({ excludeFromTotals: true })]);
    expect(excludedSpend[0].expensesCents).toBe(0);
    expect(excludedSpend[0].incomeCents).toBe(500000);

    const excludedIncome = monthlyFlows([income, flowRow()].map((t) =>
      t.amountCents > 0 ? { ...t, excludeFromTotals: true } : t,
    ));
    expect(excludedIncome[0].incomeCents).toBe(0);
    expect(excludedIncome[0].expensesCents).toBe(21240);
  });

  it('isIncomeFlowRow refuses an excluded inflow (trace parity with the sum)', () => {
    const income = flowRow({ amountCents: 500000, categoryId: 'paycheck' });
    expect(isIncomeFlowRow(income)).toBe(true);
    expect(isIncomeFlowRow({ ...income, excludeFromTotals: true })).toBe(false);
  });
});

describe('behavioral engines follow the same basis', () => {
  it('anomaly detector: an excluded spike neither flags nor pollutes the baseline', () => {
    const base = Array.from({ length: 6 }, (_, i) => ({
      id: `t${i}`,
      date: `2026-06-0${i + 1}`,
      amountCents: -2000,
      rawDescriptor: 'BLUE BOTTLE',
      isTransfer: false,
      status: 'POSTED',
    }));
    const spike = {
      id: 'spike',
      date: '2026-06-20',
      amountCents: -50000,
      rawDescriptor: 'BLUE BOTTLE',
      isTransfer: false,
      status: 'POSTED',
    };
    const flagged = detectUnusualCharges([...base, spike], isoDate('2026-06-21'));
    expect(flagged.map((f) => f.txnId)).toContain('spike');
    const excludedSpike = detectUnusualCharges(
      [...base, { ...spike, excludeFromTotals: true }],
      isoDate('2026-06-21'),
    );
    expect(excludedSpike.map((f) => f.txnId)).not.toContain('spike');
  });

  it('merchant lens: an excluded charge leaves count and total', () => {
    const rows = [
      { date: '2026-04-05', amountCents: -1000, merchant: 'Blue Bottle', status: 'POSTED', isTransfer: false },
      { date: '2026-05-05', amountCents: -1000, merchant: 'Blue Bottle', status: 'POSTED', isTransfer: false },
      { date: '2026-06-05', amountCents: -9000, merchant: 'Blue Bottle', status: 'POSTED', isTransfer: false, excludeFromTotals: true },
    ];
    const profile = buildMerchantProfile(rows, 'Blue Bottle', isoDate('2026-06-20'));
    expect(profile?.chargeCount).toBe(2);
    expect(profile?.totalCents).toBe(2000);
  });

  it('radar burn: an excluded outflow is not spending pace', () => {
    const t = (over: Record<string, unknown> = {}) => ({
      accountId: 'pay',
      date: '2026-06-18',
      amountCents: -3000,
      rawDescriptor: 'CHIPOTLE 123',
      status: 'POSTED',
      isTransfer: false,
      ...over,
    });
    const params = { paymentAccountId: 'pay', excludedCanonicals: new Set<string>(), today: isoDate('2026-06-20') };
    const withRow = discretionaryDailyOutflows([t()], params);
    const withExcluded = discretionaryDailyOutflows([t({ excludeFromTotals: true })], params);
    expect(withRow.reduce((a, b) => a + b, 0)).toBe(3000);
    expect(withExcluded.reduce((a, b) => a + b, 0)).toBe(0);
  });

  it('household shared movement: excluded rows leave outflow, inflow AND the row count', () => {
    const row = {
      date: isoDate('2026-06-10'),
      amountCents: -4000,
      isTransfer: false,
      status: 'POSTED',
      isSplitParent: false,
    };
    const base = { accountCount: 1, since: isoDate('2026-06-01'), today: isoDate('2026-06-20') };
    const withRow = summarizeSharedMovement({ rows: [row], ...base });
    const withExcluded = summarizeSharedMovement({ rows: [{ ...row, excludeFromTotals: true }], ...base });
    expect(withRow.outflowCents).toBe(4000);
    expect(withRow.transactionCount).toBe(1);
    expect(withExcluded.outflowCents).toBe(0);
    expect(withExcluded.transactionCount).toBe(0);
  });
});

describe('the register: the one place an excluded row STAYS', () => {
  const view = (over: Partial<TxnView> = {}): TxnView => ({
    id: 't1',
    date: '2026-06-10',
    accountId: 'a1',
    accountName: 'Checking',
    merchantName: 'Costco',
    rawDescriptor: 'COSTCO WHSE',
    categoryId: 'groceries',
    categoryName: 'Groceries',
    amountCents: -21240,
    status: 'POSTED',
    descriptorOrigin: 'bank',
    isTransfer: false,
    note: null,
    taxClass: null,
    excludeFromTotals: false,
    reimbursement: null,
    splitParentId: null,
    needsReview: false,
    provenance: { kind: 'not-recorded', label: 'Not recorded', needsConfirm: false } as TxnView['provenance'],
    suggestion: null,
    ...over,
  });

  it('summary money figures drop the excluded row; the row count keeps it; excludedCount is set-scoped', () => {
    const rows = [view(), view({ id: 't2', amountCents: -5000, excludeFromTotals: true })];
    const s = summarizeTransactions(rows);
    expect(s.count).toBe(2); // still listed — the badge, not absence, is the disclosure
    expect(s.outflowCents).toBe(21240);
    expect(s.netCents).toBe(-21240);
    // Critic P2-1: the caption branches on THIS (computed over the whole
    // filtered set server-side), never on the page slice.
    expect(s.excludedCount).toBe(1);
    expect(summarizeTransactions([view()]).excludedCount).toBe(0);
  });
});
