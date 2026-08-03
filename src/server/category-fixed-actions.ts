'use server';

/**
 * Set / clear Fixed vs guilt-free designation for a spending category (#376).
 */
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { suggestedCategoryIsFixed } from '@/lib/engine/spending-plan/spend-class';
import { DEMO_ENTRY_BLOCKED, isDemoUser } from '@/lib/demo-user';
import { auditLog, requireUserId } from '@/server/authz';
import { assertOwnedCategory, getCategoryMeta } from '@/server/category-meta';

export type SetCategoryFixedResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Mark a category Fixed (isFixed=true) or Guilt-free (isFixed=false).
 * When the choice matches the app suggestion, the override row is deleted
 * so the suggestion stays the single source of truth until the reader
 * disagrees again.
 */
export async function setCategoryFixed(
  categoryId: string,
  isFixed: boolean,
): Promise<SetCategoryFixedResult> {
  const userId = await requireUserId();
  if (isDemoUser(userId)) return { ok: false, error: DEMO_ENTRY_BLOCKED };

  const id = String(categoryId ?? '').trim();
  if (!id) return { ok: false, error: 'Choose a category.' };
  await assertOwnedCategory(userId, id);

  const meta = await getCategoryMeta(userId);
  const suggested = suggestedCategoryIsFixed(id, meta);
  if (suggested === null) {
    return {
      ok: false,
      error: 'That category is not part of fixed vs guilt-free spending.',
    };
  }

  if (isFixed === suggested) {
    await prisma.categoryFixedOverride.deleteMany({
      where: { userId, categoryId: id },
    });
    await auditLog(userId, 'category-fixed.clear', { categoryId: id, matchedSuggestion: true });
  } else {
    await prisma.categoryFixedOverride.upsert({
      where: { userId_categoryId: { userId, categoryId: id } },
      update: { isFixed },
      create: { userId, categoryId: id, isFixed },
    });
    await auditLog(userId, 'category-fixed.set', { categoryId: id, isFixed });
  }

  revalidatePath('/budgets');
  revalidatePath('/spending-plan');
  revalidatePath('/dashboard');
  revalidatePath('/coach');
  revalidatePath('/transactions');
  return { ok: true };
}
