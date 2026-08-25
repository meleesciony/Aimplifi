/**
 * Reports data (DECISIONS #67): trailing income/expense series + this month's
 * spending-by-category breakdown, from the shared snapshot.
 *
 * The series length is a READER CHOICE (owner request 2026-08-04: "why are we
 * only pulling 6 months of data? … need a way to view last month, last
 * quarter, last year"): 6 months stays the default, and the same chart can be
 * widened to 12 or 24 months — the vocabulary lives in the engine
 * (engine/reports/chart-range.ts) so the client view's selector and this
 * assembler read the same values without the client importing a server module.
 */
import type { ReportChartMonths } from '@/lib/engine/reports/chart-range';
import { monthlyFlows } from '@/lib/engine/fi/insights';
import {
  spendingByCategory,
  spentSoFarWindow,
  type SpendingBreakdown,
  type SpendWindow,
} from '@/lib/engine/reports/reports';
import {
  buildCategoryBreakdowns,
  notCountedYetByCategory,
  type CategoryBreakdown,
} from '@/lib/engine/glass-box/category-breakdown';
import {
  buildMonthFlowBreakdowns,
  type MonthFlowBreakdown,
} from '@/lib/engine/glass-box/month-flow-breakdown';
import { registerDisplayName } from '@/lib/engine/transactions/display-name';
import {
  loanPaymentBasisFacts,
  loanPaymentRefusedCategories,
  type LoanPaymentBasisFact,
} from '@/server/loan-payment-basis';
import { getProvider } from '@/lib/providers/demo';
import { getCategoryMeta } from '@/server/category-meta';
import { getLinkableCategoryIds } from '@/server/categories';
import { categoryWindowRegisterHref } from '@/lib/engine/transactions/links';
import {
  interestFeeContributions,
  interestFeeYtdWindow,
  interestFeesYtd,
  type InterestFeesYtd,
} from '@/lib/engine/reports/interest-fees-ytd';
import {
  DEFAULT_EXPECTED_RETURN_BPS,
  returnIsAppDefault,
  type DialOwnership,
} from '@/lib/engine/settings/dials';
import { RETIREMENT_ASSUMPTIONS } from '@/lib/engine/investments/retirement';
import { prisma } from '@/lib/db';

export interface ReportsData {
  ym: string;
  /**
   * The window `breakdown` was summed over — this month, stopping at today
   * (C.26, audit P1-28).
   *
   * It is on the payload rather than re-derived in the view because the view
   * builds the register link for every category figure, and the first attempt
   * at this slice shipped a clamped figure pointing at an unclamped register
   * ($120.00 clicked, $520.00 of rows). It is carried rather than re-derived
   * because `categoryHrefs` below is built from it here — the view names no
   * window at all — and because the panels and the page-level disclosure are
   * all selected by this same object.
   */
  window: SpendWindow;
  /**
   * The register link for each category figure, keyed by category id — `null`
   * where the O.5/O.6 fence refuses one.
   *
   * Built HERE, not in the view, and that is C.26 critic cycle 1's P1-1. The
   * view used to call `categoryWindowRegisterHref` itself, and a critic
   * reintroduced the exact defect this slice exists to fix — a clamped figure
   * pointing at a whole-month register, the measured $120.00 → $520.00 — by
   * editing one expression there, with 5964/5964 tests green. This repo has no
   * component-rendering harness, so nothing assembled in a .tsx can be locked;
   * moving the construction to the loader puts it inside the mutation-proven
   * server test AND leaves the view with no window to get wrong.
   */
  categoryHrefs: Record<string, string | null>;
  /**
   * ALL the money this page's window held back — every category, including the
   * ones that vanished from the table because the clamp took everything they
   * had (C.26 critic cycle 1, P1-5).
   *
   * The per-category field on `breakdowns` cannot cover that case by
   * construction: `spendingByCategory` drops a category whose clamped net is
   * ≤ 0, so it never reaches `headlines` and gets no panel. A reader whose only
   * charge this month is dated ahead saw "$0.00 total" and "No spending this
   * month yet" with nothing anywhere naming the money — the emptiest page is
   * exactly where the disclosure was blind. A page-level figure is the one
   * place that survives an empty table.
   */
  notCountedYetCents: number;
  months: { month: string; incomeCents: number; expensesCents: number }[];
  breakdown: SpendingBreakdown;
  /**
   * C.25 (DECISIONS #403): the loan payments these figures do NOT count as
   * spending, and why — one entry per excluded merchant, carrying the loan
   * it is counted on instead. Empty when no merchant qualifies (demo,
   * SimpleFIN-only readers, undatable loans), and the view says nothing:
   * silence is the correct sentence for "nothing moved".
   */
  loanPaymentExclusions: readonly LoanPaymentBasisFact[];
  /**
   * C.25 (#403, critic P1-4): categories whose figure dropped excluded rows.
   * A register link from one of them would land on a total still counting
   * those rows, so the view refuses the link on these (O.5/O.6 invariant).
   */
  loanPaymentRefusedCategories: readonly string[];
  /**
   * The transactions behind each category figure, keyed by category id — one
   * entry for every category in `breakdown.byCategory`.
   *
   * Built from the SAME snapshot array `spendingByCategory` was just handed, so
   * the panel a reader expands cannot show a different set of rows than the bar
   * they expanded it from. Every category is built rather than only the twelve
   * the view prints: each transaction belongs to exactly one category, so the
   * tail costs the tail's own rows and nothing more, and no constant has to stay
   * in step between this file and the component's `slice`.
   */
  breakdowns: Record<string, CategoryBreakdown>;
  /**
   * The transactions behind each BAR of the income-vs-spending chart, keyed
   * `"YYYY-MM:income"` / `"YYYY-MM:expense"` — one entry per bar the chart draws.
   *
   * Built from the same snapshot array `monthlyFlows` was handed, through that
   * engine's own exported predicate, so a bar and the rows under it cannot
   * describe different sets. Deliberately NOT the same basis as `breakdowns`
   * above: this chart is posted-only and nets refunds against spending, which is
   * why it has its own builder and its own disclosure sentence.
   *
   * `{}` when the caller opted out with `{ includeMonthFlows: false }` (O.20b):
   * the ONLY such caller is /dashboard, which reads four fields of this payload
   * and never renders the chart panels — on the heaviest real account these
   * rows measured 282.6 KB of a 316.9 KB payload (89%), so a page that throws
   * them away was shipping six months of dead rows on every load. /reports
   * always takes the default; a trim anywhere else is a visible-feature
   * decision, not a payload one.
   */
  monthFlows: Record<string, MonthFlowBreakdown>;
  /**
   * Interest & fees paid in the calendar year through today (DECISIONS #516).
   * `result` is null when none of the four fee/interest leaves have a
   * positive YTD spend — the view then prints the empty sentence, never
   * a $0.00 "invested" illustration.
   */
  interestFees: {
    result: InterestFeesYtd | null;
    dialOwnership: DialOwnership;
    /** The window the paid figure was summed over — Jan of `today`'s year through today. */
    window: SpendWindow;
  };
}

