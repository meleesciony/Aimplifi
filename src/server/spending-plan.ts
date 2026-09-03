/**
 * Spending Plan data (DECISIONS #66; #295 guilt-free reframe; L.22 pattern
 * re-spec, owner instruction 2026-07-26). Derives the trailing income pattern,
 * the fixed-expense pattern, this-cycle card obligations, and planned savings
 * from the same snapshot every other view uses, then runs the pure engine.
 *
 * THE PATTERN MODEL (why there is no this-month income or spending term here):
 * the owner reported "i don't have 22k or so income coming in" over a July plan
 * whose received+remaining-occurrence income term read $22,254.09. Income is
 * now the MEDIAN of the last three complete months' income on the payment
 * CHECKING account (or every CHECKING account when none is set) — never
 * SAVINGS/money-market or investment activity (owner 2026-08-01: those are
 * already saved/invested). A one-time inflow touches no month but its own.
 * Fixed expenses prefer Fixed-category purchase rollups (budget|typical),
 * including spend on CREDIT accounts (#381 / owner 2026-08-01). Card statement
 * payments are settlement — never Fixed, never guilt-free. Recurring series on
 * CREDIT stay out of the cash projection (`on-card`) but those purchases still
 * count via the category rollup; uncovered cash recurring (e.g. transfer mortgage)
 * unions in. Card payments/transfers are excluded by monthlyFlows' isTransfer
 * rule either way.
 *
 * L.11(D) stands: a payment the engine has DATED past the month's edge is in
 * no pattern the reader can see, so what next month's scheduled income has not
 * arrived in time to cover is reserved here — the one term that still windows
 * by occurrences, because it compares dated flows against dated income, not a
 * pattern against a stock.
 */
import { prisma } from '@/lib/db';
import { applyBillAmountOverlays, excludeOffPlanBills } from '@/lib/engine/spending-plan/bill-rename';
import { getBillAmounts, getBillOffPlanKeys, getBillRenames, getBillsTakenOffPlan } from '@/server/bill-names';
import {
  computeSpendingPlan,
  daysInMonth,
  PLAN_FIXED_NEVER_CATEGORY_IDS,
  scheduledOccurrencesBetween,
  type FixedSeriesCensus,
  type PlanScheduledItem,
  type SpendingPlan,
  type SpendingPlanDisclosures,
} from '@/lib/engine/spending-plan/plan';
import { monthlyGuiltFreeIncomeCents } from '@/lib/engine/spending-plan/income-pattern';
import {
  fixedSpendCategoryIdsInMonths,
  monthlyNonDiscretionaryCents,
} from '@/lib/engine/spending-plan/fixed-pattern';
import {
  filedCategoryByMerchant,
  resolveFixedCategoryAmounts,
} from '@/lib/engine/spending-plan/fixed-category-amounts';
import {
  buildFixedList,
  type FixedListResult,
} from '@/lib/engine/spending-plan/fixed-line-items';
import { suggestedCategoryIsFixed } from '@/lib/engine/spending-plan/spend-class';
import {
  RESERVE_KIND,
  resolveReserves,
  type RefusedReserve,
  type ReserveDeclaration,
} from '@/lib/engine/spending-plan/reserves';
import {
  proposeFixedSetup,
  type FixedSetupProposal,
} from '@/lib/engine/spending-plan/setup-proposals';
import { categoryName } from '@/lib/engine/categorize/categories';
import {
  classifySeriesProjection,
  detectRecurring,
  type RecurringTxn,
  type SeriesProjectionStatus,
} from '@/lib/engine/recurring/detect';
import { loanPaymentMerchantCanonicals } from '@/lib/engine/categorize/transfers';
import { normalizeMerchant } from '@/lib/engine/categorize/normalize';
import { undatedCardsWithBalance } from '@/lib/engine/cash-needed/types';
import { cashNeededFromSnapshot, personalCardDuplicates } from '@/server/finance';
import { getCategoryMeta } from '@/server/category-meta';
import { getRecurringBillMerchantCanonicals } from '@/server/recurring-bill-merchants';
import { getRecurringOverrides } from '@/server/recurring-overrides';
import { getRecurringPaidThrough } from '@/server/recurring-paid-through';
import { getReconciliationBoundary } from '@/server/reconciliation';
import { getProvider } from '@/lib/providers/demo';
import { formatISODate, isoDate, type ISODate } from '@/lib/dates';
import { SPENDING_ACCOUNT_TYPES } from '@/lib/engine/transactions/query';
import { PAYMENT_ACCOUNT_TYPES } from '@/lib/engine/settings/dials';
import type { FinanceSnapshot } from '@/lib/providers/types';

