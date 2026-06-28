'use server';

/**
 * Goal mutations (Phase 4). Session + ownership verified; audit-logged.
 */
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { cents, centsFromDollarString, formatCents } from '@/lib/money';
import { auditLog, requireUserId } from '@/server/authz';
import { getProvider } from '@/lib/providers/demo';
import { formatMonth, isoDate, type ISODate } from '@/lib/dates';
import { loadDebtAccounts } from '@/server/debt';
import { getSpendingPlan } from '@/server/spending-plan';
import { solveDebtFreeByDate } from '@/lib/engine/solve/debt-free-by-date';
import { solveSavingsGoalByDate } from '@/lib/engine/solve/savings-goal-by-date';

export async function createGoal(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const name = String(formData.get('name') ?? '').trim();
  const target = String(formData.get('target') ?? '').trim();
  const monthly = String(formData.get('monthly') ?? '').trim();
  if (!name || !target) throw new Error('Name and target are required');
  const targetCents = centsFromDollarString(target);
  const monthlyCents = monthly ? centsFromDollarString(monthly) : null;
  if (targetCents <= 0) throw new Error('Target must be positive');

  await prisma.goal.create({
    data: {
      userId,
      name,
      targetCents,
      savedCents: 0,
      monthlyContributionCents: monthlyCents,
    },
  });
  await auditLog(userId, 'goal.create', { name });
  revalidatePath('/goals');
}

/**
 * Save a "debt-free by <date>" goal from the Ask Aimplifi answer (DECISIONS #125).
 *
 * Security / no-fabrication: the client sends ONLY the target date — every figure is
 * RE-SOLVED here from the user's own debts + safe-to-spend via solveDebtFreeByDate, so a
 * tampered client can never persist a fabricated payment. Populates the (previously
 * unused) Goal.targetDate, with the solved extra-monthly as the contribution. Throws on
 * an invalid date or a target that isn't actionable (unreachable / already debt-free).
 */
export async function saveDebtFreeGoal(targetDateRaw: string): Promise<void> {
  const userId = await requireUserId();
  let targetDate: ISODate;
  try {
    targetDate = isoDate(String(targetDateRaw ?? ''));
  } catch {
    throw new Error('Invalid target date');
  }

  const today = getProvider().today(userId) as ISODate;
  const [debts, plan] = await Promise.all([loadDebtAccounts(userId), getSpendingPlan(userId)]);
  const result = solveDebtFreeByDate({
    debts,
    strategy: 'avalanche',
    targetDate,
    today,
    safeToSpendCents: plan.leftToSpendCents,
  });
  if (result.outcome === 'unreachable' || result.outcome === 'already-debt-free') {
    throw new Error('That date has no debt-free plan to save');
  }

  await prisma.goal.create({
    data: {
      userId,
      name: `Debt-free by ${formatMonth(targetDate.slice(0, 7))}`,
      targetCents: result.totalBalanceCents,
      savedCents: 0,
      targetDate,
      monthlyContributionCents: result.requiredExtraMonthlyCents ?? 0,
      // Render with the solver's own date on /goals, not the savings-goal timeline (DECISIONS #125).
      kind: 'debt_free',
    },
  });
  await auditLog(userId, 'goal.create', { kind: 'debt_free_by_date', targetDate });
  revalidatePath('/goals');
}

/**
 * Save a "save $X by <date>" goal from the Ask Aimplifi answer (DECISIONS #126).
 *
 * Security / no-fabrication: the client sends the user-STATED target amount + date (both
 * surfaced in the answer the user confirmed). Every DERIVED figure — the required monthly
 * contribution — is RE-SOLVED here from the user's own safe-to-spend via solveSavingsGoalByDate,
 * so a tampered client can never persist a fabricated contribution; the amount is the user's own
 * goal, re-validated to a positive integer. Persists a normal savings goal (kind null) so /goals
 * renders it with the flat funding timeline the flat solver matches by construction, now carrying
 * the target date. Throws on an invalid date/amount or a date that isn't actionable (unreachable).
 */
export async function saveSavingsGoal(targetDateRaw: string, goalAmountCentsRaw: number): Promise<void> {
  const userId = await requireUserId();
  let targetDate: ISODate;
  try {
    targetDate = isoDate(String(targetDateRaw ?? ''));
  } catch {
    throw new Error('Invalid target date');
  }
  const goalAmountCents = Math.round(Number(goalAmountCentsRaw));
  if (!Number.isFinite(goalAmountCents) || goalAmountCents <= 0) throw new Error('Invalid goal amount');

  const today = getProvider().today(userId) as ISODate;
  const plan = await getSpendingPlan(userId);
  const result = solveSavingsGoalByDate({
    goalAmountCents,
    currentSavingsCents: 0,
    targetDate,
    today,
    safeToSpendCents: plan.leftToSpendCents,
  });
  if (result.outcome !== 'reachable') {
    throw new Error('That date has no savings plan to save');
  }

  await prisma.goal.create({
    data: {
      userId,
      name: `${formatCents(cents(goalAmountCents))} by ${formatMonth(targetDate.slice(0, 7))}`,
      targetCents: goalAmountCents,
      savedCents: 0,
      targetDate,
      monthlyContributionCents: result.requiredMonthlyCents ?? 0,
      // kind null → the standard savings card (flat funding ETA, which the flat solver matches),
      // now also showing the target date.
    },
  });
  await auditLog(userId, 'goal.create', { kind: 'savings_goal_by_date', targetDate });
  revalidatePath('/goals');
}

export async function deleteGoal(goalId: string): Promise<void> {
  const userId = await requireUserId();
  await prisma.goal.deleteMany({ where: { id: goalId, userId } });
  await auditLog(userId, 'goal.delete', { goalId });
  revalidatePath('/goals');
}