export async function getReports(
  userId: string,
  months: ReportChartMonths = 6,
  // O.20b: the one assembler stays ONE author for both callers — /reports
  // renders the chart panels (rows needed), /dashboard renders only the
  // TopSpending card (rows never read, measured 89% of its reports payload).
  // A second lean assembler would be a second copy of this composition, which
  // is exactly the drift shape the repo's panels exist to prevent.
  { includeMonthFlows = true }: { includeMonthFlows?: boolean } = {},
): Promise<ReportsData> {
  const provider = getProvider();
  const today = provider.today(userId);
  const ym = today.slice(0, 7);
  // Named `handoverKeys`, not `handoverDates` (U.20 rename): the set holds
  // ACCOUNT-scoped (account, date) keys since U.16's second critic cycle, and a
  // variable that says "dates" invites the next reader to treat it as the
  // unscoped set — the exact confusion that cycle existed to fix.
  const [snap, meta, linkableCategoryIds, userRow] = await Promise.all([
    provider.getFinanceSnapshot(userId),
    getCategoryMeta(userId),
    // The register's own option list — the fence deciding which figures may
    // become links. Fetched here because the links are built here (see
    // `categoryHrefs`); /reports' page no longer fetches it, while /trends and
    // /budgets still call `getLinkableCategoryIds` directly for their own.
    getLinkableCategoryIds(userId),
    prisma.user.findUnique({
      where: { id: userId },
      select: { expectedReturnBps: true, inflationBps: true },
    }),
  ]);
  // U.35: the snapshot already derived these from the same link-table rows it
  // used for the keep. A second `getReconciliationHandoverKeys` here was a
  // later read of the same table — keep from one snapshot, disclosure from
  // another. Handed to both builders so the category panels and the chart's
  // month panels still cannot disagree with each other.
  const handoverKeys = snap.handoverKeys;
  // C.25 (#403): the read-side exclusion, computed ONCE in the assembler.
  // One set for every sum on this page, so the bars, the category table and
  // the rows under each cannot disagree about what counts.
  const excludedFlowIds = snap.loanPaymentFlowExclusions?.excludeIds;

  // C.26 (audit P1-28): this page reports what HAPPENED, so every figure on it
  // stops at today. One filter, applied once, ahead of both engines — the chart
  // and the category table would otherwise answer "this month" over two windows
  // four inches apart, which is the defect being fixed rather than a second
  // copy of it. It can only ever drop future-dated rows: every row in a past
  // month is already on or before today, so the six-month series is unchanged
  // byte for byte for every reader without one.
  //
  // The INCOME half is not optional here. The first attempt at this slice
  // clamped spending and left income alone, so a future-dated paycheck counted
  // in the same chart whose expense bar had just stopped counting a
  // future-dated charge — one bar honest, its neighbour not.
  const happened = snap.transactions.filter((t) => t.date <= today);
  const window = spentSoFarWindow(ym, today);

  const series = monthlyFlows(happened, excludedFlowIds)
    .map((f) => ({ month: f.month, incomeCents: f.incomeCents, expensesCents: f.expensesCents }))
    .sort((a, b) => (a.month < b.month ? -1 : 1))
    .slice(-months);

  const breakdown = spendingByCategory(snap.transactions, window, meta, excludedFlowIds, handoverKeys);
  // Named once and handed to BOTH builders: two panels that disagree about a
  // payee's name on the same page would be a defect nobody could explain, and
  // building the array twice is what would let them.
  const named = snap.transactions.map((t) => ({
    ...t,
    // The register's own display rule, shared with it by construction, so one
    // charge reads the same in the panel and in the list it links to.
    merchantName: registerDisplayName(t),
  }));
  const breakdowns = buildCategoryBreakdowns(
    // Deliberately the UNCLAMPED array with a CLAMPED window: the window
    // decides which rows the panel lists (the figure's own rows), and the rows
    // it can see beyond `asOf` are what let it total the money not counted yet.
    // Handing it a pre-filtered array would make that sentence unwritable.
    named,
    window,
    new Map(breakdown.byCategory.map((c) => [c.categoryId, c.amountCents])),
    meta,
    excludedFlowIds,
    handoverKeys,
  );
  // `series` is the array the chart renders, so the headlines here are the
  // figures the reader will actually see — `reconciles` is checked against the
  // painted number, not against a second derivation of it.
  // The bars were summed over `happened`, so their panels stop at the same day
  // — passed as `asOf` rather than pre-filtered, because a panel handed a
  // filtered array cannot tell an empty bar from one whose money is dated
  // ahead, and it printed the wrong sentence for both (critic cycle 1, P1-3/4).
  // O.20b: `series` still ships as `months` (tiny — six headline objects), so
  // the opt-out skips only the ROW assembly, which is the whole measured cost.
  const monthFlows = includeMonthFlows
    ? buildMonthFlowBreakdowns(named, series, excludedFlowIds, today, handoverKeys)
    : {};
  // One href per category figure, from the window that figure was summed over.
  const linkable = new Set(linkableCategoryIds);
  const refused = new Set(loanPaymentRefusedCategories(snap));
  const categoryHrefs: Record<string, string | null> = {};
  for (const c of breakdown.byCategory) {
    categoryHrefs[c.categoryId] = categoryWindowRegisterHref(
      { categoryId: c.categoryId, window, amountCents: c.amountCents },
      linkable,
      refused,
    );
  }
  // The SAME computation the per-category panels carry, totalled by the module
  // that owns it. Never a subtraction of two clamped aggregates: critic cycle 2
  // (F1) executed that version cancelling to $0.00 — page silent — while the
  // panel directly beneath it disclosed $400.00, because `spendingByCategory`
  // floors each category at zero independently in each window.
  const notCountedYetCents = notCountedYetByCategory(named, window, meta, excludedFlowIds).totalCents;
  // C.25 (#403) disclosure facts, named by the one shared helper so every
  // surface phrases the exclusion the same way.
  const expectedReturnBps = userRow?.expectedReturnBps ?? DEFAULT_EXPECTED_RETURN_BPS;
  const inflationBps = userRow?.inflationBps ?? RETIREMENT_ASSUMPTIONS.inflationBps;
  const ytdWindow = interestFeeYtdWindow(today);
  const ytdPaid = interestFeeContributions(
    spendingByCategory(snap.transactions, ytdWindow, meta, excludedFlowIds, handoverKeys),
  );
  return {
    ym,
    window,
    categoryHrefs,
    notCountedYetCents,
    months: series,
    breakdown,
    breakdowns,
    monthFlows,
    loanPaymentExclusions: loanPaymentBasisFacts(snap),
    loanPaymentRefusedCategories: loanPaymentRefusedCategories(snap),
    interestFees: {
      result: interestFeesYtd({
        paidYtdCents: ytdPaid.paidYtdCents,
        year: Number(today.slice(0, 4)),
        contributingCategoryIds: ytdPaid.contributingCategoryIds,
        nominalReturnBps: expectedReturnBps,
        inflationBps,
      }),
      dialOwnership: {
        returnIsDefault: returnIsAppDefault(expectedReturnBps),
        inflationIsDefault: userRow?.inflationBps == null,
      },
      window: ytdWindow,
    },
  };
}