export interface SpendingPlanWithNotes extends SpendingPlan {
  /**
   * The four LISTS are resolved by `buildDisclosures` against the SET THE FIGURE
   * SUMS (the cycle obligations the headline counts), never against every card the
   * user owns — a pair or a frozen flag on a card outside the total may not qualify
   * a figure it is not inside.
   *
   * The three COUNTS added by L.29 are deliberately the other thing: they exist so a
   * $0 line can say why it is zero, and "no credit cards linked" is a claim about
   * every card the user owns, which is exactly what the lists may not read. Two
   * scopes in one object, each documented on its own field.
   */
  disclosures: SpendingPlanDisclosures;
  /** Stored overrides (null = using suggestion). For the Plan figures form. */
  incomeOverrideCents: number | null;
  fixedOverrideCents: number | null;
  /**
   * C.24: merchant canonicals the Fixed rollup excluded because their
   * detected series unioned at full monthly rate (the exactness invariant —
   * excluded ⇔ unioned). Surfaces that re-derive the rollup's basis
   * (/budgets) must apply the same set.
   */
  loanPaymentRollupExclusions: string[];
  /**
   * C.23 (critic P1-1): merchant canonicals the Fixed rollup excluded because
   * their series was CONVERTED to a reserve (the reserve's goal row links the
   * canonical — see `Goal.merchantCanonical`). Same contract as
   * `loanPaymentRollupExclusions`: surfaces that re-derive the rollup's basis
   * (/budgets) must apply the same set, or the typical re-counts the converted
   * charge beside the reserve that replaced it.
   */
  convertedReserveRollupExclusions: string[];
  /**
   * C.19/H.3 — the Fixed figure's composition, already assembled and already
   * certified. The two halves that produce it (the category rollup and the
   * union's series rows) are both computed in this loader, so assembling here
   * is what keeps a single author on the claim "these lines add up to that
   * figure". A page consumes `lines`, `totalCents` and `note` verbatim.
   */
  fixedList: FixedListResult;
  /**
   * C.23/H.4 — reserve declarations this plan could NOT count, with the reason.
   *
   * A stored row whose cadence or amount is unusable is not a nothing: the
   * reader declared a monthly commitment and the plan is now spending that money
   * as guilt-free. The list travels so a surface can say "you declared 3 and we
   * count 2" instead of silently printing the smaller number
   * (`a-zero-is-a-claim-and-must-name-which-zero`). Empty for every reader whose
   * declarations all resolved.
   */
  refusedReserves: RefusedReserve[];
  /**
   * Repeating bills the household took off the plan (BillOffPlan overlay or
   * RecurringOverride NOT_BILL). The page renders this list and computes
   * nothing — one authority with the Fixed filter. Empty = render nothing.
   */
  billsTakenOff: { billKey: string; label: string }[];
  /**
   * C.23 / DECISIONS #431 — the Fixed-costs SETUP proposal, computed HERE with
   * the same `scheduledFixed` array, the same category sets and the same
   * reserve declarations the plan consumed (one authority — a settings line
   * cannot disagree with the figure it stands under). The convert action
   * re-verifies a proposal's `convertibleToReserve` against this same loader
   * output at write time, so the lever's exactness is server-derived, never
   * client-asserted.
   */
  fixedSetup: FixedSetupProposal;
}

