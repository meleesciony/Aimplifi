'use server';

/**
 * Goal mutations (Phase 4). Session + ownership verified; audit-logged.
 */
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { cents, formatCents, parseDollarInput } from '@/lib/money';
import { auditLog, requireUserId } from '@/server/authz';
import { getProvider } from '@/lib/providers/demo';
import { formatMonth, isoDate, type ISODate } from '@/lib/dates';
import { loadDebtAccounts } from '@/server/debt';
import { getSpendingPlan } from '@/server/spending-plan';
import { RESERVE_KIND } from '@/lib/engine/spending-plan/reserves';
import { DEMO_ENTRY_BLOCKED, isDemoUser } from '@/lib/demo-user';
import { goalNameError } from '@/lib/engine/goals/goal-name';
import { solveDebtFreeByDate } from '@/lib/engine/solve/debt-free-by-date';
import { solveSavingsGoalByDate } from '@/lib/engine/solve/savings-goal-by-date';
import { RETIREMENT_ASSUMPTIONS } from '@/lib/engine/investments/retirement';

export interface GoalFormResult {
  ok: boolean;
  /** Whole-form refusal (demo fence, missing row). Not a field typo. */
  error?: string;
  /** Per-field messages when validation failed — rendered inline by GoalForm. */
  errors?: { name?: string; target?: string; monthly?: string; targetDate?: string };
}

/**
 * Result-returning action (#166): validation problems return inline field
 * errors instead of throwing — a typo ("$10,000", "abc") must never crash the
 * page to the app error boundary. Amounts parse leniently via parseDollarInput.
 * Invoked DIRECTLY from GoalForm's onSubmit (the #164 pattern), not via a
 * form action; the (prev, formData) signature stays useActionState-compatible.
 */
