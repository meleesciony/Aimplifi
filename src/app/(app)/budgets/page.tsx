import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { EmptyDashboard } from '@/components/onboarding/empty-dashboard';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { CATEGORIES, CATEGORY_BY_ID, categoryName, mergeCategoryMeta } from '@/lib/engine/categorize/categories';
import { isSpendRow, wholeMonthWindow } from '@/lib/engine/reports/reports';
import { isBudgetable, netSpendByCategory, summarizeBudgets } from '@/lib/engine/budgets/status';
import { parseStoredDials } from '@/lib/engine/settings/dials';
import { cents, formatCents } from '@/lib/money';
import { formatMonth } from '@/lib/dates';
import { getProvider } from '@/lib/providers/demo';
import { prisma } from '@/lib/db';
import { BudgetTargetForm } from '@/components/finance/budget-target-form';
import { ClearBudgetButton } from '@/components/finance/clear-budget-button';
import { getCategoryOverlay } from '@/server/category-meta';
import {
  loanPaymentBasisFacts,
  loanPaymentBasisSentence,
  loanPaymentRefusedCategories,
} from '@/server/loan-payment-basis';
import { getRecurringBillMerchantCanonicals } from '@/server/recurring-bill-merchants';
import { getHiddenCategoryIds, getLinkableCategoryIds } from '@/server/categories';
import {
  CATEGORY_LINK_CLASS,
  CATEGORY_NAME_LINK_CLASS,
  categoryWindowRegisterHref,
} from '@/lib/engine/transactions/links';
import { SPENDING_ACCOUNT_TYPES } from '@/lib/engine/transactions/query';
import { getReconciliationTxnKeep } from '@/server/reconciliation';
import { getSpendingPlan } from '@/server/spending-plan';
import {
  spendClassLoanPaymentNote,
  summarizeSpendClassCategories,
} from '@/lib/engine/spending-plan/spend-class';
import { resolveFixedCategoryAmounts } from '@/lib/engine/spending-plan/fixed-category-amounts';
import { ConsciousBucketsStrip } from '@/components/finance/conscious-buckets-strip';
import { BudgetingCompositionCard } from '@/components/finance/budgeting-composition-card';
import { SpendClassPanel } from '@/components/finance/spend-class-panel';
import { PlanFiguresForm } from '@/components/finance/plan-figures-form';
import { buildCategoryBreakdowns } from '@/lib/engine/glass-box/category-breakdown';
import { CategoryBreakdownPanel } from '@/components/finance/category-breakdown-panel';
import { registerDisplayName } from '@/lib/engine/transactions/display-name';
import { isDemoUser } from '@/lib/demo-user';
import { isoDate } from '@/lib/dates';

const SYSTEM_BUDGETABLE = CATEGORIES.filter((c) => isBudgetable(c.id));

/**
 * Budgets (Phase 4 + ROADMAP #7) — conscious-spending style: actuals by category
 * for the current month against optional, user-set monthly targets. The status
 * math lives in src/lib/engine/budgets/status.ts; this page only renders it and
 * posts target edits. No guilt meters; money-dial categories are labeled, not policed.
 */
export const metadata = { title: "Budgets" };

