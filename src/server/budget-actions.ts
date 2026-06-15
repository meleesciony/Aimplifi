'use server';

/**
 * Budget-target mutations (ROADMAP #7). Session + ownership verified, validated
 * through the pure engine, audit-logged. Budget targets are display/tracking
 * only — they feed the /budgets view and NOTHING else (not cash-needed, not FI,
 * not net worth) — so a target write perturbs no golden value.
 */
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { CATEGORY_BY_ID } from '@/lib/engine/categorize/categories';
import { isBudgetable, parseBudgetTargetCents } from '@/lib/engine/budgets/status';
import { auditLog, requireUserId } from '@/server/authz';

export async function setBudget(formData: FormData): Promise<void> {
  const userId = await requireUserId();
  const categoryId = String(formData.get('categoryId') ?? '').trim();
  // Validate against the SAME set the UI offers (real + budgetable), so the
  // accepted set equals the offered set — a hand-crafted POST can't target
  // income/transfer/uncategorized.
  if (!CATEGORY_BY_ID.has(categoryId) || !isBudgetable(categoryId)) {
    throw new Error('Choose a valid spending category');
  }
  const monthCents = parseBudgetTargetCents(String(formData.get('amount') ?? ''));
  if (monthCents === null) throw new Error('Enter a monthly target greater than $0');

  // One target per (user, category): a single atomic upsert on the compound
  // unique — structurally one row, no find-then-write race (schema @@unique).
  await prisma.budget.upsert({
    where: { userId_categoryId: { userId, categoryId } },
    update: { monthCents },
    create: { userId, categoryId, monthCents },
  });
  await auditLog(userId, 'budget.set', { categoryId, monthCents });
  revalidatePath('/budgets');
}

export async function clearBudget(categoryId: string): Promise<void> {
  const userId = await requireUserId();
  await prisma.budget.deleteMany({ where: { userId, categoryId } });
  await auditLog(userId, 'budget.clear', { categoryId });
  revalidatePath('/budgets');
}
