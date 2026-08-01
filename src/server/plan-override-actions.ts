'use server';

/**
 * User-set Plan figures (DECISIONS #372): income + fixed overrides, and the
 * savings-% dial when submitted from /spending-plan. Demo writes are fenced.
 */
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { auditLog, requireUserId } from '@/server/authz';
import { DEMO_ENTRY_BLOCKED, isDemoUser } from '@/lib/demo-user';
import {
  parsePlanOverrides,
  type PlanOverrideFieldErrors,
} from '@/lib/engine/spending-plan/overrides';

export interface PlanOverrideResult {
  ok: boolean;
  error?: string;
  errors?: PlanOverrideFieldErrors;
}

export async function updatePlanFigures(
  _prev: PlanOverrideResult | null,
  formData: FormData,
): Promise<PlanOverrideResult> {
  const userId = await requireUserId();
  if (isDemoUser(userId)) return { ok: false, error: DEMO_ENTRY_BLOCKED };

  const parsed = parsePlanOverrides({
    income: String(formData.get('income') ?? ''),
    fixed: String(formData.get('fixed') ?? ''),
    savingsTarget: String(formData.get('savingsTarget') ?? ''),
  });
  if (!parsed.ok) return { ok: false, errors: parsed.errors };

  const { incomeOverrideCents, fixedOverrideCents, savingsTargetBps, savingsTargetProvided } =
    parsed.value;

  await prisma.user.update({
    where: { id: userId },
    data: {
      planIncomeOverrideCents: incomeOverrideCents,
      planFixedOverrideCents: fixedOverrideCents,
      ...(savingsTargetProvided ? { savingsTargetBps } : {}),
    },
  });

  await auditLog(userId, 'plan.figures.update', {
    hasIncomeOverride: incomeOverrideCents != null,
    hasFixedOverride: fixedOverrideCents != null,
    savingsTargetProvided,
    hasSavingsTarget: savingsTargetBps != null,
  });

  revalidatePath('/spending-plan');
  revalidatePath('/dashboard');
  revalidatePath('/budgets');
  revalidatePath('/settings');

  return { ok: true };
}