export default async function BudgetsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect('/sign-in');
  const userId = session.user.id;
  const provider = getProvider();
  const today = provider.today(userId);
  const month = today.slice(0, 7);

  // No accounts yet → first-run onboarding, matching every other section (and so a
  // target can't be set before any account exists).
  if ((await prisma.account.count({ where: { userId, OR: [{ currency: null }, { currency: 'USD' }] } })) === 0) return <EmptyDashboard />;

  const [
    txns,
    budgets,
    user,
    plan,
    overlay,
    hiddenCategoryIds,
    linkableCategoryIds,
    fixedMerchants,
    // The shared snapshot, fetched ONCE for both jobs it does here: the
    // Fixed-basis amounts (resolveFixedCategoryAmounts below) and the C.25
    // loan-payment exclusion this page's own row sums must apply (#403).
    snap,
  ] = await Promise.all([
    // All non-transfer, non-split activity this month (BOTH signs) so the engine
    // can net refunds against spend — outflow-only would overstate it.
    prisma.transaction.findMany({
      // O.6 — this where clause is the BASIS, and it is deliberately the register's.
      // Two clauses moved here because /budgets figures became clickable and a link
      // is a claim that the destination adds up to the figure clicked:
      //
      //  * `type in SPENDING_ACCOUNT_TYPES` was MISSING, and that was a plain defect
      //    rather than a basis choice: DECISIONS #62 says a brokerage's buys/sells and
      //    a loan's interest postings are not cash spending, and every other spending
      //    surface excludes them (the snapshot filters them at source, the register
      //    filters them in Prisma). Without it an investment- or loan-account charge
      //    carrying a spending category landed in a budget figure.
      //  * `status: 'POSTED'` is GONE. A pending charge has already reduced what the
      //    reader can spend, and this page's output is an instruction — "$87.70 left
      //    this month" — not a figure to weigh (L.14). Omitting pending made that
      //    remainder too generous, and its failure direction is an overspend against
      //    the reader's own target. /reports, Ask and the register have always counted
      //    both; this page was one of the two outliers.
      //
      // Currency guard (DECISIONS #135): exclude non-USD accounts — no 1:1 foreign sum.
      where: {
        account: {
          userId,
          type: { in: [...SPENDING_ACCOUNT_TYPES] },
          OR: [{ currency: null }, { currency: 'USD' }],
        },
        date: { startsWith: month },
        isTransfer: false,
        isSplitParent: false,
      },
      // The last four fields carry no weight in any figure — they exist so each
      // row can be NAMED in the expandable breakdown beneath its category
      // (`buildCategoryBreakdowns`). `merchant.canonical` rather than the
      // normalizer's guess at `rawDescriptor`, because that is the name the
      // register prints and the one a reader's own rename writes (O.13a).
      select: {
        categoryId: true,
        amountCents: true,
        accountId: true,
        date: true,
        excludeFromTotals: true,
        id: true,
        rawDescriptor: true,
        status: true,
        merchant: { select: { canonical: true } },
        // #397: the reader's per-row verdict feeds this month's Fixed/guilt-free
        // split below. isTransfer/isSplitParent are filtered false in the where.
        spendClassOverride: true,
      },
    }),
    prisma.budget.findMany({ where: { userId } }),
    prisma.user.findUnique({ where: { id: userId } }),
    getSpendingPlan(userId),
    // Custom categories (DECISIONS #111): selectable as targets and resolved to
    // their real name in the spend list instead of falling back to "Uncategorized".
    getCategoryOverlay(userId),
    // Settings calls hiding a category "Remove", and the sentence beside that
    // control says it leaves the pickers. THIS picker did not honour it, so a
    // removed category was still offered as a budget target — the claim was false
    // on the one surface where acting on it sets a monthly figure (O.17 critic).
    getHiddenCategoryIds(userId),
    // O.6: the register's own option list — the fence that decides which rows may
    // become links. Same call /reports and /transactions make.
    getLinkableCategoryIds(userId),
    getRecurringBillMerchantCanonicals(userId),
    provider.getFinanceSnapshot(userId),
  ]);
  const linkable = new Set(linkableCategoryIds);

  const meta = mergeCategoryMeta(overlay.custom, overlay.renames);
  const dials = new Set<string>(parseStoredDials(user?.moneyDials));
  const budgetByCategory = new Map(budgets.map((b) => [b.categoryId, b.monthCents]));
  // Reconciliation boundary (slice-6 critic C-3): a mid-month provider migration backfills
  // the month on the successor while the predecessor still holds the same purchases, so a
  // raw month query counted every category's spend twice — while /reports showed it once.
  // Same shared R1 rule as the register/export.
  const keepsReconciled = await getReconciliationTxnKeep(userId);
  // O.6 critic F-5: the Prisma clause above is only PART of the basis. `isSpendRow`
  // is the reports engine's own per-row predicate and it excludes two populations
  // this page never did — the whole Income GROUP and the `transfer` category id —
  // while `netSpendByCategory` decides purely on sign. A payroll clawback or a
  // reversed reimbursement is a negative row in an income category, so it rendered
  // here as spending (executed: `paycheck −$500` became a $500.00 budget row) and
  // /reports never showed it. Harmless while nothing linked; a lie once the figure
  // is a claim that the register agrees. Sharing the PREDICATE, not just the query,
  // is what makes "one basis" true rather than nearly true.
  // C.26 (audit P1-28): the WHOLE month, and unlike /reports that is on
  // purpose. /reports answers "what have you spent" — a claim about money
  // already gone, so it stops at today. This page tracks an allowance, and a
  // charge the reader has dated for the 28th has already consumed part of it;
  // dropping it would raise "left to spend" on a limit the reader set, which is
  // the generous direction on the one figure that exists to restrain them.
  // The two pages therefore print different numbers for one category in the
  // rare month that holds a future-dated row — each equal to its own register,
  // because the window below is the same object its links are built from
  // (DECISIONS #410).
  const spendRange = wholeMonthWindow(month);
  // C.25 (#403): loan payments carried elsewhere on a dateable obligation
  // leave THIS page's row sums too — same set the flows read, from the same
  // snapshot — or the budget basis would count a mortgage in the months the
  // stored transfer flag happened to miss it.
  const excludedFlowIds = snap.loanPaymentFlowExclusions?.excludeIds;
  // Categories whose figure drops excluded rows: a register link from them
  // would land on a total that still counts those rows — refused (critic
  // P1-4; the O.5/O.6 link invariant).
  const loanRefusedCategories = new Set(loanPaymentRefusedCategories(snap));
  // Named, not inlined, because ONE array now feeds two things: the figures, and
  // the rows the expandable panel prints beneath each figure. Passing the same
  // array to both is what makes "these rows are that number" true by
  // construction rather than by a second query that could drift (the whole
  // argument in engine/glass-box/category-breakdown.ts).
  const spendRows = txns
    .filter(
      (t) =>
        keepsReconciled(t.accountId, t.date) &&
        // isTransfer/isSplitParent are already false — the Prisma clause excluded them.
        // excludeFromTotals is SELECTED and passed through (O.15): the predicate,
        // not this page, decides that an excluded row leaves the figures.
        isSpendRow({ ...t, isTransfer: false, isSplitParent: false }, spendRange, meta, excludedFlowIds),
    )
    .map((t) => ({ ...t, isTransfer: false, isSplitParent: false }));
  const spendByCategory = netSpendByCategory(spendRows);

  // Custom categories are spending by definition (never income/transfer/uncategorized).
  // The system half resolves each label through the SAME per-user meta the spend
  // rows below use: a reader who renamed a category must not meet their new name
  // in the list of targets and the built-in name in the picker that sets them.
  const categoryOptions = [
    ...SYSTEM_BUDGETABLE.filter((c) => !hiddenCategoryIds.has(c.id)).map((c) => ({
      ...c,
      name: categoryName(c.id, meta),
    })),
    ...overlay.custom.filter((c) => isBudgetable(c.id)),
  ];

  const rows = summarizeBudgets(spendByCategory, budgetByCategory, {
    name: (id) => categoryName(id, meta),
    // Money dials are stored as free TEXT the reader typed (User.moneyDials), and
    // the settings field suggests built-in names ("Travel, Dining Out, Hobbies"),
    // so a rename would silently detach the marker from the category it was set
    // on. Match either name: the dial keeps marking the same bucket after a
    // rename, and starts marking one whose new name the reader typed. Keying
    // dials by id instead is the real fix and is a separate change (they are a
    // free-text list, not a category picker) — recorded in TASKS.
    isDial: (id) => dials.has(categoryName(id, meta)) || dials.has(CATEGORY_BY_ID.get(id)?.name ?? ''),
  });

  // Owner request 2026-07-31: every one of these rows expands to the
  // transactions the app filed into it. Built from `spendRows` — the identical
  // array `netSpendByCategory` just summed — and handed each row's OWN rendered
  // figure, so `reconciles` is a real check on this page rather than a claim.
  const breakdowns = buildCategoryBreakdowns(
    spendRows.map((t) => ({
      ...t,
      // The register's own display rule, shared with it by construction.
      merchantName: registerDisplayName(t),
    })),
    spendRange,
    new Map(rows.map((r) => [r.categoryId, r.spentCents])),
    meta,
    excludedFlowIds,
  );

  // Wave B.1, per transaction (#397): this month's rows classified one by one —
  // a category whose rows split appears in both lists with that side's subtotal.
  // C.13: the same reconciliation keep `spendRows` applies above, because these
  // two headings LINK to the register and the register applies it (R1). Not
  // `spendRows` itself: that array has also had `isSpendRow` run over it, which
  // drops the C.25 loan-payment exclusions the register still lists — feeding it
  // here would trade one mismatch with the destination for another.
  const spendClasses = summarizeSpendClassCategories(
    txns.map((t) => ({ ...t, isTransfer: false })),
    meta,
    fixedMerchants,
    (id) => categoryName(id, meta),
    keepsReconciled,
  );

  // #377: per-category Plan amounts (budget else typical) for Fixed rows —
  // same pure helper getSpendingPlan uses for the category-designations basis.
  // C.24: with the SAME exclusion the plan applied (excluded ⇔ unioned — the
  // exactness invariant the plan owns), or this page would print the partial
  // "rent" fragment the plan no longer counts.
  // C.23 critic P1-1: the CONVERTED merchants are excluded here too — their
  // money is each linked reserve's alone, and this page's "typical" must match
  // the plan's or the two surfaces print different figures for one category.
  // `snap` is the one fetched in the opening Promise.all — one snapshot for
  // both the Fixed basis below and the C.25 exclusion above (#403).
  const categoryFixedFull = resolveFixedCategoryAmounts({
    transactions: snap.transactions,
    today: isoDate(today),
    meta,
    fixedMerchants,
    budgetByCategory,
    nameOf: (id) => categoryName(id, meta),
    excludeMerchantCanonicals: new Set([
      ...plan.loanPaymentRollupExclusions,
      ...(plan.convertedReserveRollupExclusions ?? []),
    ]),
  });
  const planAmountByCat = new Map(
    categoryFixedFull.rows.map((r) => [r.categoryId, r] as const),
  );
  const fixedRows = spendClasses.fixed.map((row) => {
    const planAmt = planAmountByCat.get(row.categoryId);
    return {
      ...row,
      planAmountCents: planAmt?.amountCents,
      planAmountBasis: planAmt?.basis,
      planAmountMonths: planAmt?.typicalMonths,
    };
  });
  // Fixed categories with a budget but no fixed-classified spend this month
  // still belong in the Fixed list so the reader can see / change the Plan amount.
  for (const r of categoryFixedFull.rows) {
    if (fixedRows.some((f) => f.categoryId === r.categoryId)) continue;
    if (!r.budgetCents) continue;
    fixedRows.push({
      categoryId: r.categoryId,
      name: r.name,
      spentCents: 0,
      isFixed: true,
      planAmountCents: r.amountCents,
      planAmountBasis: r.basis,
      planAmountMonths: r.typicalMonths,
    });
  }

  const canEdit = !isDemoUser(userId);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Spending this month</h1>
      <BudgetingCompositionCard
        plan={plan}
        savingsTargetBps={user?.savingsTargetBps ?? null}
      />
      <PlanFiguresForm
        suggestedIncomeCents={plan.suggestedIncomeCents}
      patternFixedCents={plan.patternFixedCents}
      reserveMonthlyCents={plan.reserveMonthlyCents}
        incomeOverrideCents={plan.incomeOverrideCents}
        fixedOverrideCents={plan.fixedOverrideCents}
        savingsTargetBps={user?.savingsTargetBps ?? null}
        incomeSlideCents={plan.incomeSlideCents}
        fixedSlideCents={plan.fixedSlideCents}
        hasSlide={plan.hasSlide}
        canEdit={canEdit}
      />
      <ConsciousBucketsStrip plan={plan} disclosures={plan.disclosures} />
      <SpendClassPanel
        fixed={fixedRows}
        guiltFree={spendClasses.guiltFree}
        month={month}
        // C.13 critic P1-1: the same facts the By-category card names below,
        // said from THIS list's side. Both figures are right for their own
        // link, and a page that prints one category twice owes the reader the
        // sentence that reconciles them — beside BOTH figures, not one.
        loanPaymentNotes={loanPaymentBasisFacts(snap).map((e) =>
          spendClassLoanPaymentNote({
            payee: e.payee,
            loanName: e.loanName,
            amount: formatCents(cents(e.paymentCents)),
          }),
        )}
      />
      <Card>
        <CardHeader className="pb-2">
          {/* O.6: the basis belongs in the label (L.29). "Pending included" is the
              clause that changed, and it is the one a reader could otherwise only
              discover by adding the rows up by hand. */}
          <CardDescription>{month} · transfers excluded · pending included</CardDescription>
          {/* C.25 (#403): the loan payments this list does not count, named —
              same set the figures above applied. The claim is scoped to this
              list (O.18e-FU): the SpendClassPanel above counts the same rows
              and says so in its own note — no surface-wide claim survives
              that coexistence. Speaks only when something moved; silence
              means nothing did. */}
          {loanPaymentBasisFacts(snap).map((e, i) => (
            <CardDescription key={`${e.payee}:${e.loanName}:${e.paymentCents}:${i}`} data-testid="budgets-loan-payment-basis">
              {loanPaymentBasisSentence(e, 'this-list')}
            </CardDescription>
          ))}
          <CardTitle className="text-base">By category</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2" data-testid="budget-list">
            {rows.map((row) => {
              // O.6: the SPENT figure is the link — never the target beside it, which
              // is a number the reader chose rather than a set of rows, and never the
              // pair, which would claim the register adds up to "$412.30 / $500.00".
              // `amountCents` is what makes that explicit at the call site.
              const href = categoryWindowRegisterHref(
                { categoryId: row.categoryId, window: spendRange, amountCents: row.spentCents },
                linkable,
                loanRefusedCategories,
              );
              const spent = formatCents(cents(row.spentCents));
              return (
              <li key={row.categoryId} className="space-y-1" data-testid={`budget-row-${row.categoryId}`}>
                <div className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="min-w-0">
                    {/* Owner-reported 2026-07-31: the NAME is what a reader points
                        at, and it was the one inert thing on a tappable row — the
                        figure beside it is ~62px wide on a phone. Same href, same
                        builder, same refusal as the figure; a second anchor rather
                        than a row-wide one because ClearBudgetButton lives in this
                        row and controls may not nest inside an anchor. */}
                    {href === null ? (
                      row.name
                    ) : (
                      <Link
                        href={href}
                        data-testid={`budget-category-name-link-${row.categoryId}`}
                        aria-label={`${row.name}: ${spent} spent this month — view these transactions`}
                        className={CATEGORY_NAME_LINK_CLASS}
                      >
                        {row.name}
                      </Link>
                    )}
                    {row.isDial && (
                      <span className="ml-1 text-xs text-emerald-500" title="A money dial — spend here proudly">
                        ◉ dial
                      </span>
                    )}
                  </span>
                  <span className="flex items-baseline gap-2">
                    {/* O.6 critic P2-8: with every other row now tappable, the
                        uncategorized row was the one dead figure on the card and
                        said nothing about why. /reports already solved this — send
                        it to the inbox that drains it, which is the destination
                        that can actually act on it (the register's category select
                        cannot even display the placeholder, which is why the href
                        builder refuses it). */}
                    {href === null && row.categoryId === 'uncategorized' && (
                      <Link
                        href="/triage"
                        className="whitespace-nowrap text-xs text-muted-foreground underline-offset-2 hover:underline"
                      >
                        review in Inbox →
                      </Link>
                    )}
                    <span className="tabular-nums">
                      {href === null ? (
                        spent
                      ) : (
                        <Link
                          href={href}
                          data-testid={`budget-category-link-${row.categoryId}`}
                          // WCAG 2.5.3: the visible label is the amount alone, so the
                          // accessible name must contain that same string verbatim.
                          aria-label={`${row.name}: ${spent} spent this month — view these transactions`}
                          className={CATEGORY_LINK_CLASS}
                        >
                          {spent}
                        </Link>
                      )}
                      {row.budgetCents !== null && (
                        <span className="text-muted-foreground"> / {formatCents(cents(row.budgetCents))}</span>
                      )}
                    </span>
                    {row.budgetCents !== null && (
                      <ClearBudgetButton categoryId={row.categoryId} name={row.name} />
                    )}
                  </span>
                </div>
                {row.pct !== null && row.remainingCents !== null && (
                  <>
                    <div
                      className="h-1.5 w-full rounded-full bg-accent"
                      role="progressbar"
                      aria-valuenow={row.pct}
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-label={`${row.name} budget used`}
                    >
                      <div
                        className={`h-1.5 rounded-full ${row.over ? 'bg-amber-500' : 'bg-emerald-500'}`}
                        style={{ width: `${row.pct}%` }}
                      />
                    </div>
                    <p className={`text-xs ${row.over ? 'text-amber-500' : 'text-muted-foreground'}`}>
                      {row.over
                        ? `${formatCents(cents(-row.remainingCents))} over target`
                        : `${formatCents(cents(row.remainingCents))} left this month`}
                    </p>
                  </>
                )}
                {/* The expandable half. The register link is passed through
                    UNCHANGED — same builder, same refusal — so the panel adds a
                    way to look without adding a claim the row did not already
                    make. */}
                <CategoryBreakdownPanel
                  breakdown={breakdowns[row.categoryId]}
                  categoryName={row.name}
                  // This page's own window, the same one its card description
                  // prints — the panel may not assume "this month" (O.18 critics).
                  windowLabel={formatMonth(month)}
                  registerHref={href}
                  testIdPrefix="budget-breakdown"
                />
              </li>
              );
            })}
            {rows.length === 0 && (
              <p className="text-sm text-muted-foreground">No spending recorded yet this month.</p>
            )}
          </ul>
          <p className="mt-3 text-xs text-muted-foreground">
            A conscious-spending view, not a guilt meter: money-dial categories are where
            spending buys you the most life.
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardDescription>Optional — a target you choose, not a rule imposed</CardDescription>
          <CardTitle className="text-base">Set a monthly target</CardTitle>
        </CardHeader>
        <CardContent>
          {/* First-run hint when accounts exist but no targets yet (ROADMAP ALSO
              CONSIDER / #186). Seed has zero budgets, so demo always sees this
              until the user sets one — coaching, not a guilt meter. */}
          {budgets.length === 0 && (
            <p
              className="mb-3 rounded-md border border-dashed bg-muted/40 px-3 py-2 text-sm text-muted-foreground"
              data-testid="budget-no-targets-hint"
            >
              No monthly targets yet. Pick a category below to add an optional progress
              bar — it never blocks spending.
            </p>
          )}
          <BudgetTargetForm categoryOptions={categoryOptions.map((c) => ({ id: c.id, name: c.name }))} />
          <p className="mt-2 text-xs text-muted-foreground">
            Setting a target just adds a progress bar — it never blocks spending or judges a
            category. Clear it anytime.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
