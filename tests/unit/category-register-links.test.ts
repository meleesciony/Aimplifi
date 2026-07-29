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
import { netSpendByCategory } from '@/lib/engine/budgets/status';
import { filterTransactions, summarizeTransactions, type TxnView } from '@/lib/engine/transactions/query';

/**
 * A non-zero figure, for the tests whose subject is the fence rather than the
 * amount. O.6 made `amountCents` required (a link is a claim ABOUT a figure), so
 * every call needs one; naming it once keeps the refusal tests about refusal.
 */
const SOME = 12345;
const hrefFor = (categoryId: string, amountCents = SOME, month = '2026-06', linkable = LINKABLE) =>
  categoryMonthRegisterHref({ categoryId, month, amountCents }, linkable);

describe('categoryRegisterHref (O.5 — the link itself)', () => {
  it('names the three params the register reads', () => {
    expect(
      categoryRegisterHref({ categoryId: 'groceries', from: '2026-06-01', to: '2026-06-30', amountCents: SOME }, LINKABLE),
    ).toBe('/transactions?category=groceries&from=2026-06-01&to=2026-06-30');
  });

  it('derives a whole calendar month, including a 31-day one', () => {
    expect(hrefFor('groceries')).toBe('/transactions?category=groceries&from=2026-06-01&to=2026-06-30');
    expect(hrefFor('travel', SOME, '2026-07')).toBe('/transactions?category=travel&from=2026-07-01&to=2026-07-31');
  });

  it('survives a custom category id with URL-hostile characters', () => {
    // Custom categories carry generated ids; the id must arrive on the far side
    // verbatim or it matches nothing and the reader sees an empty register.
    const href = hrefFor('cat/with space&amp')!;
    const got = new URLSearchParams(href.split('?')[1]).get('category');
    expect(got).toBe('cat/with space&amp');
  });

  it('REFUSES a category the reader has HIDDEN, which /reports still prints (critic F-3)', () => {
    // Hiding governs pickers, not what you spent: `getReports` applies no
    // visibility filter, so a hidden category keeps rendering a figure here while
    // `getVisibleGroups` drops it from the register's control. Same hole as
    // `uncategorized`, reached by a completely different route — which is why the
    // fence asks the destination's option list instead of naming one id.
    expect(hrefFor('coffee')).toBeNull();
    // ...and it links again the moment the reader unhides it.
    expect(hrefFor('coffee', SOME, '2026-06', new Set([...LINKABLE, 'coffee']))).not.toBeNull();
  });

  it('REFUSES the uncategorized bucket, which the register filters but cannot display', () => {
    // The rows would be filtered correctly (getTransactions maps null →
    // 'uncategorized' before filtering), but the register's category <select>
    // omits the placeholder, so the control would read "All categories" over a
    // filtered list and the next filter change would drop it. Refusing in the
    // BUILDER means no present or future surface can reintroduce that link.
    expect(hrefFor('uncategorized')).toBeNull();
    expect(
      categoryRegisterHref(
        { categoryId: 'uncategorized', from: '2026-06-01', to: '2026-06-30', amountCents: SOME },
        LINKABLE,
      ),
    ).toBeNull();
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
  // The pending row. It counts on BOTH sides on every category surface — O.6 made
  // that true of /trends and /budgets too, and the suite at the bottom of this
  // file is what holds them there. This row is the whole reason that suite can
  // fail: strip it and every basis agrees vacuously.
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
      // Every row here carries a real category and none is flagged, so the O.2
      // unclassified filter is a no-op over this fixture — which is what these
      // reconciliation assertions want: the link's arithmetic must agree with the
      // register's UNFILTERED totals.
      needsReview: false,
      provenance: { kind: 'merchant-default', label: 'Known merchant', needsConfirm: false },
      suggestion: null,
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
    const { rows, summary } = followHref(hrefFor(CATEGORY, clicked!.amountCents)!, FIXTURE);
    expect(summary.inflowCents).toBeGreaterThan(0); // a refund is present...
    expect(summary.outflowCents).not.toBe(clicked!.amountCents); // ...so outflow alone is WRONG
    expect(rows.some((r) => r.status === 'PENDING')).toBe(true);
    expect(rows.some((r) => r.isTransfer)).toBe(true);
    expect(rows.map((r) => r.id)).toContain('r8'); // first day of the month
    expect(rows.map((r) => r.id)).toContain('r9'); // last day of the month
  });

  it('the landing page nets to exactly the source figure', () => {
    const { summary } = followHref(hrefFor(CATEGORY, clicked!.amountCents)!, FIXTURE);
    // Hand-verified: 120.00 + 80.00 − 30.00 (refund) + 10.00 + 25.00 = 205.00.
    expect(clicked!.amountCents).toBe(20500);
    // Spending is money out net of money back — the register's Net tile, signed.
    expect(summary.outflowCents - summary.inflowCents).toBe(clicked!.amountCents);
    expect(summary.netCents).toBe(-clicked!.amountCents);
  });

  it('excludes the neighbouring months, not merely "most" of them', () => {
    const { rows } = followHref(hrefFor(CATEGORY, clicked!.amountCents)!, FIXTURE);
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
    const { summary } = followHref(hrefFor(CATEGORY, source.amountCents)!, simple);
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
 * O.6 — the basis divergence is CLOSED, and this is where that is executed.
 *
 * This block used to assert the opposite: that a POSTED-only intake reports less
 * than the register, which is why O.5 linked /reports and refused /trends and
 * /budgets. O.6 removed both narrowings at source (`src/server/trends.ts` no
 * longer filters `status`, `src/app/(app)/budgets/page.tsx` no longer queries
 * `status: 'POSTED'` and now restricts to SPENDING_ACCOUNT_TYPES), so the same
 * fixture must now show all three surfaces agreeing. The tests were FLIPPED
 * deliberately rather than deleted: the pending row is still in the fixture and
 * still worth exactly $80, so if anyone reintroduces a status filter on any of
 * these intakes, the equality below breaks and names the amount.
 */
describe('O.6 — one basis: every category surface agrees with the register', () => {
  const clicked = spendingByCategory(asReportTxns(FIXTURE), { fromYm: MONTH, toYm: MONTH }).byCategory.find(
    (c) => c.categoryId === CATEGORY,
  );

  /** What the register shows at the linked URL, as a signed spend figure. */
  const landedSpend = (rows: Row[] = FIXTURE) => {
    const { summary } = followHref(hrefFor(CATEGORY, clicked!.amountCents)!, rows);
    return summary.outflowCents - summary.inflowCents;
  };

  it('the fixture still contains the pending row this rule is about (anti-vacuity)', () => {
    // Without this, every equality below could pass on a fixture with nothing
    // pending in it — green for the wrong reason, which is the exact failure the
    // O.5 critic caught in the /trends link.
    const pending = FIXTURE.filter((r) => r.status === 'PENDING' && r.categoryId === CATEGORY);
    expect(pending).toHaveLength(1);
    expect(pending[0].amountCents).toBe(-8000);
  });

  it('a POSTED-only intake is the thing that DISAGREES — the mutation this locks', () => {
    // Fail-old guard. This is the pre-O.6 behaviour of /trends and /budgets,
    // reconstructed here so the fix cannot silently regress: filtering status
    // makes the surface figure $80 smaller than the page it links to.
    const postedOnly = FIXTURE.filter((r) => (r.status ?? 'POSTED') === 'POSTED');
    const narrowed = spendingByCategory(asReportTxns(postedOnly), { fromYm: MONTH, toYm: MONTH }).byCategory.find(
      (c) => c.categoryId === CATEGORY,
    )!;
    expect(narrowed.amountCents).toBe(clicked!.amountCents - 8000);
    expect(landedSpend()).not.toBe(narrowed.amountCents);
  });

  it('/reports, /trends and /budgets now sum the SAME figure as the register', () => {
    // The three surfaces reach the number by two different engines — /reports and
    // /trends via `spendingByCategory`, /budgets via `netSpendByCategory` — so
    // this asserts the BASIS agrees, not that one function was called twice.
    const reportsAndTrends = spendingByCategory(asReportTxns(FIXTURE), { fromYm: MONTH, toYm: MONTH }).byCategory.find(
      (c) => c.categoryId === CATEGORY,
    )!.amountCents;

    // /budgets: its Prisma query excludes transfers and split parents server-side
    // (and, as of O.6, nothing else), then nets by category.
    const budgetsFigure = netSpendByCategory(
      FIXTURE.filter((r) => !r.isTransfer && !r.isSplitParent && r.date.startsWith(MONTH)).map((r) => ({
        categoryId: r.categoryId,
        amountCents: r.amountCents,
      })),
    ).get(CATEGORY);

    expect(reportsAndTrends).toBe(20500);
    expect(budgetsFigure).toBe(20500);
    expect(landedSpend()).toBe(20500);
  });

  it('a ZERO figure still links, because the link is how a reader CHECKS a zero', () => {
    // This shipped the other way for one critic cycle and was wrong twice over.
    // The L.29 argument for refusing — a true zero and a defect-produced zero look
    // identical — actually argues for linking: the register is the source of
    // truth the figure derives from, so following the link is how the two get
    // compared, and a surface reading $0.00 over a register holding $300 of rows
    // is a defect the reader has just FOUND. Refusing hid it.
    //
    // The concrete cost was on /trends: a mover is on the page BECAUSE it moved,
    // sorts first by absolute delta, and a category that fell to nothing was
    // rendered dead beside four live rows.
    expect(categoryMonthRegisterHref({ categoryId: CATEGORY, month: MONTH, amountCents: 0 }, LINKABLE)).toBe(
      '/transactions?category=groceries&from=2026-06-01&to=2026-06-30',
    );
    // The FENCE is unchanged and still the only refusal — a zero in a category the
    // register's control cannot display is still refused, for the original reason.
    expect(categoryMonthRegisterHref({ categoryId: 'coffee', month: MONTH, amountCents: 0 }, LINKABLE)).toBeNull();
  });
});