export async function createGoal(
  _prev: GoalFormResult | null,
  formData: FormData,
): Promise<GoalFormResult> {
  const userId = await requireUserId();
  const name = String(formData.get('name') ?? '').trim();
  const target = String(formData.get('target') ?? '').trim();
  const monthly = String(formData.get('monthly') ?? '').trim();

  const errors: NonNullable<GoalFormResult['errors']> = {};
  if (!name) errors.name = 'Give the goal a name.';
  const targetCents = parseDollarInput(target);
  if (targetCents === null || targetCents <= 0) {
    errors.target = 'Enter an amount above $0 — like 10000 or $10,000.';
  }
  let monthlyCents: number | null = null;
  if (monthly) {
    monthlyCents = parseDollarInput(monthly);
    if (monthlyCents === null || monthlyCents <= 0) {
      errors.monthly = 'Enter a monthly amount above $0, or leave it blank.';
    }
  }
  if (errors.name || errors.target || errors.monthly) return { ok: false, errors };

  await prisma.goal.create({
    data: {
      userId,
      name,
      targetCents: targetCents!,
      savedCents: 0,
      monthlyContributionCents: monthlyCents,
    },
  });
  await auditLog(userId, 'goal.create', { name });
  revalidatePath('/goals');
  return { ok: true };
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

/**
 * Save a "retire at <age>" plan from the Ask Aimplifi answer (DECISIONS #131).
 *
 * Unlike the debt/savings goals, a retirement target is NOT a flat savings Goal — the
 * decumulation engine compounds returns net of inflation, so a flat ceil(remaining/months)
 * Goal would contradict it (the EDGE_CASES "card consistency" precedent). Instead this persists
 * the chosen age to the existing User.retirementAge dial — the SAME field the /investments
 * outlook + what-if already read on every render, so the plan can't drift and nothing is
 * duplicated. The required monthly contribution is informational, re-solved live on /investments;
 * we store only the user's stated age.
 *
 * Security / no-fabrication: the client sends ONLY the age (no derived figure). The server
 * re-validates it against DIAL_LIMITS.retirementAge [18,110] AND the cross-field ordering
 * (current age ≤ retirement age < plan-through age) the dials validator enforces, reading the
 * user's other ages (coalesced to the documented defaults). Throws on an invalid/out-of-order age.
 */
export async function saveRetirementAge(targetAgeRaw: number): Promise<void> {
  const userId = await requireUserId();
  const targetAge = Math.round(Number(targetAgeRaw));
  if (!Number.isInteger(targetAge) || targetAge < 18 || targetAge > 110) {
    throw new Error('Invalid retirement age');
  }

  // Enforce the SAME cross-field ordering as the dials validator, on EFFECTIVE values
  // (the user's set age, else the documented default) so whatever persists stays engine-valid.
  const row = await prisma.user.findUnique({
    where: { id: userId },
    select: { currentAge: true, endAge: true },
  });
  const effCurrent = row?.currentAge ?? RETIREMENT_ASSUMPTIONS.currentAge;
  const effEnd = row?.endAge ?? RETIREMENT_ASSUMPTIONS.endAge;
  if (targetAge < effCurrent) throw new Error('Retirement age can’t be before your current age.');
  if (effEnd <= targetAge) throw new Error('Plan-through age must be after your retirement age.');

  await prisma.user.update({ where: { id: userId }, data: { retirementAge: targetAge } });
  await auditLog(userId, 'settings.dials.update', { retirementAge: targetAge });
  // The retirement outlook (and the planning dials on Settings/Coach) read this value.
  revalidatePath('/investments');
  revalidatePath('/settings');
  revalidatePath('/coach');
}

export async function deleteGoal(goalId: string): Promise<void> {
  const userId = await requireUserId();
  // C.23 critic P2-1: a reserve is a PAIR (the row + its NOT_BILL override);
  // deleting it outside the reserve path would orphan the override and the
  // bill would leave every figure. The goals page never offers a reserve (it
  // excludes them), so refuse rather than route — the reserve path owns the
  // pair. The OR keeps `kind: null` savings goals matching (`kind <> 'reserve'`
  // is NULL for a NULL kind — the #412 P0 lesson).
  const { count } = await prisma.goal.deleteMany({
    where: { id: goalId, userId, OR: [{ kind: null }, { kind: { not: RESERVE_KIND } }] },
  });
  if (count === 0) {
    throw new Error('That goal does not exist, or it is a reserve — a reserve is removed from your plan page.');
  }
  await auditLog(userId, 'goal.delete', { goalId });
  revalidatePath('/goals');
}

/**
 * Rename a savings goal already on /goals. Dollars stay put — target,
 * saved, monthly contribution, and target date are untouched. Reserves
 * and debt-free rows are refused (those are not savings goals).
 * Demo cannot learn.
 */
export async function renameGoal(
  goalId: string,
  formData: FormData,
): Promise<GoalFormResult> {
  const userId = await requireUserId();
  if (isDemoUser(userId)) return { ok: false, error: DEMO_ENTRY_BLOCKED };

  const nameRaw = String(formData.get('name') ?? '');
  const nameErr = goalNameError(nameRaw);
  if (nameErr) return { ok: false, errors: { name: nameErr } };
  const name = nameRaw.trim();

  const id = typeof goalId === 'string' ? goalId.trim() : '';
  if (!id) {
    return { ok: false, error: "That goal isn't on your list, so nothing changed." };
  }

  const updated = await prisma.goal.updateMany({
    where: { id, userId, kind: null },
    data: { name },
  });
  if (updated.count === 0) {
    return { ok: false, error: "That goal isn't on your list, so nothing changed." };
  }
  await auditLog(userId, 'goal.rename', { goalId: id, name });
  revalidatePath('/goals');
  revalidatePath('/coach');
  return { ok: true };
}


/**
 * Change a savings goal's target already on /goals. Name, saved,
 * monthly contribution, and target date stay put. Reserves and
 * debt-free rows are refused. Demo cannot learn.
 */
export async function updateGoalTarget(
  goalId: string,
  formData: FormData,
): Promise<GoalFormResult> {
  const userId = await requireUserId();
  if (isDemoUser(userId)) return { ok: false, error: DEMO_ENTRY_BLOCKED };

  const id = typeof goalId === 'string' ? goalId.trim() : '';
  if (!id) {
    return { ok: false, error: "That goal isn't on your list, so nothing changed." };
  }

  const target = String(formData.get('target') ?? '').trim();
  const targetCents = parseDollarInput(target);
  if (targetCents === null || targetCents <= 0) {
    return {
      ok: false,
      errors: { target: 'Enter an amount above $0 — like 10000 or $10,000.' },
    };
  }

  const updated = await prisma.goal.updateMany({
    where: { id, userId, kind: null },
    data: { targetCents },
  });
  if (updated.count === 0) {
    return { ok: false, error: "That goal isn't on your list, so nothing changed." };
  }
  await auditLog(userId, 'goal.updateTarget', { goalId: id, targetCents });
  revalidatePath('/goals');
  revalidatePath('/coach');
  return { ok: true };
}

/**
 * Change a savings goal's monthly contribution already on /goals. Name,
 * target, saved, and target date stay put. Reserves and debt-free rows
 * are refused. Demo cannot learn.
 */
export async function updateGoalMonthly(
  goalId: string,
  formData: FormData,
): Promise<GoalFormResult> {
  const userId = await requireUserId();
  if (isDemoUser(userId)) return { ok: false, error: DEMO_ENTRY_BLOCKED };

  const id = typeof goalId === 'string' ? goalId.trim() : '';
  if (!id) {
    return { ok: false, error: "That goal isn't on your list, so nothing changed." };
  }

  const monthly = String(formData.get('monthly') ?? '').trim();
  const monthlyCents = parseDollarInput(monthly);
  if (monthlyCents === null || monthlyCents <= 0) {
    return {
      ok: false,
      errors: { monthly: 'Enter a monthly amount above $0 — like 500 or $500.' },
    };
  }

  const updated = await prisma.goal.updateMany({
    where: { id, userId, kind: null },
    data: { monthlyContributionCents: monthlyCents },
  });
  if (updated.count === 0) {
    return { ok: false, error: "That goal isn't on your list, so nothing changed." };
  }
  await auditLog(userId, 'goal.updateMonthly', { goalId: id, monthlyCents });
  revalidatePath('/goals');
  revalidatePath('/coach');
  return { ok: true };
}

/**
 * Change a savings goal's target date already on /goals. Name, target,
 * saved, and monthly contribution stay put. Reserves and debt-free rows
 * are refused. Demo cannot learn. Month (YYYY-MM) stores as the first of
 * that month. Does not re-solve monthly from the date.
 */
export async function updateGoalTargetDate(
  goalId: string,
  formData: FormData,
): Promise<GoalFormResult> {
  const userId = await requireUserId();
  if (isDemoUser(userId)) return { ok: false, error: DEMO_ENTRY_BLOCKED };

  const id = typeof goalId === 'string' ? goalId.trim() : '';
  if (!id) {
    return { ok: false, error: "That goal isn't on your list, so nothing changed." };
  }

  const raw = String(formData.get('targetDate') ?? '').trim();
  let next: ISODate | null = null;
  try {
    if (/^\d{4}-(0[1-9]|1[0-2])$/.test(raw)) {
      next = isoDate(`${raw}-01`);
    } else {
      next = isoDate(raw);
    }
  } catch {
    next = null;
  }
  if (!next) {
    return {
      ok: false,
      errors: { targetDate: 'Enter a month — like 2027-06.' },
    };
  }

  const updated = await prisma.goal.updateMany({
    where: { id, userId, kind: null },
    data: { targetDate: next },
  });
  if (updated.count === 0) {
    return { ok: false, error: "That goal isn't on your list, so nothing changed." };
  }
  await auditLog(userId, 'goal.updateTargetDate', { goalId: id, targetDate: next });
  revalidatePath('/goals');
  revalidatePath('/coach');
  return { ok: true };
}

/**
 * Clear a savings goal's monthly contribution already on /goals. Name,
 * target, saved, and target date stay put. Reserves, debt-free rows,
 * and goals with no monthly refuse. Demo cannot learn. Null, not zero.
 */
export async function clearGoalMonthly(goalId: string): Promise<GoalFormResult> {
  const userId = await requireUserId();
  if (isDemoUser(userId)) return { ok: false, error: DEMO_ENTRY_BLOCKED };

  const id = typeof goalId === 'string' ? goalId.trim() : '';
  if (!id) {
    return { ok: false, error: "That goal isn't on your list, so nothing changed." };
  }

  const updated = await prisma.goal.updateMany({
    where: { id, userId, kind: null, monthlyContributionCents: { gt: 0 } },
    data: { monthlyContributionCents: null },
  });
  if (updated.count === 0) {
    return { ok: false, error: "That goal isn't on your list, so nothing changed." };
  }
  await auditLog(userId, 'goal.clearMonthly', { goalId: id });
  revalidatePath('/goals');
  revalidatePath('/coach');
  return { ok: true };
}
