'use server';

/**
 * Category visibility mutation (DECISIONS #110). Hiding a category is a per-user
 * preference row — never a delete of the shared system Category — so historical
 * transactions/rules/budgets that point at it stay valid and still render in
 * reports. Every write is ownership-scoped and audit-logged.
 */
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { auditLog, requireUserId } from '@/server/authz';
import { isHideable } from '@/lib/engine/categorize/visibility';

export async function setCategoryHidden(input: {
  categoryId: string;
  hidden: boolean;
}): Promise<{ ok: boolean; error?: string }> {
  const userId = await requireUserId();
  if (!isHideable(input.categoryId)) {
    return { ok: false, error: 'That category can’t be hidden.' };
  }

  if (input.hidden) {
    await prisma.hiddenCategory.upsert({
      where: { userId_categoryId: { userId, categoryId: input.categoryId } },
      create: { userId, categoryId: input.categoryId },
      update: {},
    });
  } else {
    await prisma.hiddenCategory.deleteMany({
      where: { userId, categoryId: input.categoryId },
    });
  }

  await auditLog(userId, 'category.visibility', {
    categoryId: input.categoryId,
    hidden: input.hidden,
  });

  // Picker sources live on these pages; refresh so the change shows immediately.
  revalidatePath('/settings');
  revalidatePath('/triage');
  revalidatePath('/transactions');
  return { ok: true };
}