export async function getSpendingPlan(userId: string): Promise<SpendingPlanWithNotes> {
  const provider = getProvider();
  const today = provider.today(userId);
  const ym = today.slice(0, 7);
  // U.34: one snapshot of the link table for the whole plan. Income scope and
  // `countedExpenseSeriesForPlan` both need `terminalOf`; fetching it twice left
  // a window where a confirm/undo landing between them scoped income against one
  // set of links and expenses against another, and the guilt-free figure is the
  // difference of the two. The snapshot still reads the table for its own
  // boundary (pre-existing; a different artifact). Required, not optional —
  // U.33: a fallback fetch is how the second read survives unnoticed.
  const [snap, { terminalOf }] = await Promise.all([
    provider.getFinanceSnapshot(userId),
    getReconciliationBoundary(userId),
  ]);

  // Income pattern (owner 2026-08-01): money that lands in the MAIN bank account
  // you spend from — the payment account when set. Other cash (second checking,
  // savings / money-market) and investment accounts are untouchable for this
  // figure (already saved / invested or a duplicate feed of the same paycheck).
  // Counting every linked checking DOUBLED the owner's pattern (~$40k →
  // guilt-free ~$23k after the savings dial). When no payment account is set,
  // fall back to every CHECKING only (still never SAVINGS/MM). Cards never
  // count as income (#295 critic F5).
  const paymentId = snap.paymentAccountId;
  const paymentAcct = paymentId
    ? snap.accounts.find((a) => a.id === paymentId)
    : undefined;
  const incomeAccountIds = new Set(
    paymentAcct && (paymentAcct.type === 'CHECKING' || paymentAcct.type === 'SAVINGS')
      ? [paymentAcct.id]
      : snap.accounts.filter((a) => a.type === 'CHECKING').map((a) => a.id),
  );
  // Still needed for L.29 disclosure math (linked cards vs snapshot-visible cards).
  const creditAccountIds = new Set(snap.accounts.filter((a) => a.type === 'CREDIT').map((a) => a.id));
  // Read every row's account through its TERMINAL SUCCESSOR before testing the scope.
  // `applyReconciliationBoundary` decides which side OWNS a date; it does not re-key
  // transactions, so a reconciled predecessor's rows keep the predecessor's id — and a
  // scope built from live account ids silently drops the pre-cutover history of the very
  // account it names. The two sibling paths already do this: `snap.scheduled` is re-keyed
  // by the boundary itself (F6, "so the successor's payment-account filter finds them")
  // and `countedExpenseSeriesForPlan` remaps detected series below. The transactions the
  // income median reads were the one scoped path that never got it.
  //
  // Measured on the owner's production data 2026-08-02 (scripts/audit-probes/income-replay.mts):
  // a Schwab checking re-linked via Plaid with cutover 2026-07-21 left ONE partial month in
  // scope, so the "median of up to 3 complete months" was a median of one — $10,681.30,
  // where the median of his real three (May $30,937.91 / Jun $21,117.48 / Jul $31,408.61)
  // is $30,937.91. Under-reporting income by 3x moves every figure this plan derives.
  const incomeTxns = snap.transactions.filter((t) =>
    incomeAccountIds.has(terminalOf.get(t.accountId) ?? t.accountId),
  );
  // Prefer paycheck/bonus/side-gig leaves per month; fall back to broad income
  // minus interest/investment/mobile-deposit (DECISIONS #370).
  const trailingMonthlyIncomeCents = monthlyGuiltFreeIncomeCents(incomeTxns)
    .filter((f) => f.month < ym)
    .slice(-3)
    .map((f) => f.incomeCents);

  // Fixed pattern (#371/#376; per-transaction as of #397): non-discretionary
  // spend across spending accounts (checking / savings / credit) — groceries on
  // a card still consume the allocation. Classification is PER ROW: the
  // reader's verdict on the transaction wins, else the guess — a recurring-bill
  // merchant (`fixedMerchants`) guesses fixed, else the filed category's
  // taxonomy flag. Custom categories honour their discretionary flag.
  const [categoryMeta, fixedMerchants] = await Promise.all([
    getCategoryMeta(userId),
    getRecurringBillMerchantCanonicals(userId),
  ]);
  // C.24: merchants structurally identified as LOAN PAYMENTS (a transfer-flagged
  // cash outflow whose ±3-day same-amount pair sits on a linked LOAN/MORTGAGE
  // account — the owner's $6,217.07 Truist mortgage, invisible to both halves
  // of the Fixed union while the flag was per-month timing luck). TWO sets
  // drive the moves below: the broad structural set feeds DETECTION (kept rows,
  // the auto-loan precedent) and the series marks; the narrow UNIONED set —
  // derived after detection — feeds the exclusions.
  //
  // The snapshot WITHHOLDS loan-account rows (#62 — loan activity isn't
  // spending), which is exactly where the pair counterpart sits, so the
  // structural test reads that side through a targeted query instead (POSTED,
  // USD-only — the same guards the pipeline applies everywhere else; critic
  // cycle 1 F5). The rows are handed only to `loanPaymentMerchantCanonicals` —
  // they never join the snapshot, so no flow sum can start counting loan
  // activity.
  const loanSideInflows = await prisma.transaction.findMany({
    where: {
      account: { userId, type: { in: ['LOAN', 'MORTGAGE'] }, OR: [{ currency: null }, { currency: 'USD' }] },
      amountCents: { gt: 0 },
      status: 'POSTED',
    },
    select: { accountId: true, date: true, amountCents: true, rawDescriptor: true },
  });
  const loanPaymentMerchants = loanPaymentMerchantCanonicals(
    [...snap.transactions, ...loanSideInflows],
    new Map(snap.accounts.map((a) => [a.id, a.type])),
  );

  // Income series: still from the stored snapshot (L.11(D) walk + no-history
  // fallback), scoped to the payment-account set. Expense series for the Fixed
  // term: live detect with categoryId so #381 can union rollup with
  // out-of-scope recurring without double-counting Fixed-category bills
  // (snap.scheduled has no categoryId today).
  const scheduledIncome = snap.scheduled
    .filter((s) => s.amountCents > 0 && incomeAccountIds.has(s.accountId))
    .map((s) => ({ amountCents: s.amountCents, cadence: s.cadence }));
  const [scheduledDetected, offPlanKeys, billsTakenOff, billNames, billAmounts] = await Promise.all([
    countedExpenseSeriesForPlan(
      userId,
      snap,
      isoDate(today),
      loanPaymentMerchants,
      terminalOf,
    ),
    getBillOffPlanKeys(userId),
    getBillsTakenOffPlan(userId),
    getBillRenames(userId),
    getBillAmounts(userId),
  ]);
  // Overlay only: drop unnamed (or any keyed) bills taken off the plan so the
  // Fixed list AND the Fixed figure lose those cents. One filter, one loader.
  // Amount overlay is MONTHLY rate, applied after the drop so a taken-off bill
  // cannot still price the figure.
  const scheduledFixed = applyBillAmountOverlays(
    excludeOffPlanBills(scheduledDetected, offPlanKeys),
    billAmounts,
  );
  // THE EXACTNESS INVARIANT (critic cycle 1 F1): a merchant's rows leave the
  // rollup / median basis ONLY when its series actually made the union. The
  // exclusion is unconditional but the re-entry is not — detection can
  // legitimately refuse (an escrow adjustment splits the amount plateau, an
  // irregular gap, a lapsed bill) — and an excluded merchant with no series
  // would see its mortgage VANISH from Fixed where the pre-fix partial
  // coverage at least counted the unflagged months. Where the union cannot
  // take the money, the basis keeps it.
  const unionedLoanMerchants = new Set(
    scheduledFixed
      .filter((s) => s.loanPayment === true && typeof s.merchantCanonical === 'string')
      .map((s) => s.merchantCanonical!),
  );
  // Planned savings inputs: active goals' monthly contributions, and the
  // pay-yourself-first % target from Settings (#295). The engine takes the max.
  // Budgets feed the #377 per-category Fixed rollup (budget target else typical).
  // C.23 critic P1-1 (round 2) HOISTS the fetch ABOVE the median basis: the
  // median is the rollup's fallback, and a converted bill can be the reader's
  // only fixed-classified window spend — the converted-reserve exclusions must
  // be derivable before the median runs, or its VALUES re-count the converted
  // charge whole beside the reserve (measured by the critic: $130,000 fixed
  // vs the correct $10,000 for a $1,200 annual converted bill — 120_000
  // cents, critic round-2 P2-4/P2-6 kept the two scales straight).
  const [goals, user, linkedCreditCardCount, budgetRows, fixedSeriesByStatus] = await Promise.all([
    // `kind` and the reserve fields come back too (C.23/H.4): a reserve is stored
    // as a Goal row and must be summed as a FIXED cost, never as a savings
    // contribution — see the split below.
    prisma.goal.findMany({
      where: { userId },
      select: {
        id: true,
        name: true,
        kind: true,
        targetCents: true,
        cadence: true,
        monthlyContributionCents: true,
        // C.23 critic P1-1: the convert link — set only on reserves created by
        // the convert lever. See the schema comment; derived below.
        merchantCanonical: true,
      },
    }),
    prisma.user.findUnique({
      where: { id: userId },
      select: {
        savingsTargetBps: true,
        planIncomeOverrideCents: true,
        planFixedOverrideCents: true,
      },
    }),
    // The LINKAGE fact, for the one label that asserts an absence of cards (L.29
    // critic P1-3). Counted here rather than off `snap.accounts` because the
    // snapshot withholds every non-USD account (DECISIONS #135), so a reader with a
    // CAD card would have been told in words that no card is linked.
    prisma.account.count({ where: { userId, type: 'CREDIT' } }),
    prisma.budget.findMany({
      where: { userId },
      select: { categoryId: true, monthCents: true },
    }),
    // What became of every repeating EXPENSE the detector found (L.30). Read from
    // the stored reason the writer records in the same pass that decides the
    // projected rows, because at read time the reason is not re-derivable: a
    // `RecurringSeries` row carries no accountId, so nothing here could tell a bill
    // charged to a credit card (correctly absent) from a bill charged to an account
    // the projection cannot read (the defect). EXPENSES only — `typicalAmountCents`
    // is signed, and an income deposit landing in savings is a deliberate absence
    // that must not read as a missing bill.
    prisma.recurringSeries.groupBy({
      by: ['projectionStatus'],
      where: { userId, typicalAmountCents: { lt: 0 } },
      _count: { _all: true },
    }),
  ]);
  // C.23 critic P1-1: merchants the CONVERT lever set aside as reserves. Their
  // money is now the reserve's alone, so their rows leave the category rollup
  // AND the median basis ENTIRELY (the same mechanism as the loan exclusion,
  // one level down): once a converted series' charge lands inside the rollup
  // window or a trailing median month, the average must not count it AND the
  // reserve count it at once — measured by the critic (round 2): an ANNUAL
  // $1,200 dues (120_000 cents) converted while its charge sits in the
  // current month flips the plan to the median basis when the rollup zeroes
  // out, and the median then counted the charge whole beside the reserve
  // (fixed $130,000 vs the correct $10,000 — a 13x overstatement for every
  // window that contains a charge, recurring annually). Derived from the
  // GOALS (excluded ⇔ a reserve
  // exists — the exactness invariant), never from the overrides: a user-set
  // "not a bill" is not a conversion and keeps its place in the averages.
  const convertedReserveMerchants = new Set(
    goals
      .filter((g) => g.kind === RESERVE_KIND && g.merchantCanonical !== null)
      .map((g) => g.merchantCanonical as string),
  );
  const trailingFixedMonths = monthlyNonDiscretionaryCents(
    snap.transactions,
    categoryMeta,
    fixedMerchants,
    new Set([...unionedLoanMerchants, ...convertedReserveMerchants]),
  )
    .filter((f) => f.month < ym)
    .slice(-3);
  const trailingMonthlyFixedCents = trailingFixedMonths.map((f) => f.expenseCents);
  // #384: when the category rollup is empty, the median path still needs a
  // covered-id set so Fixed grocery spend in those months is not double-counted
  // when we union uncovered recurring (auto-loan ACH).
  const trailingFixedMonthKeys = new Set(trailingFixedMonths.map((f) => f.month));
  const endOfMonth = `${ym}-${String(daysInMonth(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)))).padStart(2, '0')}`;

  // Card obligations DUE THIS CALENDAR MONTH (critic F1: subtracting the
  // whole open cycle reserved a statement against two months' income when it
  // was due early in a month — a monthly plan reserves a bill only against
  // its due month). Summed from the engine's own perDueDate rows, so the term
  // is a subset of exactly what the cash-needed headline sums. Guarded: an
  // account-less user (fresh signup asking the assistant) has no funding
  // account to resolve and no cards to owe on.
  const computed = snap.accounts.length ? cashNeededFromSnapshot(snap, today) : null;
  const duePointsThisMonth = (computed?.result.perDueDate ?? []).filter((p) => p.date <= endOfMonth);
  const cardObligationsCents = duePointsThisMonth.reduce((sum, p) => sum + p.dayTotalCents, 0);
  const cardObligationsEstimated = duePointsThisMonth.some((p) => p.cards.some((c) => c.isEstimated));

  // THE DOUBLE-COUNT GATE (C.23/H.4). `plannedSavingsCents` is
  // `max(goalContributions, savingsTarget)` — "a floor, never a sum" — so a
  // reserve left inside this reduce would be committed once as savings and again
  // as Fixed, and `leftToSpend` would understate by exactly the reserve. The
  // filter is EXPLICIT rather than relying on reserves storing a null
  // contribution: that null is a data convention, and a data convention is
  // whatever the next writer decides it is.
  const goalContributionsCents = goals
    .filter((g) => g.kind !== RESERVE_KIND)
    .reduce((sum, g) => sum + (g.monthlyContributionCents ?? 0), 0);
  // The RAW declarations, captured for the fixed-setup proposal (C.23): the
  // settings surface resolves them with the SAME `resolveReserves` the plan
  // uses, so the headline figure and the plan's Fixed term cannot disagree.
  const reserveDeclarations: ReserveDeclaration[] = goals
    .filter((g) => g.kind === RESERVE_KIND)
    .map((g) => ({
      id: g.id,
      name: g.name,
      trueCostCents: g.targetCents,
      cadence: g.cadence,
      pairedToBill: Boolean(g.merchantCanonical),
    }));
  const reserves = resolveReserves(reserveDeclarations);
  const fixedSeriesCount = (status: SeriesProjectionStatus): number =>
    fixedSeriesByStatus.find((g) => g.projectionStatus === status)?._count._all ?? 0;
  const fixedSeries: FixedSeriesCensus = {
    detected: fixedSeriesByStatus.reduce((sum, g) => sum + g._count._all, 0),
    counted: fixedSeriesCount('counted'),
    onCard: fixedSeriesCount('on-card'),
    lapsed: fixedSeriesCount('lapsed'),
    uncounted: fixedSeriesCount('off-scope'),
    noCashAccount: fixedSeriesCount('no-cash-account'),
  };

  // The other side of the same filter (L.11(D)): obligations the engine HAS
  // dated, falling past this month's edge. A payment dated on the 5th of next
  // month is otherwise in no plan the reader can see — this month excludes it,
  // and next month's plan arrives after the money is gone.
  //
  // NET OF THE INCOME THAT ARRIVES FIRST, which is the whole difference between
  // this and the version two critics rejected. Widening the EXPENSE window past
  // the month's edge without widening the INCOME window re-draws one column of
  // a two-column flow — the corollary this slice's own lesson already records.
  // Left gross, it reserved a full statement every month, permanently, for the
  // commonest issuer pattern (paid the 1st, cards due the 3rd), and reserved a
  // payment dated 30 days out that next month's plan would have shown on its
  // first day. What this month's income must actually cover is the part its
  // successor's income has not arrived in time to pay.
  //
  // Walked point by point rather than netted in one lump: income landing after
  // an earlier payment cannot pay it, so the reservation is the WORST running
  // gap, never the end-state difference. Flows only — no balance enters here.
  const beyondMonthPoints = (computed?.result.perDueDate ?? []).filter((p) => p.date > endOfMonth);
  const scheduledIncomeThrough = (through: string): number => {
    let sum = 0;
    for (const s of snap.scheduled) {
      if (s.amountCents <= 0) continue;
      // The REAL today gates the stale-anchor rule — never the window's start
      // (L.22 money critic P1-1: passing endOfMonth read every live anchor that
      // landed before the window as "stale", and the walk saw no income at all).
      sum += s.amountCents * scheduledOccurrencesBetween(s.nextDate, s.cadence, today, endOfMonth, through);
    }
    return sum;
  };
  let cumulativeBeyond = 0;
  let worstGapCents = 0;
  let worstGapDate: string | null = null;
  for (const p of beyondMonthPoints) {
    cumulativeBeyond += p.dayTotalCents;
    const gap = cumulativeBeyond - scheduledIncomeThrough(p.date);
    if (gap > worstGapCents) {
      worstGapCents = gap;
      worstGapDate = p.date;
    }
  }
  const obligationsBeyondMonthCents = worstGapCents;
  // Formatted here, in the product's own date voice: every other date a reader
  // sees reads "Wed, Aug 5", never "2026-08-05". Names the payment day the
  // reservation is actually FOR — the point that set the worst gap.
  const obligationsBeyondMonthThroughDate = worstGapDate ? formatISODate(isoDate(worstGapDate)) : null;
  // Provenance rides the money (the rule the in-month term above already obeys):
  // when every card is dated past the edge, `cardObligationsEstimated` is false
  // by construction, so without this a figure that is 100% guesswork off current
  // balances would print with the authority of a generated statement.
  const obligationsBeyondMonthEstimated =
    worstGapCents > 0 && beyondMonthPoints.some((p) => p.cards.some((c) => c.isEstimated));

  // #377/#380/#381: per-category Fixed amounts (budget else typical). Always-on
  // when the rollup has positive mass; union with out-of-scope recurring.
  // C.24: UNIONED loan-payment merchants (the exactness invariant above) leave
  // the rollup ENTIRELY and re-enter Fixed through the union at the series'
  // monthly rate — both halves read the SAME set, so they cannot disagree
  // about which merchants moved.
  const categoryFixed = resolveFixedCategoryAmounts({
    transactions: snap.transactions,
    today,
    meta: categoryMeta,
    fixedMerchants,
    budgetByCategory: new Map(budgetRows.map((b) => [b.categoryId, b.monthCents])),
    nameOf: (id) => categoryName(id, categoryMeta),
    // C.23 critic P1-1: the CONVERTED merchants join the loan exclusion — a
    // converted series' charges are the reserve's money now, and the category
    // average counting them again is the double count the lever exists to avoid.
    excludeMerchantCanonicals: new Set([
      ...unionedLoanMerchants,
      ...convertedReserveMerchants,
    ]),
  });
  // #397: the union's category test reads the taxonomy suggestion alone — a
  // series whose rows the reader flipped to discretionary is neither covered
  // (no fixed-classified mass) nor unioned here, so the flip rules.
  const categoryIsFixed = (categoryId: string) =>
    suggestedCategoryIsFixed(categoryId, categoryMeta);
  // Covered ids for the Fixed∪recurring union (#381/#384):
  //   rollup > 0 → categories that contribute mass to the rollup
  //   median path → Fixed categories that fed the trailing months (so grocery
  //     series is not double-counted; transfer auto-loan stays uncovered)
  const categoryFixedCoveredIds =
    categoryFixed.totalCents > 0
      ? new Set(categoryFixed.rows.filter((r) => r.amountCents > 0).map((r) => r.categoryId))
      : fixedSpendCategoryIdsInMonths(
          snap.transactions,
          trailingFixedMonthKeys,
          categoryMeta,
          fixedMerchants,
          // C.23 critic P1-1: the SAME exclusion set as the rollup above — the
          // median path must not re-count a converted series' months either.
          new Set([...unionedLoanMerchants, ...convertedReserveMerchants]),
        );

  // C.24 critic F2: a loan-payment series whose category the reader priced
  // themselves is NOT added on top of the reader's own number. Extracted from
  // the plan call below so the fixed-setup proposal reads the SAME set.
  const budgetCategoryIds = new Set(
    budgetRows.filter((b) => b.monthCents > 0).map((b) => b.categoryId),
  );

  const plan = computeSpendingPlan({
    today,
    trailingMonthlyIncomeCents,
    scheduledIncome,
    scheduledFixed,
    trailingMonthlyFixedCents,
    categoryFixedCents: categoryFixed.totalCents,
    // C.11 / audit P1-14: the Glass-Box provenance gate — a budget target
    // pricing a Fixed category is the reader's own number, so the panel must
    // not certify "computed from your own data" while one is in the term.
    categoryFixedHasReaderInput: categoryFixed.hasReaderInput,
    categoryFixedCoveredIds,
    budgetCategoryIds,
    categoryIsFixed,
    incomeOverrideCents: user?.planIncomeOverrideCents ?? null,
    fixedOverrideCents: user?.planFixedOverrideCents ?? null,
    cardObligationsCents,
    cardObligationsEstimated,
    goalContributionsCents,
    reserves: reserves.lines,
    savingsTargetBps: user?.savingsTargetBps ?? null,
    obligationsBeyondMonthCents,
    obligationsBeyondMonthThroughDate,
    obligationsBeyondMonthEstimated,
  });

  // C.23 / DECISIONS #431 — the guided Fixed-costs setup proposal: every
  // counted expense series marked with the union's own basis verdict, the
  // reserves resolved as the plan resolves them, and the "move this much to
  // reserves this month" figure — all derived from the SAME arrays and sets
  // the plan just consumed (one authority, by construction).
  const fixedSetup = proposeFixedSetup({
    items: scheduledFixed,
    categoryIsFixed,
    rollupCategoryIds: categoryFixedCoveredIds,
    budgetCategoryIds,
    // C.23 critic P1-2: the proposal's inBasis oracle must be the one the plan
    // SUMMED — on the last-resort basis the plan counts every non-settlement
    // series, so the union's discretionary skip would render a counted series
    // as "not in your fixed costs" with a lever whose delta is zero. (`fixedBasis`,
    // the public field: 'user-set' keeps the union oracle — the override owns
    // the figure, and the union is what the fixed list still renders.)
    planFixedBasis: plan.fixedBasis,
    reserves: reserveDeclarations,
    billNames,
  });

  return {
    ...plan,
    incomeOverrideCents: user?.planIncomeOverrideCents ?? null,
    fixedOverrideCents: user?.planFixedOverrideCents ?? null,
    fixedSetup,
    // C.24: the merchants the rollup excluded because their series unioned
    // (the exactness invariant). /budgets re-derives the same per-category
    // basis and must apply the SAME exclusion or the two surfaces print
    // different "typical" figures for the same category.
    //
    // Money critic P2-2: `unionedLoanMerchants` above was derived from every
    // `scheduledFixed` row with `loanPayment === true`, BEFORE the union's own
    // skips (never-category, budget-priced) ran — so a series the union then
    // DROPPED had still had its rows stripped from the rollup, and the money
    // left Fixed entirely while the list certified the remainder "exact". The
    // union now emits its rows, so the exclusion is derived from what was
    // actually kept — the rows in `plan.fixedLineItems` that are loan payments
    // — which is what makes "excluded ⇔ unioned" true rather than stated.
    loanPaymentRollupExclusions: [
      ...new Set(
        plan.fixedLineItems
          .filter((r) => r.loanPayment)
          .map((r) => r.merchantCanonical)
          .filter((c): c is string => c !== null),
      ),
    ],
    // C.23 critic P1-1: the CONVERTED merchants the rollup excluded (their money
    // is each linked reserve's alone). /budgets re-derives the same per-category
    // basis and must apply the SAME exclusion or the two surfaces print
    // different "typical" figures for the same category — the same rule as the
    // loan exclusions one field above.
    convertedReserveRollupExclusions: [...convertedReserveMerchants],
    // C.19/H.3: the Fixed figure's own composition, assembled HERE from the two
    // halves that produced it — the category rollup computed just above and the
    // union rows the plan summed. The page renders it and computes nothing: a
    // list under a money figure is a claim that the lines add up to it, and
    // C.26's critic proved a view can reintroduce exactly that defect with the
    // whole suite green.
    fixedList: buildFixedList({
      plan,
      rollupRows: categoryFixed.rows,
      nameOfCategory: (id) => categoryName(id, categoryMeta),
      billNames,
      billAmounts,
    }),
    // Declarations that could not be counted (C.23/H.4). Surfaced rather than
    // swallowed: a refused reserve is money the reader told us about and the
    // plan then spent as though it were free.
    refusedReserves: reserves.refused,
    billsTakenOff,
    disclosures: await buildDisclosures(userId, snap, computed, endOfMonth, {
      // The three facts that separate one $0 card-payments line from another (L.29).
      // Each is about a different way of not owing money this month, and each is
      // read off the thing it names rather than off a figure that correlates with
      // it — the mistake both critics found in the first cut.
      creditCardCount: linkedCreditCardCount,
      // Linked minus visible: a non-USD card is in neither the obligation result nor
      // any exclusion list, because the snapshot dropped it before the engine ran.
      creditCardsOutsideFigure: Math.max(0, linkedCreditCardCount - creditAccountIds.size),
      // DATED past the edge — the population, not the money. `obligationsBeyondMonthCents`
      // is the worst running gap NET of scheduled income and is 0 whenever next
      // month's pay covers the payment, which is the commonest issuer pattern of all.
      cardsDatedAfterThisMonth: new Set(beyondMonthPoints.flatMap((p) => p.cards.map((c) => c.cardId)))
        .size,
      // The same job for the fixed-expense line (L.30): which $0.00 this is.
      fixedSeries,
    }),
  };
}

