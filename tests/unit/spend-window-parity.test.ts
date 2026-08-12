/**
 * C.26 (audit P1-28) — "spent this month" is ONE window, and the register link
 * follows the figure.
 *
 * This file exists because the first attempt at this slice shipped verify-green
 * with nothing testing either production surface. A fresh-context critic proved
 * it by mutation: deleting the clamp from `server/reports.ts` left 59 tests
 * green, and deleting it from all three `server/assistant.ts` intents left 45
 * green — because the parity test re-derived the call-site expression instead of
 * calling `getReports`/`askAssistant`, and the two tests that DO call
 * `getReports` run against a demo seed with no future-dated row. A lock that
 * cannot fail is a hypothesis (`a-fix-that-cannot-fail-a-test-is-a-hypothesis`).
 *
 * So: the REAL loaders, on a throwaway user carrying a future-dated row, with a
 * CONTROL in each half that executes the old behaviour and shows the number the
 * reader would have been given.
 *
 * The shape is the owner-facing one the audit measured: a $120.00 figure whose
 * link landed on $520.00 of rows.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn(), signOut: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { getReports } from '@/server/reports';
import { askAssistant } from '@/server/assistant';
import { categoryWindowRegisterHref } from '@/lib/engine/transactions/links';
import {
  asOfWindow,
  isSpendRow,
  spendingByCategory,
  wholeMonthWindow,
} from '@/lib/engine/reports/reports';
import {
  BREAKDOWN_BASIS,
  categoryPanelBasis,
  notCountedYetByCategory,
  reportsNotCountedYetCopy,
  windowLabelSoFar,
} from '@/lib/engine/glass-box/category-breakdown';
import {
  buildMonthFlowBreakdowns,
  monthFlowEmptyCopy,
  monthFlowNetRefundCopy,
  monthFlowPanelBasis,
} from '@/lib/engine/glass-box/month-flow-breakdown';
import { cents, formatCents } from '@/lib/money';
import { filterTransactions, summarizeTransactions } from '@/lib/engine/transactions/query';

const TODAY = '2026-06-10';
const MONTH = '2026-06';
const LINKABLE = new Set(['groceries']);

const stamp = `${Date.now()}-${process.pid}`;
const USER = `c26-window-${stamp}`;

/** Rows: $120.00 already spent, $400.00 dated ten days ahead, and the income
 *  twin of the same split ($500 received, $900 dated ahead). */
const SPENT_SO_FAR = 12_000;
const DATED_AHEAD = 40_000;
const WHOLE_MONTH_SPEND = SPENT_SO_FAR + DATED_AHEAD; // 52000 — the $520.00
const INCOME_SO_FAR = 50_000;
const INCOME_AHEAD = 90_000;

let accountId = '';
let priorDemoToday: string | undefined;

/** The register, driven exactly as `transactions/page.tsx` drives it from an
 *  href's own params — no re-derivation of the window under test. */
function followHref(href: string, rows: readonly TxnRow[]) {
  const params = new URLSearchParams(href.split('?')[1]);
  const landed = filterTransactions(rows, {
    categoryId: params.get('category'),
    from: params.get('from'),
    to: params.get('to'),
  });
  return { rows: landed, summary: summarizeTransactions(landed) };
}

type TxnRow = Parameters<typeof filterTransactions>[0][number];

async function registerRows(): Promise<TxnRow[]> {
  const rows = await prisma.transaction.findMany({ where: { accountId }, orderBy: { date: 'asc' } });
  return rows.map((r) => ({
    id: r.id,
    date: r.date,
    amountCents: r.amountCents,
    categoryId: r.categoryId,
    rawDescriptor: r.rawDescriptor,
    accountId: r.accountId,
    status: r.status,
    isTransfer: r.isTransfer,
    isSplitParent: r.isSplitParent,
    excludeFromTotals: r.excludeFromTotals,
  })) as unknown as TxnRow[];
}

