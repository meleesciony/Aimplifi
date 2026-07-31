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
import { DEMO_CATEGORY_REMOVE_BLOCKED, isDemoUser } from '@/lib/demo-user';

export async function setCategoryHidden(input: {
  categoryId: string;
  hidden: boolean;
}): Promise<{ ok: boolean; error?: string }> {
  const userId = await requireUserId();
  // Shared-demo fence (O.17c). Every anonymous visitor is the SAME row, so one
  // visitor removing a category takes it out of the pickers for everyone after
  // them. Restoring stays open — see DEMO_CATEGORY_REMOVE_BLOCKED for why that
  // direction cannot degrade the demo, and for the test that holds its premise.
  // The Settings UI drops the Remove control for demo; this is the server-side
  // guard on the exposed action endpoint. Ordered before the hideable check so a
  // demo visitor gets the reason true of EVERY id they could send rather than a
  // sentence about this one; locked by the `uncategorized` test, the only input
  // that can tell the two refusals apart.
  if (input.hidden && isDemoUser(userId)) {
    return { ok: false, error: DEMO_CATEGORY_REMOVE_BLOCKED };
  }
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
