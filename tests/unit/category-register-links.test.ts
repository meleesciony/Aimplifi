/**
 * O.5 — a category figure links to the rows that make it up.
 *
 * The claim under test is NOT "the link points at /transactions". It is the one
 * the owner's request depends on ("so user can quickly view for accuracy"): the
 * destination adds up to the figure that was clicked. A link whose landing page
 * sums to a different number is worse than no link at all, so the central test
 * here runs BOTH engines over ONE fixture and asserts the totals are equal.
 *
 * Each side is fed the way production feeds it, which is the only way this test
 * can catch a real drift:
 *  - source: `spendingByCategory`, the engine behind /reports, the dashboard
 *    breakdown and the trends movers, over snapshot rows — split parents INCLUDED
 *    in the input because the snapshot does not filter them (the engine drops them).
 *  - destination: `filterTransactions` + `summarizeTransactions` over register
 *    rows — split parents ABSENT from the input, because `getTransactions` excludes
 *    them in the Prisma query (src/server/transactions.ts:113) before the engine
 *    ever sees them.
 */
import { describe, expect, it } from 'vitest';
import { monthWindow } from '@/lib/dates';
import { categoryMonthRegisterHref, categoryRegisterHref } from '@/lib/engine/transactions/links';

/** The register's category control can show these — see getVisibleGroups. */
const LINKABLE = new Set(['groceries', 'travel', 'cat/with space&amp']);
import { spendingByCategory, type ReportTxn } from '@/lib/engine/reports/reports';
import { filterTransactions, summarizeTransactions, type TxnView } from '@/lib/engine/transactions/query';

describe('categoryRegisterHref (O.5 — the link itself)', () => {
  it('names the three params the register reads', () => {
    expect(categoryRegisterHref({ categoryId: 'groceries', from: '2026-06-01', to: '2026-06-30' }, LINKABLE)).toBe(
      '/transactions?category=groceries&from=2026-06-01&to=2026-06-30',
    );
  });

  it('derives a whole calendar month, including a 31-day one', () => {
    expect(categoryMonthRegisterHref('groceries', '2026-06', LINKABLE)).toBe(
      '/transactions?category=groceries&from=2026-06-01&to=2026-06-30',
    );
    expect(categoryMonthRegisterHref('travel', '2026-07', LINKABLE)).toBe(
      '/transactions?category=travel&from=2026-07-01&to=2026-07-31',
    );
  });

  it('survives a custom category id with URL-hostile characters', () => {
    // Custom categories carry generated ids; the id must arrive on the far side
    // verbatim or it matches nothing and the reader sees an empty register.
    const href = categoryMonthRegisterHref('cat/with space&amp', '2026-06', LINKABLE)!;
    const got = new URLSearchParams(href.split('?')[1]).get('category');
    expect(got).toBe('cat/with space&amp');
  });

  it('REFUSES a category the reader has HIDDEN, which /reports still prints (critic F-3)', () => {
    // Hiding governs pickers, not what you spent: `getReports` applies no
    // visibility filter, so a hidden category keeps rendering a figure here while
    // `getVisibleGroups` drops it from the register's control. Same hole as
    // `uncategorized`, reached by a completely different route — which is why the
    // fence asks the destination's option list instead of naming one id.
    expect(categoryMonthRegisterHref('coffee', '2026-06', LINKABLE)).toBeNull();
    // ...and it links again the moment the reader unhides it.
    expect(categoryMonthRegisterHref('coffee', '2026-06', new Set([...LINKABLE, 'coffee']))).not.toBeNull();
  });

  it('REFUSES the uncategorized bucket, which the register filters but cannot display', () => {
    // The rows would be filtered correctly (getTransactions maps null →
    // 'uncategorized' before filtering), but the register's category <select>
    // omits the placeholder, so the control would read "All categories" over a
    // filtered list and the next filter change would drop it. Refusing in the
    // BUILDER means no present or future surface can reintroduce that link.
    expect(categoryMonthRegisterHref('uncategorized', '2026-06', LINKABLE)).toBeNull();
    expect(categoryRegisterHref({ categoryId: 'uncategorized', from: '2026-06-01', to: '2026-06-30' }, LINKABLE)).toBeNull();
  });
});

/**
 * One fixture, both intakes. Amounts chosen so every exclusion rule changes the
 * answer if it breaks: the window edges are ±1 day from the boundary, and the
 * refund makes "sum the outflows" a WRONG answer.
 */
const MONTH = '2026-06';
const CATEGORY = 'groceries';

interface Row {
  id: string;
  date: string;
  amountCents: number;
  categoryId: string;
  isTransfer?: boolean;
  isSplitParent?: boolean;
  status?: string;
}

