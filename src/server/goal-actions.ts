'use server';

/**
 * Goal mutations (Phase 4). Session + ownership verified; audit-logged.
 */
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { centsFromDollarString } from '@/lib/money';
import { auditLog, requireUserId } from '@/server/authz';

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

export async function deleteGoal(goalId: string): Promise<void> {
  const userId = await requireUserId();
  await prisma.goal.deleteMany({ where: { id: goalId, userId } });
  await auditLog(userId, 'goal.delete', { goalId });
  revalidatePath('/goals');
}