/**
 * Counted expense series with categoryId for the Fixed-term union (#381).
 * Same admission rules as `refreshRecurringForUser` / L.25 (cash expenses,
 * payment-scoped income is irrelevant here). Live detect — not snap.scheduled —
 * because stored ScheduledTransaction rows do not yet carry categoryId.
 *
 * THE CATEGORY IS RESOLVED FROM THE SERIES' OWN ROWS (C.4, measured #393): a
 * detected series carries the merchant normalizer's GUESS at the raw
 * descriptor, while the rollup this union dedupes against keys on the FILED
 * `Transaction.categoryId`. Where the merchant table doesn't know a payee but
 * the reader filed its rows, the guess is `uncategorized`, the dedupe cannot
 * match, and the union re-adds money the rollup already counted — live at
 * +$296.40/mo on the owner's account. The filed id wins (weighted by outflow
 * cents, rollup window first — see `filedCategoryByMerchant`); the guess
 * survives for merchants with no filed row (whose money is in no rollup
 * category by construction, so adding them cannot double-count — which is also
 * why a null id still unions in rather than being skipped; see DECISIONS), for
 * aggregate pseudo-merchants that are not fully filed into one supermajority
 * category, and where a remap would enter the settlement-never set (critic
 * cycles 1–3).
 */
