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
import { normalizeMerchant } from '@/lib/engine/categorize/normalize';
import { formatISODate } from '@/lib/dates';
import { prisma } from '@/lib/db';
import { getProvider } from '@/lib/providers/demo';

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
}

const COAST_TARGET_YEARS = 25;

export async function getCoachData(userId: string): Promise<CoachData> {
  const provider = getProvider();
  const today = provider.today();
  const snap = await provider.getFinanceSnapshot(userId);
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw new Error('User not found');

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
  const creep = detectLifestyleCreep(txns, today);
  const avgMonthlyExpenses = cents(Math.round(expenses6 / Math.max(1, last6.length)));
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
  const review = generateMoneyReview({
    flows,
    creep,
    opportunities,
    runwayMonths: runway,
    pendingTransfer: cash.headline.recommendation
      ? {
          amountCents: cash.headline.recommendation.amountCents,
          byDate: formatISODate(isoDate(cash.headline.recommendation.byDate)),
        }
      : null,
  });

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
    moneyDials: user.moneyDials ? (JSON.parse(user.moneyDials) as string[]) : [],
    review,
  };
}