const FIXTURE: Row[] = [
  { id: 'r1', date: '2026-06-05', amountCents: -12000, categoryId: CATEGORY },
  // PENDING counts on both sides of the /reports↔register comparison: the
  // snapshot and the register each apply no status filter. This is NOT true of
  // every category surface — see the divergence suite at the bottom of this file,
  // which is why /trends and /budgets are not linked.
  { id: 'r2', date: '2026-06-15', amountCents: -8000, categoryId: CATEGORY, status: 'PENDING' },
  // A refund nets DOWN the source figure and is an INFLOW on the destination.
  { id: 'r3', date: '2026-06-20', amountCents: 3000, categoryId: CATEGORY },
  // Same category, but a transfer — never spending on either side.
  { id: 'r4', date: '2026-06-10', amountCents: -50000, categoryId: CATEGORY, isTransfer: true },
  // A split PARENT is a container: dropped by the engine, absent from the register.
  { id: 'r5', date: '2026-06-12', amountCents: -99900, categoryId: CATEGORY, isSplitParent: true },
  // Window edges — one day outside on each side...
  { id: 'r6', date: '2026-05-31', amountCents: -4000, categoryId: CATEGORY },
  { id: 'r7', date: '2026-07-01', amountCents: -5000, categoryId: CATEGORY },
  // ...and the first and last day INSIDE, which an off-by-one on either bound drops.
  { id: 'r8', date: '2026-06-01', amountCents: -1000, categoryId: CATEGORY },
  { id: 'r9', date: '2026-06-30', amountCents: -2500, categoryId: CATEGORY },
  // A different category entirely.
  { id: 'r10', date: '2026-06-08', amountCents: -70000, categoryId: 'travel' },
];

/** Snapshot intake: everything, split parents included (the engine drops them). */
const asReportTxns = (rows: Row[]): ReportTxn[] =>
  rows.map((r) => ({
    date: r.date,
    amountCents: r.amountCents,
    categoryId: r.categoryId,
    isTransfer: r.isTransfer ?? false,
    isSplitParent: r.isSplitParent ?? false,
  }));

/** Register intake: the Prisma query has already excluded split parents. */
const asTxnViews = (rows: Row[]): TxnView[] =>
  rows
    .filter((r) => !r.isSplitParent)
    .map((r) => ({
      id: r.id,
      date: r.date,
      accountId: 'acct-A',
      accountName: 'Everyday Checking',
      merchantName: 'Test Merchant',
      rawDescriptor: 'TEST',
      categoryId: r.categoryId,
      categoryName: r.categoryId,
      amountCents: r.amountCents,
      status: r.status ?? 'POSTED',
      isTransfer: r.isTransfer ?? false,
      note: null,
      taxClass: null,
      provenance: { kind: 'merchant-default', label: 'Known merchant', needsConfirm: false },
    }));

/** What the register shows after following the href, as the page would build it. */
function followHref(href: string, rows: Row[]) {
  const params = new URLSearchParams(href.split('?')[1]);
  // The mapping transactions/page.tsx performs from search params to TxnFilter.
  const landed = filterTransactions(asTxnViews(rows), {
    categoryId: params.get('category'),
    from: params.get('from'),
    to: params.get('to'),
  });
  return { rows: landed, summary: summarizeTransactions(landed) };
}