async function countedExpenseSeriesForPlan(
  userId: string,
  snap: FinanceSnapshot,
  today: ISODate,
  loanPaymentMerchants: ReadonlySet<string>,
  terminalOf: ReadonlyMap<string, string>,
): Promise<PlanScheduledItem[]> {
  const spendingIds = new Set(
    snap.accounts
      .filter((a) => (SPENDING_ACCOUNT_TYPES as readonly string[]).includes(a.type))
      .map((a) => a.id),
  );
  const source = snap.transactions.filter(
    (t) => t.status === 'POSTED' && !t.isSplitParent && spendingIds.has(t.accountId),
  );
  const filedByMerchant = filedCategoryByMerchant(source, today);
  const txns: RecurringTxn[] = source.map((t, i) => ({
    id: String(i),
    accountId: t.accountId,
    date: t.date,
    amountCents: t.amountCents,
    rawDescriptor: t.rawDescriptor,
    isTransfer: t.isTransfer,
    // C.24: only flagged rows need the mark (unflagged rows pass detection
    // anyway) — a structural loan payment is kept like the auto-loan ACH.
    ...(t.isTransfer
      ? { loanPayment: loanPaymentMerchants.has(normalizeMerchant(t.rawDescriptor).canonical) }
      : null),
  }));
  const overrides = await getRecurringOverrides(userId);
  const paidThrough = await getRecurringPaidThrough(userId);
  const series = detectRecurring(txns, today, overrides, paidThrough);
  const superseded = new Set(terminalOf.keys());
  const cashAccountIds = new Set(
    snap.accounts
      .filter(
        (a) =>
          (PAYMENT_ACCOUNT_TYPES as readonly string[]).includes(a.type) && !superseded.has(a.id),
      )
      .map((a) => a.id),
  );
  const creditAccountIds = new Set(snap.accounts.filter((a) => a.type === 'CREDIT').map((a) => a.id));
  const paymentAccountId =
    (snap.paymentAccountId && cashAccountIds.has(snap.paymentAccountId)
      ? snap.paymentAccountId
      : null) ??
    snap.accounts.find((a) => cashAccountIds.has(a.id))?.id ??
    null;
  const scope = { paymentAccountId, cashAccountIds, creditAccountIds };
  return series
    .filter((s) => !s.isIncome)
    .map((s) => {
      const to = terminalOf.get(s.accountId);
      return to === undefined || to === s.accountId ? s : { ...s, accountId: to };
    })
    .filter((s) => classifySeriesProjection(s, scope, today) === 'counted')
    .map((s) => {
      const filed = filedByMerchant.get(s.merchantCanonical);
      // A remap may not move a series INTO the settlement set the union refuses
      // (critic cycle 1 P0-3): the normalizer's auto-loan identity is specific
      // pattern evidence, and a filed `credit-card-payment` on those rows would
      // silently DROP a real obligation from Fixed — a missed standing payment
      // instructs overspending, where the alternative error (double-counting a
      // settlement) only shrinks guilt-free. Out of the set is fine (the
      // reader's filing wins); into it is not.
      const categoryId =
        filed === undefined ||
        (typeof filed === 'string' &&
          PLAN_FIXED_NEVER_CATEGORY_IDS.has(filed) &&
          !(typeof s.categoryId === 'string' && PLAN_FIXED_NEVER_CATEGORY_IDS.has(s.categoryId)))
          ? s.categoryId
          : filed;
      return {
        amountCents: s.typicalAmountCents,
        cadence: s.cadence,
        categoryId,
        // C.24: rides into `recurringOutsideFixedCategoryCents`, which unions
        // a structural loan payment unconditionally — the covered-skip cannot
        // express a PARTIALLY covered category (rent holding one counted
        // mortgage month of three). The canonical rides too: the caller
        // derives the exactness invariant's exclusion set from the series
        // that actually made the union.
        loanPayment: loanPaymentMerchants.has(s.merchantCanonical),
        merchantCanonical: s.merchantCanonical,
      };
    });
}