beforeAll(async () => {
  priorDemoToday = process.env.DEMO_TODAY;
  process.env.DEMO_TODAY = TODAY;
  for (const c of [
    { id: 'groceries', name: 'Groceries' },
    { id: 'paycheck', name: 'Paycheck' },
  ]) {
    await prisma.category.upsert({
      where: { id: c.id },
      update: {},
      create: { id: c.id, name: c.name, isSystem: true },
    });
  }
  await prisma.user.deleteMany({ where: { id: USER } });
  await prisma.user.create({ data: { id: USER, email: `${USER}@test.local` } });
  const acct = await prisma.account.create({
    data: { userId: USER, provider: 'demo', name: 'Checking', type: 'CHECKING', currentBalanceCents: 500_000 },
  });
  accountId = acct.id;
  for (const t of [
    { date: '2026-06-04', amountCents: -SPENT_SO_FAR, categoryId: 'groceries', rawDescriptor: 'KROGER #529' },
    // The whole point: dated after TODAY, inside the same calendar month.
    { date: '2026-06-20', amountCents: -DATED_AHEAD, categoryId: 'groceries', rawDescriptor: 'KROGER #529' },
    { date: '2026-06-02', amountCents: INCOME_SO_FAR, categoryId: 'paycheck', rawDescriptor: 'ACME PAYROLL' },
    { date: '2026-06-26', amountCents: INCOME_AHEAD, categoryId: 'paycheck', rawDescriptor: 'ACME PAYROLL' },
  ]) {
    await prisma.transaction.create({
      data: { accountId, status: 'POSTED', isTransfer: false, needsReview: false, ...t },
    });
  }
}, 60_000);

afterAll(async () => {
  await prisma.transaction.deleteMany({ where: { accountId } });
  await prisma.account.deleteMany({ where: { userId: USER } });
  await prisma.user.deleteMany({ where: { id: USER } });
  if (priorDemoToday === undefined) delete process.env.DEMO_TODAY;
  else process.env.DEMO_TODAY = priorDemoToday;
});

describe('C.26 — getReports (the real loader) stops at today', () => {
  it('the category figure and the page total count only money already spent', async () => {
    const reports = await getReports(USER);
    expect(reports.ym).toBe(MONTH);
    expect(reports.window.asOf).toBe(TODAY);
    const groceries = reports.breakdown.byCategory.find((c) => c.categoryId === 'groceries');
    expect(groceries?.amountCents).toBe(SPENT_SO_FAR);
    expect(reports.breakdown.totalCents).toBe(SPENT_SO_FAR);
  });

  it('CONTROL: the same rows over the whole month are the $520.00 the reader used to see', async () => {
    // Executes the pre-C.26 behaviour so the assertion above cannot pass
    // vacuously on a fixture that never had a future-dated row.
    const rows = await registerRows();
    const whole = rows
      .filter((r) => r.categoryId === 'groceries' && r.date.startsWith(MONTH))
      .reduce((s, r) => s + -r.amountCents, 0);
    expect(whole).toBe(WHOLE_MONTH_SPEND);
    expect(whole).not.toBe(SPENT_SO_FAR);
  });

  it('income stops at today too — one window for both bars of the chart', async () => {
    const reports = await getReports(USER);
    const june = reports.months.find((m) => m.month === MONTH);
    expect(june?.incomeCents).toBe(INCOME_SO_FAR);
    expect(june?.expensesCents).toBe(SPENT_SO_FAR);
  });

  it('the expandable panel lists the figure’s own rows and names the money held back', async () => {
    const reports = await getReports(USER);
    const panel = reports.breakdowns['groceries'];
    expect(panel.rows).toHaveLength(1);
    expect(panel.rows[0].date).toBe('2026-06-04');
    expect(panel.sumCents).toBe(SPENT_SO_FAR);
    expect(panel.reconciles).toBe(true);
    expect(panel.notCountedYetCents).toBe(DATED_AHEAD);
  });
});

