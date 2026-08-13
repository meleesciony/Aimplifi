/**
 * C.13 — the Fixed / Discretionary HEADINGS on /budgets are links, so each of
 * those totals is a claim that the register adds up to it.
 *
 * The claim under test is not "the href is well formed" (that is
 * spend-class-register-links.test.ts). It is the one the reader acts on: click
 * "Fixed", land on the register filtered to Fixed for the same month, and see
 * the same money. So this file runs BOTH sides over ONE fixture, each fed the
 * way production feeds it:
 *
 *  - source: `summarizeSpendClassCategories`, the engine behind the /budgets
 *    panel, over the page's month query (split parents and transfers already
 *    excluded in Prisma, PENDING deliberately included — #397).
 *  - destination: `filterTransactions` over register rows carrying the
 *    `spendClass` `getTransactions` stamps on them with the SAME classifier.
 *
 * The axis this file exists for is the RECONCILIATION BOUNDARY (R1). The
 * register applies `getReconciliationTxnKeep` before it classifies anything, so
 * a reader who has confirmed a provider migration sees each real purchase once
 * there. The panel summed the raw month query and counted the predecessor's copy
 * of every post-cutover purchase a second time. Both surfaces now take the same
 * predicate, and the control at the bottom pins what happens without it.
 */
import { describe, expect, it } from 'vitest';
import { CATEGORY_BY_ID } from '@/lib/engine/categorize/categories';
import { reconciliationTxnKeepFilter } from '@/lib/engine/account/reconcile-boundary';
import { spendClassMonthRegisterHref } from '@/lib/engine/transactions/links';
import {
  classifySpendClass,
  spendClassLoanPaymentNote,
  summarizeSpendClassCategories,
} from '@/lib/engine/spending-plan/spend-class';
import { filterTransactions, type TxnView } from '@/lib/engine/transactions/query';
import type { TxnLike } from '@/lib/engine/fi/insights';

const MONTH = '2026-06';

/** The migration: PRED was disconnected and re-linked as SUCC on the 15th. */
const PRED = 'acct-old';
const SUCC = 'acct-new';
const CUTOVER = '2026-06-15';

const ACCOUNTS = [
  { id: PRED, type: 'depository', currentBalanceCents: 0 },
  { id: SUCC, type: 'depository', currentBalanceCents: 500_00 },
];
const LINKS = [{ predecessorAccountId: PRED, successorAccountId: SUCC, cutoverDate: CUTOVER }];
/** Full-history min/max over the predecessor — the aggregate the server passes. */
const SPANS = [{ accountId: PRED, first: '2026-01-04', last: '2026-06-20' }];

const keepsReconciled = reconciliationTxnKeepFilter(ACCOUNTS, LINKS, SPANS);

interface Row {
  id: string;
  accountId: string;
  date: string;
  amountCents: number;
  categoryId: string;
  status?: string;
  spendClassOverride?: 'fixed' | 'guilt-free' | null;
  excludeFromTotals?: boolean;
}

/**
 * A migrated month. The two accounts carry the SAME four purchases across the
 * cutover, which is what a backfilling successor actually looks like: `p*` rows
 * are the predecessor's copies, `s*` the successor's.
 */
const FIXTURE: Row[] = [
  // Before the cutover — the predecessor owns these; the successor has no copy.
  { id: 'p1', accountId: PRED, date: '2026-06-02', amountCents: -120_00, categoryId: 'groceries' },
  { id: 'p2', accountId: PRED, date: '2026-06-09', amountCents: -35_00, categoryId: 'dining' },
  // ...and the successor's backfill of the SAME two purchases, inside the
  // predecessor's claim window. R1 drops these; without it they double.
  { id: 's1', accountId: SUCC, date: '2026-06-02', amountCents: -120_00, categoryId: 'groceries' },
  { id: 's2', accountId: SUCC, date: '2026-06-09', amountCents: -35_00, categoryId: 'dining' },
  // After the cutover the successor owns the ledger. The predecessor's feed kept
  // reporting until the 20th (its span `last`), so it too holds copies — R1 drops
  // the PREDECESSOR side here, the mirror image of the case above.
  { id: 's3', accountId: SUCC, date: '2026-06-18', amountCents: -1_800_00, categoryId: 'rent' },
  { id: 'p3', accountId: PRED, date: '2026-06-18', amountCents: -1_800_00, categoryId: 'rent' },
  // A PENDING charge, which both surfaces count (#397) — strip it and the
  // equality below could pass on a POSTED-only fixture.
  { id: 's4', accountId: SUCC, date: '2026-06-27', amountCents: -62_50, categoryId: 'dining', status: 'PENDING' },
  // One dining row the reader designated Fixed — the class is per row, so this
  // must land on the Fixed side of BOTH totals or the split is the divergence.
  { id: 's5', accountId: SUCC, date: '2026-06-25', amountCents: -40_00, categoryId: 'dining', spendClassOverride: 'fixed' },
  // Never in either total, by three different rules: a refund (money in), an
  // excluded row, and a settlement category.
  { id: 's6', accountId: SUCC, date: '2026-06-22', amountCents: 15_00, categoryId: 'groceries' },
  { id: 's7', accountId: SUCC, date: '2026-06-23', amountCents: -9_00, categoryId: 'dining', excludeFromTotals: true },
  { id: 's8', accountId: SUCC, date: '2026-06-24', amountCents: -400_00, categoryId: 'credit-card-payment' },
];

