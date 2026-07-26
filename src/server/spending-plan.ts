/**
 * Spending Plan data (DECISIONS #66; #295 guilt-free reframe). Derives this
 * month's expected income, cash spending so far, upcoming recurring bills,
 * this-cycle card obligations, and planned savings from the same snapshot
 * every other view uses, then runs the pure engine.
 *
 * THE CASH-MONTH MODEL (#295, see plan.ts header): income and expenses both
 * count from NON-CREDIT accounts (critic F5: a cashback/uncategorized positive
 * on a card must not count as income while also shrinking the next statement —
 * a card row affects this plan only through its obligation); card spending
 * enters once, in the calendar month its statement's payment comes due — the
 * cash-needed engine's own obligation rows with an effective due date in this
 * month, from the SAME personal snapshot (this snapshot is never
 * household-merged; the dashboard hero at household scope shows the MERGED
 * cash-needed figure, which this personal plan does not claim to equal).
 */
import { prisma } from '@/lib/db';
import { monthlyFlows } from '@/lib/engine/fi/insights';
import {
  computeSpendingPlan,
  daysInMonth,
  scheduledOccurrencesInWindow,
  type SpendingPlan,
  type SpendingPlanDisclosures,
} from '@/lib/engine/spending-plan/plan';
import { undatedCardsWithBalance } from '@/lib/engine/cash-needed/types';
import { cashNeededFromSnapshot, personalCardDuplicates } from '@/server/finance';
import { getProvider } from '@/lib/providers/demo';

export interface SpendingPlanWithNotes extends SpendingPlan {
  /**
   * Resolved by `buildDisclosures` against the SET THE FIGURE SUMS (the cycle
   * obligations the headline counts), never against every card the user owns.
   */
  disclosures: SpendingPlanDisclosures;
}

export async function getSpendingPlan(userId: string): Promise<SpendingPlanWithNotes> {
  const provider = getProvider();
  const today = provider.today(userId);
  const ym = today.slice(0, 7);
  const snap = await provider.getFinanceSnapshot(userId);

  // Income AND expenses this month — both over NON-CREDIT accounts (#295,
  // critic F5). A credit-card row reaches this plan only through the
  // obligation term below: a purchase would otherwise be charged twice
  // (posted month + statement month), and a cashback/statement credit would
  // otherwise be double-benefited (counted as income AND shrinking the next
  // statement). Card payments/transfers are excluded by monthlyFlows'
  // isTransfer rule either way.
  const creditAccountIds = new Set(snap.accounts.filter((a) => a.type === 'CREDIT').map((a) => a.id));
  const cashMonth = monthlyFlows(
    creditAccountIds.size ? snap.transactions.filter((t) => !creditAccountIds.has(t.accountId)) : snap.transactions,
  ).find((f) => f.month === ym);
  const receivedIncomeCents = cashMonth?.incomeCents ?? 0;
  const spentSoFarCents = cashMonth?.expensesCents ?? 0;

  // Scheduled items still to come this month: bills (out) and income (in),
  // each counted ONCE PER REMAINING OCCURRENCE — a BIWEEKLY paycheck with two
  // paydays left contributes both (critic F4: reading only `nextDate`
  // half-counted income and biweekly bills alike). Detected recurring LOAN
  // payments (the auto-loan exception in detectRecurring) arrive HERE — which
  // is why loanObligations is not a term of this plan: adding it would
  // double-count them. A loan with NO detected series is counted zero times —
  // recorded in docs/STATUS.md §L.11(C).
  const endOfMonth = `${ym}-${String(daysInMonth(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)))).padStart(2, '0')}`;
  let upcomingBillsCents = 0;
  let remainingIncomeCents = 0;
  for (const s of snap.scheduled) {
    const occurrences = scheduledOccurrencesInWindow(s.nextDate, s.cadence, today, endOfMonth);
    if (occurrences === 0) continue;
    if (s.amountCents < 0) upcomingBillsCents += -s.amountCents * occurrences;
    else remainingIncomeCents += s.amountCents * occurrences;
  }

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
  const [goals, user] = await Promise.all([
    prisma.goal.findMany({ where: { userId }, select: { monthlyContributionCents: true } }),
    prisma.user.findUnique({ where: { id: userId }, select: { savingsTargetBps: true } }),
  ]);
  const goalContributionsCents = goals.reduce((sum, g) => sum + (g.monthlyContributionCents ?? 0), 0);

  const plan = computeSpendingPlan({
    today,
    expectedIncomeCents: receivedIncomeCents + remainingIncomeCents,
    spentSoFarCents,
    upcomingBillsCents,
    cardObligationsCents,
    cardObligationsEstimated,
    goalContributionsCents,
    savingsTargetBps: user?.savingsTargetBps ?? null,
  });

  return { ...plan, disclosures: await buildDisclosures(userId, snap, computed, endOfMonth) };
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
): Promise<SpendingPlanDisclosures> {
  if (!computed) {
    return { undatedCards: [], statementPendingCards: [], duplicatePairs: [], frozenCards: [] };
  }
  const result = computed.result;

  const summedIds = new Set(
    result.perDueDate.filter((p) => p.date <= endOfMonth).flatMap((p) => p.cards.map((c) => c.cardId)),
  );
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

  return { undatedCards, statementPendingCards, duplicatePairs, frozenCards };
}