describe('C.26 — the register link follows the figure (the O.5 invariant)', () => {
  it('the destination nets to exactly the figure that was clicked', async () => {
    // The href the PAGE will render — read off the loader's payload, not rebuilt
    // here. Critic cycle 1 (P1-1) reintroduced the defect by editing the view's
    // own call to the builder while a test that rebuilt the href stayed green;
    // `getReports` owns the construction now, so this asserts the production
    // value.
    const reports = await getReports(USER);
    const clicked = reports.breakdown.byCategory.find((c) => c.categoryId === 'groceries')!;
    const href = reports.categoryHrefs['groceries']!;
    expect(href).toContain('to=2026-06-10'); // today, not the month end
    const { summary } = followHref(href, await registerRows());
    expect(summary.outflowCents - summary.inflowCents).toBe(clicked.amountCents);
  });

  it('CONTROL: the whole-month window lands on $520.00 — wrong for /reports, RIGHT for /budgets', async () => {
    // Two facts in one execution.
    //
    // The measured critic finding: a clamped figure pointing at an unclamped
    // register. If a future edit re-derives the link's window from the month
    // key, $520.00 is the number a reader clicking $120.00 would be shown.
    //
    // And the deliberate divergence (DECISIONS #410): /budgets keeps this
    // window on purpose — a charge dated for the 20th has already consumed the
    // allowance — so on that page the figure IS $520.00 and this link is the
    // correct one. Each page equals its own register; that is the invariant,
    // not that the two pages equal each other.
    const reports = await getReports(USER);
    const clicked = reports.breakdown.byCategory.find((c) => c.categoryId === 'groceries')!;
    const stale = categoryWindowRegisterHref(
      { categoryId: 'groceries', window: wholeMonthWindow(MONTH), amountCents: clicked.amountCents },
      LINKABLE,
    )!;
    expect(stale).toContain('to=2026-06-30');
    const { summary } = followHref(stale, await registerRows());
    expect(summary.outflowCents - summary.inflowCents).toBe(WHOLE_MONTH_SPEND);
    expect(summary.outflowCents - summary.inflowCents).not.toBe(clicked.amountCents);
  });
});

describe('C.26 — Ask answers the same window as /reports', () => {
  const asUser = () => vi.mocked(auth).mockResolvedValue({ user: { id: USER } } as never);

  it('spend_total', async () => {
    asUser();
    const a = await askAssistant('how much did I spend this month');
    expect(a.kind).toBe('spend_total');
    expect(a.headlineCents).toBe(SPENT_SO_FAR);
  });

  it('spend_by_category', async () => {
    asUser();
    const a = await askAssistant('how much did I spend on groceries this month');
    expect(a.kind).toBe('spend_by_category');
    expect(a.headlineCents).toBe(SPENT_SO_FAR);
  });

  it('top_categories', async () => {
    asUser();
    const a = await askAssistant('what are my top spending categories this month');
    expect(a.kind).toBe('top_categories');
    expect(a.headlineCents).toBe(SPENT_SO_FAR);
  });

  it('income', async () => {
    asUser();
    const a = await askAssistant('how much did I make this month');
    expect(a.kind).toBe('income');
    expect(a.headlineCents).toBe(INCOME_SO_FAR);
  });

  it('the trace cites the rows the answer summed, and reconciles', async () => {
    asUser();
    const a = await askAssistant('how much did I spend on groceries this month');
    expect(a.trace?.kind).toBe('row_sum');
    if (a.trace?.kind === 'row_sum') {
      expect(a.trace.reconciled).toBe(true);
      expect(a.trace.rows).toHaveLength(1);
      expect(a.trace.rows[0].date).toBe('2026-06-04');
      expect(a.trace.sumCents).toBe(SPENT_SO_FAR);
    }
  });

  it('Ask and /reports agree — the split the audit reported is gone', async () => {
    asUser();
    const [ask, reports] = await Promise.all([askAssistant('how much did I spend this month'), getReports(USER)]);
    expect(ask.headlineCents).toBe(reports.breakdown.totalCents);
  });
});

