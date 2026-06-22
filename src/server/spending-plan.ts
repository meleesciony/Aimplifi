/**
 * Spending Plan data (DECISIONS #66). Derives this month's expected income,
 * spending so far, upcoming recurring bills, and planned savings from the same
 * snapshot every other view uses, then runs the pure engine.
 */
import { prisma } from '@/lib/db';
import { monthlyFlows } from '@/lib/engine/fi/insights';
import { computeSpendingPlan, daysInMonth, type SpendingPlan } from '@/lib/engine/spending-plan/plan';
import { getProvider } from '@/lib/providers/demo';

export async function getSpendingPlan(userId: string): Promise<SpendingPlan> {
  const provider = getProvider();
  const today = provider.today(userId);
  const ym = today.slice(0, 7);
  const snap = await provider.getFinanceSnapshot(userId);

  // Received income + spending already posted this month.
  const month = monthlyFlows(snap.transactions).find((f) => f.month === ym);
  const receivedIncomeCents = month?.incomeCents ?? 0;
  const spentSoFarCents = month?.expensesCents ?? 0;

  // Scheduled items still to come this month: bills (out) and income (in).
  const endOfMonth = `${ym}-${String(daysInMonth(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)))).padStart(2, '0')}`;
  let upcomingBillsCents = 0;
  let remainingIncomeCents = 0;
  for (const s of snap.scheduled) {
    if (s.nextDate > today && s.nextDate <= endOfMonth) {
      if (s.amountCents < 0) upcomingBillsCents += -s.amountCents;
      else remainingIncomeCents += s.amountCents;
    }
  }

  // Planned savings = active goals' monthly contributions.
  const goals = await prisma.goal.findMany({ where: { userId }, select: { monthlyContributionCents: true } });
  const plannedSavingsCents = goals.reduce((sum, g) => sum + (g.monthlyContributionCents ?? 0), 0);

  return computeSpendingPlan({
    today,
    expectedIncomeCents: receivedIncomeCents + remainingIncomeCents,
    spentSoFarCents,
    upcomingBillsCents,
    plannedSavingsCents,
  });
}