/**
 * Resolve each disclosure against the set the figure sums: the obligation
 * rows due this month, flattened from `perDueDate` — so a pair or a frozen
 * flag on a card outside that set never qualifies a figure it is not inside
 * (the L.15 cycle-2 lesson: resolve a claim about a computed set against THAT
 * SET, not its input).
 */
async function buildDisclosures(
  userId: string,
  snap: Parameters<typeof cashNeededFromSnapshot>[0],
  computed: ReturnType<typeof cashNeededFromSnapshot> | null,
  endOfMonth: string,
  /** The zero-basis counts (L.29/L.30), resolved by the caller from the sources
   *  that own them. Spread into BOTH returns below, so the account-less branch
   *  cannot silently lose a basis the label needs. */
  counts: {
    creditCardCount: number;
    creditCardsOutsideFigure: number;
    cardsDatedAfterThisMonth: number;
    fixedSeries: FixedSeriesCensus;
  },
): Promise<SpendingPlanDisclosures> {
  if (!computed) {
    // The account-less branch still carries the counts: this branch is reached when
    // the SNAPSHOT has no accounts, which is not the same as the reader having no
    // card — a single non-USD card lands here with `creditCardCount` 1.
    return {
      undatedCards: [],
      statementPendingCards: [],
      duplicatePairs: [],
      frozenCards: [],
      ...counts,
    };
  }
  const result = computed.result;

  // Every card inside the figure — BOTH terms. Filtering to the month here (as
  // this did before L.11(D) widened the figure) left a frozen or duplicated card
  // driving a subtraction that no surface could qualify: resolve a claim about a
  // computed set against THAT set, and the set is now both sides of the filter.
  const summedIds = new Set(result.perDueDate.flatMap((p) => p.cards.map((c) => c.cardId)));
  const byId = new Map(result.cards.map((c) => [c.cardId, c]));

  const frozenCards: SpendingPlanDisclosures['frozenCards'] = [];
  for (const id of summedIds) {
    const card = byId.get(id);
    if (card?.frozenSince) frozenCards.push({ label: card.cardName, frozenSince: card.frozenSince });
  }

  // The duplicate detector costs queries only when a candidate pair exists
  // (the L.15 cost note); both sides must be INSIDE the summed set to claim
  // the term is inflated.
  const pairs = summedIds.size >= 2 ? await personalCardDuplicates(userId, snap, result) : [];
  const duplicatePairs = pairs
    .filter((p) => summedIds.has(p.aId) && summedIds.has(p.bId))
    .map((p) => ({
      aName: byId.get(p.aId)?.cardName ?? 'a card',
      bName: byId.get(p.bId)?.cardName ?? 'a card',
      confidence: p.confidence,
    }));

  // Only cards that OWE (balances stored positive) can overstate guilt-free
  // by their absence — an overpaid/credit-balance undated card demands no
  // payment, and naming it under "the real figure may be lower" would state
  // the wrong direction (critic F8).
  const undatedCards = undatedCardsWithBalance(result)
    .filter((c) => c.currentBalanceCents > 0)
    .map((c) => ({ cardName: c.cardName, frozenSince: c.frozenSince }));

  // A card whose ESTIMATED obligation is due this month but sits in the
  // engine's `upcoming` set (excluded because another card has a real
  // statement — critic F2). Its payment is in no term of this plan, so the
  // figure may be overstated by it; the mechanism differs from `undatedCards`
  // (the statement simply has not been generated yet), so it gets its own
  // sentence. Cards demanding nothing (cashRequired 0) claim nothing.
  const statementPendingCards = result.upcoming
    .filter((c) => c.effectiveDueDate <= endOfMonth && c.cashRequiredCents > 0)
    .map((c) => ({ cardName: c.cardName, dueDate: c.effectiveDueDate }));

  return { undatedCards, statementPendingCards, duplicatePairs, frozenCards, ...counts };
}