describe('C.26 critic cycle 1 — the disclosures a reader actually meets', () => {
  it('P1-5: the money is named at PAGE level, which is the only level that survives an empty table', async () => {
    const reports = await getReports(USER);
    expect(reports.notCountedYetCents).toBe(DATED_AHEAD);
    const sentence = reportsNotCountedYetCopy(formatCents(cents(reports.notCountedYetCents)));
    expect(sentence).toContain('$400.00');
    expect(sentence).toContain('activity list');
  });

  it('P1-2: the panel basis is composed by the ENGINE, and carries the clause only when money was held back', async () => {
    const reports = await getReports(USER);
    const held = categoryPanelBasis(reports.breakdowns['groceries']);
    expect(held[0]).toBe(BREAKDOWN_BASIS);
    expect(held.some((b) => b.includes('$400.00'))).toBe(true);
    // CONTROL: nothing dated ahead → no clause, byte-identical to pre-C.26.
    expect(categoryPanelBasis({ notCountedYetCents: cents(0), countedOnHandoverDays: 0, reconciles: true, rows: [] })).toEqual([BREAKDOWN_BASIS]);
  });

  it('P1-3/P1-4: the chart panel carries the clamp, and its label says "so far"', async () => {
    const reports = await getReports(USER);
    const expense = reports.monthFlows[`${MONTH}:expense`];
    const income = reports.monthFlows[`${MONTH}:income`];
    expect(expense.notCountedYetCents).toBe(DATED_AHEAD);
    expect(income.notCountedYetCents).toBe(INCOME_AHEAD);
    // The rows the bar opens are the rows the bar drew — the clamp is inside
    // the builder, so `reconciles` stays true on a correct bar.
    expect(expense.reconciles).toBe(true);
    expect(expense.clampedByNetRefund).toBe(false);
    expect(monthFlowPanelBasis(expense).some((b) => b.includes('$400.00'))).toBe(true);
    expect(monthFlowPanelBasis(income).some((b) => b.includes('$900.00'))).toBe(true);
    expect(windowLabelSoFar('June 2026', expense.notCountedYetCents)).toBe('June 2026 so far');
    expect(windowLabelSoFar('June 2026', 0)).toBe('June 2026');
  });

  it('P1-6: Ask names the date rule in the basis it presents as complete', async () => {
    vi.mocked(auth).mockResolvedValue({ user: { id: USER } } as never);
    const spend = await askAssistant('how much did I spend this month');
    const income = await askAssistant('how much did I make this month');
    expect(spend.detail).toContain("dated after today isn't counted yet");
    expect(income.detail).toContain("dated after today isn't counted yet");
  });

  it('P2-2: a malformed asOf throws at every entry point, never reports $0.00', () => {
    const row = { id: 'x', date: '2026-06-04', amountCents: -1000, categoryId: 'groceries' };
    // The silent path the critic executed: '06/10/2026' sorts above every ISO
    // date, so every row used to vanish and the surface printed $0.00.
    expect(() => isSpendRow(row, { fromYm: MONTH, toYm: MONTH, asOf: '06/10/2026' })).toThrow();
    expect(() => spendingByCategory([row], { fromYm: MONTH, toYm: MONTH, asOf: 'tomorrow' })).toThrow();
    expect(() => asOfWindow({ fromYm: MONTH, toYm: MONTH }, 'not-a-date')).toThrow();
  });
});

describe("C.26 critic cycle 1 P1-3 — the clamp never blames the reader's refunds", () => {
  // The critic's exact fixture, on the pure builder: today 2026-06-10, a $30.00
  // refund posted on the 5th, and the $400.00 purchase it refunds dated the
  // 20th. `monthlyFlows` floors the bar at $0.00, so the panel reaches for its
  // net-refund sentence — which named the whole month and told the reader their
  // returns had outrun their purchases, over $400.00 of June purchases.
  const rows = [
    { id: 'r1', date: '2026-06-05', amountCents: 3_000, categoryId: 'shopping', rawDescriptor: 'AMZN RETURN', status: 'POSTED', isTransfer: false, accountId: 'a1' },
    { id: 'r2', date: '2026-06-20', amountCents: -40_000, categoryId: 'shopping', rawDescriptor: 'AMZN Mktp', status: 'POSTED', isTransfer: false, accountId: 'a1' },
  ];
  const headlines = [{ month: MONTH, incomeCents: 0, expensesCents: 0 }];

  it('the sentence it prints is true, because the label and the basis both carry the clamp', () => {
    const out = buildMonthFlowBreakdowns(rows, headlines, undefined, TODAY)[`${MONTH}:expense`];
    expect(out.clampedByNetRefund).toBe(true); // among the rows counted so far, it IS a net refund
    expect(out.notCountedYetCents).toBe(40_000);
    // …so the window it names is "so far", not the month, and the $400.00 is on
    // screen beside it instead of being silently attributed to returns.
    const label = windowLabelSoFar('June 2026', out.notCountedYetCents);
    expect(label).toBe('June 2026 so far');
    expect(monthFlowNetRefundCopy(out.sumCents, label)).toContain('Returns in June 2026 so far');
    expect(monthFlowPanelBasis(out).some((b) => b.includes('$400.00'))).toBe(true);
  });

  it('CONTROL: unclamped, the same rows are an ordinary reconciling bar — the sentence never fires', () => {
    const unclamped = buildMonthFlowBreakdowns(rows, [{ month: MONTH, incomeCents: 0, expensesCents: 37_000 }]);
    const bar = unclamped[`${MONTH}:expense`];
    expect(bar.reconciles).toBe(true);
    expect(bar.clampedByNetRefund).toBe(false);
    expect(bar.notCountedYetCents).toBe(0);
    expect(monthFlowPanelBasis(bar)).toHaveLength(1);
  });

  it('an empty bar whose money is all dated ahead does not claim there was no spending', () => {
    const out = buildMonthFlowBreakdowns([rows[1]], headlines, undefined, TODAY)[`${MONTH}:expense`];
    expect(out.rows).toHaveLength(0);
    expect(out.notCountedYetCents).toBe(40_000);
    // "No posted spending in June 2026" was false — there is $400.00 of it.
    expect(monthFlowEmptyCopy('expense', windowLabelSoFar('June 2026', out.notCountedYetCents))).toContain(
      'June 2026 so far',
    );
  });
});

