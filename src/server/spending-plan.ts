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
 * Fixed expenses are the detected recurring series at a monthly rate. A
 * credit-card row still reaches this plan only through its obligation term
 * (#295 critic F5); card payments/transfers are excluded by monthlyFlows'
 * isTransfer rule either way.
 *
 * L.11(D) stands: a payment the engine has DATED past the month's edge is in
 * no pattern the reader can see, so what next month's scheduled income has not
 * arrived in time to cover is reserved here — the one term that still windows
 * by occurrences, because it compares dated flows against dated income, not a
 * pattern against a stock.
 */
import { prisma } from '@/lib/db';
import {
  computeSpendingPlan,
  daysInMonth,
  scheduledOccurrencesBetween,
  type FixedSeriesCensus,
  type SpendingPlan,
  type SpendingPlanDisclosures,
} from '@/lib/engine/spending-plan/plan';
import { monthlyGuiltFreeIncomeCents } from '@/lib/engine/spending-plan/income-pattern';
import { monthlyNonDiscretionaryCents } from '@/lib/engine/spending-plan/fixed-pattern';
import { resolveFixedCategoryAmounts } from '@/lib/engine/spending-plan/fixed-category-amounts';
import { categoryName } from '@/lib/engine/categorize/categories';
import type { SeriesProjectionStatus } from '@/lib/engine/recurring/detect';
import { undatedCardsWithBalance } from '@/lib/engine/cash-needed/types';
import { cashNeededFromSnapshot, personalCardDuplicates } from '@/server/finance';
import { getCategoryMeta } from '@/server/category-meta';
import { getCategoryFixedOverrides } from '@/server/category-fixed';
import { getProvider } from '@/lib/providers/demo';
import { formatISODate, isoDate } from '@/lib/dates';

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
}

export async function getSpendingPlan(userId: string): Promise<SpendingPlanWithNotes> {
  const provider = getProvider();
  const today = provider.today(userId);
  const ym = today.slice(0, 7);
  const snap = await provider.getFinanceSnapshot(userId);

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
  const incomeTxns = snap.transactions.filter((t) => incomeAccountIds.has(t.accountId));
  // Prefer paycheck/bonus/side-gig leaves per month; fall back to broad income
  // minus interest/investment/mobile-deposit (DECISIONS #370).
  const trailingMonthlyIncomeCents = monthlyGuiltFreeIncomeCents(incomeTxns)
    .filter((f) => f.month < ym)
    .slice(-3)
    .map((f) => f.incomeCents);

  // Fixed pattern (#371/#376): non-discretionary spend across spending accounts
  // (checking / savings / credit) — groceries on a card still consume the
  // allocation. Dining out and shopping stay out unless the reader overrides
  // the category on /budgets. Custom categories honour their discretionary flag.
  const [categoryMeta, fixedOverrides] = await Promise.all([
    getCategoryMeta(userId),
    getCategoryFixedOverrides(userId),
  ]);
  const trailingMonthlyFixedCents = monthlyNonDiscretionaryCents(
    snap.transactions,
    categoryMeta,
    fixedOverrides,
  )
    .filter((f) => f.month < ym)
    .slice(-3)
    .map((f) => f.expenseCents);

  // The recurring series, split by sign: income feeds only the no-history
  // fallback (and the L.11(D) walk below); expenses are the FALLBACK for the
  // fixed term when no non-discretionary pattern exists yet (#371), and still
  // floor the term via max() so a thin filing month cannot understate bills
  // the detector already sees. Detected recurring LOAN payments arrive here —
  // which is why loanObligations is not a separate term (adding it would
  // double-count them; a loan with NO detected series is counted zero times
  // until filed — recorded in docs/STATUS.md §L.11(C)).
  // Income-series fallback matches the trailing-pattern account set (payment
  // checking when set). Bills still come from every cash account — a utility
  // autopaid from savings is a real fixed cost (L.25).
  const scheduledIncome = snap.scheduled
    .filter((s) => s.amountCents > 0 && incomeAccountIds.has(s.accountId))
    .map((s) => ({ amountCents: s.amountCents, cadence: s.cadence }));
  const scheduledFixed = snap.scheduled
    .filter((s) => s.amountCents < 0)
    .map((s) => ({ amountCents: s.amountCents, cadence: s.cadence }));
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

  // Planned savings inputs: active goals' monthly contributions, and the
  // pay-yourself-first % target from Settings (#295). The engine takes the max.
  // Budgets feed the #377 per-category Fixed rollup (budget target else typical).
  const [goals, user, linkedCreditCardCount, budgetRows, fixedSeriesByStatus] = await Promise.all([
    prisma.goal.findMany({ where: { userId }, select: { monthlyContributionCents: true } }),
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
  const goalContributionsCents = goals.reduce((sum, g) => sum + (g.monthlyContributionCents ?? 0), 0);
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

  // #377: per-category Fixed amounts (budget else typical). Plan prefers this
  // rollup only when the reader has set a Fixed override or a budget on a
  // fixed category — otherwise the #371 median stays (demo golden-safe).
  const categoryFixed = resolveFixedCategoryAmounts({
    transactions: snap.transactions,
    today,
    meta: categoryMeta,
    overrides: fixedOverrides,
    budgetByCategory: new Map(budgetRows.map((b) => [b.categoryId, b.monthCents])),
    nameOf: (id) => categoryName(id, categoryMeta),
  });

  const plan = computeSpendingPlan({
    today,
    trailingMonthlyIncomeCents,
    scheduledIncome,
    scheduledFixed,
    trailingMonthlyFixedCents,
    categoryFixedCents: categoryFixed.totalCents,
    categoryFixedHasReaderInput: categoryFixed.hasReaderInput,
    incomeOverrideCents: user?.planIncomeOverrideCents ?? null,
    fixedOverrideCents: user?.planFixedOverrideCents ?? null,
    cardObligationsCents,
    cardObligationsEstimated,
    goalContributionsCents,
    savingsTargetBps: user?.savingsTargetBps ?? null,
    obligationsBeyondMonthCents,
    obligationsBeyondMonthThroughDate,
    obligationsBeyondMonthEstimated,
  });

  return {
    ...plan,
    incomeOverrideCents: user?.planIncomeOverrideCents ?? null,
    fixedOverrideCents: user?.planFixedOverrideCents ?? null,
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