/** /budgets intake: the page's month query, mapped the way page.tsx maps it. */
const asPanelRows = (rows: Row[]): TxnLike[] =>
  rows.map((r) => ({
    accountId: r.accountId,
    date: r.date,
    amountCents: r.amountCents,
    categoryId: r.categoryId,
    isTransfer: false,
    status: r.status ?? 'POSTED',
    rawDescriptor: 'TEST',
    excludeFromTotals: r.excludeFromTotals ?? false,
    spendClassOverride: r.spendClassOverride ?? null,
  }));

/** Register intake: `getTransactions` stamps `spendClass` with the same classifier. */
const asTxnViews = (rows: Row[]): TxnView[] =>
  rows
    .filter((r) => keepsReconciled(r.accountId, r.date))
    .map((r) => ({
      id: r.id,
      date: r.date,
      accountId: r.accountId,
      accountName: r.accountId,
      merchantName: 'Test Merchant',
      rawDescriptor: 'TEST',
      categoryId: r.categoryId,
      categoryName: r.categoryId,
      amountCents: r.amountCents,
      status: r.status ?? 'POSTED',
      descriptorOrigin: 'bank',
      isTransfer: false,
      onHandoverDay: false,
      note: null,
      taxClass: null,
      needsReview: false,
      provenance: { kind: 'merchant-default', label: 'Known merchant', needsConfirm: false },
      excludeFromTotals: r.excludeFromTotals ?? false,
      reimbursement: null,
      splitParentId: null,
      suggestion: null,
      spendClass: classifySpendClass(asPanelRows([r])[0]!, CATEGORY_BY_ID, new Set()),
      spendClassReaderSet: false,
    }));

/** What the register shows after following the heading's href. */
function followHref(href: string, rows: Row[]) {
  const params = new URLSearchParams(href.split('?')[1]);
  const landed = filterTransactions(asTxnViews(rows), {
    spendClass: params.get('spendClass') as 'fixed' | 'guilt-free',
    from: params.get('from'),
    to: params.get('to'),
  });
  // The panel prints OUTFLOW per class; a refund never carries a class at all
  // (`classifySpendClass` refuses `amountCents >= 0`), so no netting is possible
  // on either side and a plain sum is the honest comparison.
  return {
    rows: landed,
    outflowCents: landed.reduce((sum, t) => sum + -t.amountCents, 0),
  };
}

const panel = (rows: Row[], keeps: (accountId: string, date: string) => boolean) =>
  summarizeSpendClassCategories(
    asPanelRows(rows),
    CATEGORY_BY_ID,
    new Set(),
    (id) => CATEGORY_BY_ID.get(id)?.name ?? id,
    keeps,
  );

const totalOf = (side: { spentCents: number }[]) => side.reduce((s, r) => s + r.spentCents, 0);