describe('O.5 reconciliation — the destination equals the figure that was clicked', () => {
  const breakdown = spendingByCategory(asReportTxns(FIXTURE), { fromYm: MONTH, toYm: MONTH });
  const clicked = breakdown.byCategory.find((c) => c.categoryId === CATEGORY);

  it('the fixture actually exercises the hard cases (anti-vacuity)', () => {
    // Without this guard the equality below could pass on a fixture too easy to
    // discriminate — the failure mode a rendered-page lock hides behind.
    expect(clicked).toBeDefined();
    const { rows, summary } = followHref(categoryMonthRegisterHref(CATEGORY, MONTH, LINKABLE)!, FIXTURE);
    expect(summary.inflowCents).toBeGreaterThan(0); // a refund is present...
    expect(summary.outflowCents).not.toBe(clicked!.amountCents); // ...so outflow alone is WRONG
    expect(rows.some((r) => r.status === 'PENDING')).toBe(true);
    expect(rows.some((r) => r.isTransfer)).toBe(true);
    expect(rows.map((r) => r.id)).toContain('r8'); // first day of the month
    expect(rows.map((r) => r.id)).toContain('r9'); // last day of the month
  });

  it('the landing page nets to exactly the source figure', () => {
    const { summary } = followHref(categoryMonthRegisterHref(CATEGORY, MONTH, LINKABLE)!, FIXTURE);
    // Hand-verified: 120.00 + 80.00 − 30.00 (refund) + 10.00 + 25.00 = 205.00.
    expect(clicked!.amountCents).toBe(20500);
    // Spending is money out net of money back — the register's Net tile, signed.
    expect(summary.outflowCents - summary.inflowCents).toBe(clicked!.amountCents);
    expect(summary.netCents).toBe(-clicked!.amountCents);
  });

  it('excludes the neighbouring months, not merely "most" of them', () => {
    const { rows } = followHref(categoryMonthRegisterHref(CATEGORY, MONTH, LINKABLE)!, FIXTURE);
    const ids = rows.map((r) => r.id);
    expect(ids).not.toContain('r6'); // 2026-05-31
    expect(ids).not.toContain('r7'); // 2026-07-01
    expect(ids).not.toContain('r10'); // another category
  });

  it('a month-long window is what makes it reconcile — a bare category link does not', () => {
    // Mutation guard: drop the window and the destination absorbs May and July,
    // so the reader is shown a bigger number than the one they clicked. This is
    // why `CategoryWindow` makes from/to required.
    const { summary } = followHref(`/transactions?category=${CATEGORY}`, FIXTURE);
    expect(summary.outflowCents - summary.inflowCents).not.toBe(clicked!.amountCents);
  });

  it('reconciles for a category whose refunds exceed nothing (no-refund case)', () => {
    const simple = FIXTURE.filter((r) => r.id !== 'r3');
    const source = spendingByCategory(asReportTxns(simple), { fromYm: MONTH, toYm: MONTH }).byCategory.find(
      (c) => c.categoryId === CATEGORY,
    )!;
    const { summary } = followHref(categoryMonthRegisterHref(CATEGORY, MONTH, LINKABLE)!, simple);
    // With no refunds the two readings coincide, which is the common case.
    expect(summary.outflowCents - summary.inflowCents).toBe(source.amountCents);
    expect(summary.outflowCents).toBe(source.amountCents);
  });
});

describe('monthWindow (the day boundaries the link depends on)', () => {
  it('handles month lengths, including February in a leap and a common year', () => {
    expect(monthWindow('2026-02')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(monthWindow('2024-02')).toEqual({ from: '2024-02-01', to: '2024-02-29' });
    expect(monthWindow('2026-01')).toEqual({ from: '2026-01-01', to: '2026-01-31' });
    expect(monthWindow('2026-04')).toEqual({ from: '2026-04-01', to: '2026-04-30' });
    expect(monthWindow('2026-12')).toEqual({ from: '2026-12-01', to: '2026-12-31' });
  });

  it('rejects a malformed month key rather than building a silent bad window', () => {
    expect(() => monthWindow('2026-13')).toThrow();
    expect(() => monthWindow('not-a-month')).toThrow();
  });
});

/**
 * Why two category surfaces are NOT linked (O.5 critic P0-1).
 *
 * The refusal to link `/trends` movers and `/budgets` rows rests on a claim about
 * production code: those surfaces sum a DIFFERENT set of rows than the register
 * would show. A prose reason rots; this executes it. If someone later makes the
 * bases agree, these tests fail and the refusal can be lifted deliberately —
 * which is exactly the confrontation a comment cannot force.
 */
describe('O.5 — the basis divergence that blocks linking /trends and /budgets', () => {
  it('a POSTED-only intake reports LESS than the register for the same category month', () => {
    // src/server/trends.ts:22 filters `status === 'POSTED'` before the engine;
    // src/app/(app)/budgets/page.tsx:51 queries `status: 'POSTED'`. The register
    // (src/server/transactions.ts:107) applies no status predicate at all.
    const postedOnly = FIXTURE.filter((r) => (r.status ?? 'POSTED') === 'POSTED');
    const surfaceFigure = spendingByCategory(asReportTxns(postedOnly), { fromYm: MONTH, toYm: MONTH }).byCategory.find(
      (c) => c.categoryId === CATEGORY,
    )!;
    const { summary } = followHref(categoryMonthRegisterHref(CATEGORY, MONTH, LINKABLE)!, FIXTURE);

    // The reader would click one number and land on a larger one.
    expect(summary.outflowCents - summary.inflowCents).not.toBe(surfaceFigure.amountCents);
    expect(summary.outflowCents - summary.inflowCents).toBe(surfaceFigure.amountCents + 8000); // the pending row
  });

  it('and the surface that IS linked reads the same rows the register does', () => {
    // The contrast that makes the refusal principled rather than arbitrary:
    // /reports applies no status filter, so its figure and the register agree.
    const reportsFigure = spendingByCategory(asReportTxns(FIXTURE), { fromYm: MONTH, toYm: MONTH }).byCategory.find(
      (c) => c.categoryId === CATEGORY,
    )!;
    const { summary } = followHref(categoryMonthRegisterHref(CATEGORY, MONTH, LINKABLE)!, FIXTURE);
    expect(summary.outflowCents - summary.inflowCents).toBe(reportsFigure.amountCents);
  });
});
