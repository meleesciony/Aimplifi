/**
 * FI Coach data assembly: provider snapshot → pure FI engines.
 * Definitions (stated in the UI as assumptions):
 *  - annual expenses = last 6 full months of non-transfer outflows × 2
 *  - monthly savings = average (income − expenses) over those months
 *  - portfolio = investment account balances
 *  - liquid (runway) = checking + savings balances
 */
import { isoDate, addMonthsClamped } from '@/lib/dates';
import { type Cents, cents, roundHalfAwayFromZero } from '@/lib/money';
import { cashNeededFromSnapshot } from '@/server/finance';
import { detectRecurring } from '@/lib/engine/recurring/detect';
import { buildAutomationBlueprint, type BlueprintStep, type PayCadence } from '@/lib/engine/automation/blueprint';
import { coastFI, fiNumberCents, monthsToFI } from '@/lib/engine/fi/fi';
import {
  detectLifestyleCreep,
  findOpportunities,
  hoursOfWork,
  monthlyFlows,
  monthsOfRunway,
  type CreepResult,
  type MonthlyFlow,
  type Opportunity,
} from '@/lib/engine/fi/insights';
import { generateMoneyReview, type MoneyReview } from '@/lib/engine/fi/coach-copy';
import { buildReviewCandidates, selectReview, type ReviewRole } from '@/lib/engine/fi/money-review';
import { orderReviewViaLLM } from './money-review-llm';
import { parseStoredDials } from '@/lib/engine/settings/dials';
import { normalizeMerchant } from '@/lib/engine/categorize/normalize';
import { formatISODate } from '@/lib/dates';
import { prisma } from '@/lib/db';
import { getProvider } from '@/lib/providers/demo';
import { getCategoryMeta } from '@/server/category-meta';

export interface CoachData {
  today: string;
  flows: MonthlyFlow[]; // last 12 full months, ascending
  currentRateBps: number | null;
  fi: {
    fiNumberCents: Cents;
    annualExpensesCents: Cents;
    portfolioCents: Cents;
    monthlySavingsCents: Cents;
    monthlyIncomeCents: Cents;
    monthsToFI: number | null;
    coastIsCoast: boolean;
    coastRequiredMonthlyCents: Cents | null;
    swrBps: number;
    expectedReturnBps: number;
    coastTargetYears: number;
  };
  opportunities: Opportunity[];
  creep: CreepResult;
  runwayMonths: number;
  lifeEnergy: { merchant: string; amountCents: number; hours: number; date: string }[];
  hourlyWageCents: number;
  moneyDials: string[];
  review: MoneyReview;
  /** §2.4 candidate-set recap shown on /coach — each line a verbatim COACH_COPY string. */
  reviewLines: { id: string; role: ReviewRole; line: string }[];
  /** True iff the LLM ordered the recap this render; false on the deterministic floor (demo/zero-key). */
  reviewPersonalized: boolean;
  blueprint: BlueprintStep[];
}

const COAST_TARGET_YEARS = 25;