describe('C.13 — the Fixed / Discretionary heading equals its destination', () => {
  const { fixed, guiltFree } = panel(FIXTURE, keepsReconciled);

  it('the fixture actually exercises the boundary (anti-vacuity)', () => {
    // Without these the equality below could pass on a fixture with nothing to
    // discriminate — the failure mode a rendered-page lock hides behind.
    const landedFixed = followHref(
      spendClassMonthRegisterHref({ spendClass: 'fixed', month: MONTH, amountCents: 0 }),
      FIXTURE,
    ).rows.map((r) => r.id);
    // Both directions of the R1 rule are live: a successor backfill dropped...
    expect(landedFixed).not.toContain('s1');
    expect(landedFixed).toContain('p1');
    // ...and a predecessor row that kept reporting past the cutover dropped.
    expect(landedFixed).not.toContain('p3');
    expect(landedFixed).toContain('s3');
    // A pending row and a per-row override are both in play.
    const landedGuiltFree = followHref(
      spendClassMonthRegisterHref({ spendClass: 'guilt-free', month: MONTH, amountCents: 0 }),
      FIXTURE,
    ).rows;
    expect(landedGuiltFree.some((r) => r.status === 'PENDING')).toBe(true);
    expect(landedFixed).toContain('s5'); // dining, designated Fixed
  });

  it('Fixed: the landing page sums to exactly the heading figure', () => {
    // Hand-verified: groceries 120.00 + rent 1,800.00 + the designated dining
    // 40.00 = 1,960.00. The doubled copies (s1, p3) are in neither.
    expect(totalOf(fixed)).toBe(1_960_00);
    const { outflowCents } = followHref(
      spendClassMonthRegisterHref({ spendClass: 'fixed', month: MONTH, amountCents: totalOf(fixed) }),
      FIXTURE,
    );
    expect(outflowCents).toBe(totalOf(fixed));
  });

  it('Discretionary: the landing page sums to exactly the heading figure', () => {
    // Hand-verified: dining 35.00 + the pending 62.50 = 97.50. The excluded row
    // (9.00) and the card payment are in neither side.
    expect(totalOf(guiltFree)).toBe(97_50);
    const { outflowCents } = followHref(
      spendClassMonthRegisterHref({
        spendClass: 'guilt-free',
        month: MONTH,
        amountCents: totalOf(guiltFree),
      }),
      FIXTURE,
    );
    expect(outflowCents).toBe(totalOf(guiltFree));
  });

  it('CONTROL — without the reconciliation keep the heading promises money the register cannot show', () => {
    // This is the defect, executed: the panel's own arithmetic with an
    // always-true keep, against the destination the reader actually lands on.
    const unfiltered = panel(FIXTURE, () => true);
    expect(totalOf(unfiltered.fixed)).toBe(1_960_00 + 120_00 + 1_800_00);
    const { outflowCents } = followHref(
      spendClassMonthRegisterHref({ spendClass: 'fixed', month: MONTH, amountCents: 0 }),
      FIXTURE,
    );
    expect(outflowCents).not.toBe(totalOf(unfiltered.fixed));
    // ...and the discretionary side doubles its pre-cutover dining row too.
    expect(totalOf(unfiltered.guiltFree)).toBe(97_50 + 35_00);
  });

  it('no links → the keep is the R8 constant-true fast path, and both sides are unchanged', () => {
    const noLinks = reconciliationTxnKeepFilter(ACCOUNTS, [], []);
    const before = panel(FIXTURE, noLinks);
    const unfiltered = panel(FIXTURE, () => true);
    expect(totalOf(before.fixed)).toBe(totalOf(unfiltered.fixed));
    // Both sides, not just Fixed — the earlier version of this case asserted
    // half of what its name claimed (critic P2-4).
    expect(totalOf(before.guiltFree)).toBe(totalOf(unfiltered.guiltFree));
  });
});

describe('C.13 critic P1-1 — the page owes the reader the sentence that reconciles its two figures', () => {
  // /budgets prints one category twice: under "By category", where C.25 (#403)
  // takes a loan payment carried on its loan OUT so that figure still sums to
  // its own register link; and under "Fixed expenses", which keeps it so THAT
  // link still matches. Both are right. Only the lower one carried a sentence.
  const note = spendClassLoanPaymentNote({
    payee: 'TRUIST MORTG OLB MTGPMT',
    loanName: 'Mortgage 1192',
    amount: '$6,217.07',
  });

  it('names the payee, the amount, the loan, and the DIRECTION on this list', () => {
    expect(note).toContain('TRUIST MORTG OLB MTGPMT');
    expect(note).toContain('$6,217.07');
    expect(note).toContain('Mortgage 1192');
    // The direction is the whole point: a reader who has just read "not counted"
    // under the figure below must be told this one DOES count it, or the page
    // contradicts itself in the reader's head rather than on the screen.
    expect(note).toMatch(/ARE counted here/);
    expect(note).toMatch(/By category below/);
  });

  it('says the two lists differ by that amount, so neither figure reads as a bug', () => {
    expect(note).toMatch(/differ by that amount/);
  });
});