describe('C.26 critic cycle 2, F1 — the page figure and its panels are one computation', () => {
  // The critic's fixture: groceries $120 spent + $400 dated ahead; dining $400
  // spent + a $1,300 refund dated ahead. Under the old `wholeMonthSum −
  // clampedSum`, dining's later-dated refund floored to zero in one window and
  // not the other, the two cancelled exactly, the page fell silent, and the
  // groceries panel beneath it still disclosed $400.00.
  const rows = [
    { id: 'g1', date: '2026-06-04', amountCents: -12_000, categoryId: 'groceries' },
    { id: 'g2', date: '2026-06-20', amountCents: -40_000, categoryId: 'groceries' },
    { id: 'd1', date: '2026-06-03', amountCents: -40_000, categoryId: 'dining' },
    { id: 'd2', date: '2026-06-25', amountCents: 130_000, categoryId: 'dining' },
  ];
  const window = { fromYm: MONTH, toYm: MONTH, asOf: TODAY };

  it('the page total is the money actually held back, and the page cannot fall silent', () => {
    const held = notCountedYetByCategory(rows, window);
    expect(held.totalCents).toBe(40_000); // NOT 0, which the subtraction produced
    expect(held.byCategory.get('groceries')).toBe(40_000);
    expect(held.byCategory.get('dining')).toBe(0); // a later-dated refund is not money waiting
  });

  it('CONTROL: the subtraction the page used to do cancels to zero on these rows', () => {
    const whole = spendingByCategory(rows, wholeMonthWindow(MONTH)).totalCents;
    const clamped = spendingByCategory(rows, window).totalCents;
    expect(Math.max(0, whole - clamped)).toBe(0);
  });

  it('a category the clamp empties entirely still reaches the page total', () => {
    // It is dropped from `byCategory` (nothing left to print) and therefore has
    // no panel — the reason the page-level figure exists at all.
    const onlyFuture = [{ id: 'x', date: '2026-06-20', amountCents: -40_000, categoryId: 'dining' }];
    expect(spendingByCategory(onlyFuture, window).byCategory).toHaveLength(0);
    expect(notCountedYetByCategory(onlyFuture, window).totalCents).toBe(40_000);
  });
});

describe('O.20b — the dashboard opt-out (includeMonthFlows: false) trims only the chart rows', () => {
  // Measured against production (scripts/audit-probes/o20b-reports-payload.mts):
  // monthFlows is 89% of the getReports payload on the heaviest account (282.6 KB
  // of 316.9 KB at the 6-month default), and /dashboard — the only caller that
  // never renders the chart panels — reads exactly four fields of it. The opt-out
  // must change NOTHING the dashboard renders; that is the anti-drift half of
  // this lock. It binds by mutation: deleting the opt-out from server/reports.ts
  // (always computing the rows) fails the `toEqual({})` assertion below.
  it('the opt-out drops monthFlows and nothing the dashboard reads', async () => {
    const full = await getReports(USER);
    const lean = await getReports(USER, 6, { includeMonthFlows: false });
    expect(Object.keys(full.monthFlows).length).toBeGreaterThan(0);
    expect(lean.monthFlows).toEqual({});
    expect(lean.ym).toBe(full.ym);
    expect(lean.window).toEqual(full.window);
    expect(lean.breakdown).toEqual(full.breakdown);
    expect(lean.breakdowns).toEqual(full.breakdowns);
    expect(lean.notCountedYetCents).toBe(full.notCountedYetCents);
  });

  it('the default payload still ships the rows /reports renders', async () => {
    const full = await getReports(USER);
    // The fixture's June expense bar has exactly one counted row: the $120.00
    // dated 06-04; its $400.00 dated 06-20 is the bar's notCountedYet money.
    expect(full.monthFlows['2026-06:expense']?.rows).toHaveLength(1);
  });
});