export async function getCoachData(
  userId: string,
  opts?: { orderReview?: boolean },
): Promise<CoachData> {
  const provider = getProvider();
  const today = provider.today(userId);
  const snap = await provider.getFinanceSnapshot(userId);
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new Error('User not found');
  const meta = await getCategoryMeta(userId); // custom-category aware creep (DECISIONS #111)

  const txns = snap.transactions.map((t, i) => ({
    id: (t as { id?: string }).id ?? `txn-${i}`,
    date: t.date,
    amountCents: t.amountCents,
    rawDescriptor: t.rawDescriptor,
    accountId: t.accountId,
    isTransfer: t.isTransfer,
    status: t.status,
    isSplitParent: t.isSplitParent ?? false,
    categoryId: (t as { categoryId?: string | null }).categoryId ?? null,
    splitParentId: (t as { splitParentId?: string | null }).splitParentId ?? null,
  }));

  const allFlows = monthlyFlows(txns);
  const currentMonth = today.slice(0, 7);
  const fullFlows = allFlows.filter((f) => f.month < currentMonth);
  const flows = fullFlows.slice(-12);
  const last6 = fullFlows.slice(-6);

  const expenses6 = last6.reduce((s, f) => s + f.expensesCents, 0);
  const income6 = last6.reduce((s, f) => s + f.incomeCents, 0);
  const annualExpenses = cents(expenses6 * 2);
  // documented rounding rule, not Math.round (half-toward-+∞ on negatives)
  const monthlySavings = roundHalfAwayFromZero((income6 - expenses6) / Math.max(1, last6.length));
  const monthlyIncome = roundHalfAwayFromZero(income6 / Math.max(1, last6.length));

  const portfolio = cents(
    snap.accounts.filter((a) => a.type === 'INVESTMENT').reduce((s, a) => s + a.currentBalanceCents, 0),
  );
  const liquid = cents(
    snap.accounts
      .filter((a) => a.type === 'CHECKING' || a.type === 'SAVINGS')
      .reduce((s, a) => s + a.currentBalanceCents, 0),
  );

  const fiTarget = fiNumberCents(annualExpenses, user.swrBps);
  const months = monthsToFI(portfolio, monthlySavings, user.expectedReturnBps, fiTarget);
  const coast = coastFI(portfolio, fiTarget, user.expectedReturnBps, COAST_TARGET_YEARS * 12);

  const series = detectRecurring(
    txns.filter((t) => t.status === 'POSTED' && !t.isSplitParent),
    today,
  );
  const opportunities = findOpportunities(series, user.expectedReturnBps);
  const creep = detectLifestyleCreep(txns, today, 6, meta);
  // documented rounding rule, not Math.round (consistency with monthlySavings above)
  const avgMonthlyExpenses = cents(roundHalfAwayFromZero(expenses6 / Math.max(1, last6.length)));
  const runway = monthsOfRunway(liquid, avgMonthlyExpenses);

  // life-energy view: 5 largest non-transfer purchases in the last 90 days
  const cutoff = addMonthsClamped(today, -3);
  const wage = user.hourlyWageCents ?? 0;
  const lifeEnergy = txns
    .filter(
      (t) =>
        !t.isTransfer && !t.isSplitParent && t.status === 'POSTED' && t.amountCents < 0 && t.date >= cutoff,
    )
    .sort((a, b) => a.amountCents - b.amountCents)
    .slice(0, 5)
    .map((t) => ({
      merchant: normalizeMerchant(t.rawDescriptor).canonical,
      amountCents: t.amountCents,
      hours: hoursOfWork(cents(t.amountCents), wage),
      date: t.date,
    }));

  // the Money Review's "one next action" prefers the live cash-needed remedy
  // (single shared assembly path — cycle-1 H1)
  const { result: cash } = cashNeededFromSnapshot(snap, today, 'PAY_IN_FULL');

  // Automation blueprint (P0.5): pay-yourself-first savings + card cash buffers,
  // phrased downstream as standing instructions to set up at the user's bank —
  // Aimplifi reminds, it never moves money (reminders/select.ts invariant).
  const goalRows = await prisma.goal.findMany({
    where: { userId },
    select: { name: true, monthlyContributionCents: true },
  });
  const topIncome = series
    .filter((s) => s.isIncome)
    .sort((a, b) => b.typicalAmountCents - a.typicalAmountCents)[0];
  const payCadence: PayCadence =
    topIncome &&
    (topIncome.cadence === 'WEEKLY' || topIncome.cadence === 'BIWEEKLY' || topIncome.cadence === 'MONTHLY')
      ? topIncome.cadence
      : null;
  const blueprint = buildAutomationBlueprint({
    paycheck: topIncome ? { cadence: payCadence, amountCents: topIncome.typicalAmountCents } : null,
    savings: goalRows
      .filter((g) => (g.monthlyContributionCents ?? 0) > 0)
      .map((g) => ({ name: g.name, monthlyCents: g.monthlyContributionCents as number })),
    cards: cash.cards.map((c) => ({
      cardName: c.cardName,
      dueDate: c.effectiveDueDate,
      cashRequiredCents: c.cashRequiredCents,
      // Estimated next-cycle obligations (no statement yet) are dropped by the
      // blueprint engine — a "set autopay to the statement balance" instruction
      // needs a real statement, and this matches the cash-needed headline (#98).
      isEstimated: c.isEstimated,
    })),
  });

  const pendingTransfer = cash.headline.recommendation
    ? {
        amountCents: cash.headline.recommendation.amountCents,
        byDate: formatISODate(isoDate(cash.headline.recommendation.byDate)),
      }
    : null;
  // The 3-field object stays UNCHANGED — dashboard, return-moment, and the digest email
  // all consume it (AI plan §2.4: keep the incumbent surfaces untouched, blast-radius).
  const review = generateMoneyReview({ flows, creep, opportunities, runwayMonths: runway, pendingTransfer });

  // §2.4 candidate-set recap for the /coach card: the optional key-gated LLM only ORDERS a
  // closed set of ids; `selectReview` re-validates in-set, pins the material action, backfills
  // the deterministic floor, and the lines are rendered verbatim. The LLM ordering call is
  // gated to the /coach path (`opts.orderReview`) — every OTHER `getCoachData` caller (dashboard,
  // goals, investments, assistant, the per-user digest cron) gets the deterministic floor with
  // NO model call and no data egress (critic P1-1). No key / any failure → the floor (== `review`).
  const reviewCandidates = buildReviewCandidates({ flows, creep, opportunities, runwayMonths: runway, pendingTransfer });
  const reviewOrder = opts?.orderReview ? await orderReviewViaLLM(reviewCandidates) : null;
  const reviewSelected = selectReview(reviewCandidates, reviewOrder);
  const reviewLines = reviewSelected.map((c) => ({ id: c.id, role: c.role, line: c.line }));
  // Honest badge: "Personalized" only when the LLM path actually CHANGED the recap vs the floor.
  const floorLines = selectReview(reviewCandidates, null);
  const reviewPersonalized =
    reviewOrder !== null &&
    reviewSelected.map((c) => c.line).join('') !== floorLines.map((c) => c.line).join('');

  return {
    today,
    flows,
    currentRateBps: flows[flows.length - 1]?.savingsRateBps ?? null,
    fi: {
      fiNumberCents: fiTarget,
      annualExpensesCents: annualExpenses,
      portfolioCents: portfolio,
      monthlySavingsCents: monthlySavings,
      monthlyIncomeCents: monthlyIncome,
      monthsToFI: months,
      coastIsCoast: coast.isCoastFI,
      coastRequiredMonthlyCents: coast.requiredMonthlyContributionCents,
      swrBps: user.swrBps,
      expectedReturnBps: user.expectedReturnBps,
      coastTargetYears: COAST_TARGET_YEARS,
    },
    opportunities,
    creep,
    runwayMonths: runway,
    lifeEnergy,
    hourlyWageCents: wage,
    moneyDials: parseStoredDials(user.moneyDials),
    review,
    reviewLines,
    reviewPersonalized,
    blueprint,
  };
}
