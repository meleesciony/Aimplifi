'use server';

/**
 * Renaming a BUILT-IN category, per user (O.17).
 *
 * The system `Category` rows are global (`userId = null`) and are the FK target
 * of every user's transactions, so `Category.name` is shared: editing it would
 * relabel a stranger's reports. A rename is therefore an overlay row in
 * `CategoryRename`, applied in one loader (`getCategoryOverlay`).
 *
 * "One loader, therefore every reader" was the first version of this sentence and
 * it was FALSE, caught by two independent critics: the pickers read the loader,
 * but the register, the transaction detail and split parts each resolved their
 * label from the joined `Category.name` instead, so the row said "Doctor" while
 * its own inline picker said "Dr Visits". Those three now share
 * `categoryLabel()` in server/transactions.ts; Ask resolves through
 * `resolveSpendTarget`; the CSV importer accepts these names so an export round
 * trip survives. The list of readers is a CLAIM — check it against the code
 * before repeating it, and grep for `Category.name` joins before adding one.
 *
 * Only the NAME is overridable. `group` decides income-vs-spending in fourteen
 * predicates and `discretionary` feeds lifestyle-creep detection; neither is a
 * label, so neither is offered. Nothing about any figure changes: this renames
 * what a category is CALLED, never what counts toward it.
 */
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import { auditLog, requireUserId } from '@/server/authz';
import {
  CATEGORY_BY_ID,
  MAX_CATEGORY_NAME,
  categoryNameLength,
  normalizeCategoryName,
} from '@/lib/engine/categorize/categories';
import { NON_HIDEABLE } from '@/lib/engine/categorize/visibility';
import { visibleCategoryNames } from '@/server/category-meta';
import { DEMO_ENTRY_BLOCKED, isDemoUser } from '@/lib/demo-user';

export interface RenameResult {
  ok: boolean;
  error?: string;
  /** The name now in effect — the built-in one after a reset. */
  name?: string;
}

/** Same surfaces `custom-category-actions` refreshes: every picker and every report. */
const REVALIDATE = [
  '/settings',
  '/transactions',
  '/transactions/new',
  '/triage',
  '/budgets',
  '/reports',
  '/trends',
  '/coach',
  '/recurring',
  // These also print category names and were missing from the list this was
  // copied from: /rules labels each rule by its category, and Ask echoes the
  // category in its answer.
  '/rules',
  '/ask',
];
function revalidateAll(): void {
  for (const p of REVALIDATE) revalidatePath(p);
  // A DYNAMIC route needs its type, or the call is silently a no-op — Next says
  // so at runtime and the detail view would have gone on showing the old name
  // until something else revalidated it.
  revalidatePath('/transactions/[id]', 'page');
}

/**
 * A built-in category the reader may rename. `uncategorized` is refused for the
 * same reason it is NON_HIDEABLE: it is the absence of a decision and the
 * re-file target when a custom category is deleted, so its label is app
 * machinery rather than the reader's vocabulary.
 */
function isRenameable(categoryId: string): boolean {
  return CATEGORY_BY_ID.has(categoryId) && !NON_HIDEABLE.has(categoryId);
}

export async function renameSystemCategory(input: {
  categoryId: string;
  name: string;
}): Promise<RenameResult> {
  const userId = await requireUserId();
  // The demo is ONE shared row, so a name typed here is a name the next
  // anonymous visitor reads — the same leak as a learned phrase (#226) or a
  // household seat (#210), and the same fence `account-rename-actions` puts on
  // renaming an account. Reset stays open: it only removes an override, so it
  // cannot carry a visitor's words forward.
  if (isDemoUser(userId)) return { ok: false, error: DEMO_ENTRY_BLOCKED };
  const categoryId = input.categoryId;
  const builtIn = CATEGORY_BY_ID.get(categoryId);
  if (!builtIn || !isRenameable(categoryId)) {
    return { ok: false, error: 'That category can’t be renamed.' };
  }

  const name = normalizeCategoryName(input.name);
  if (!name) return { ok: false, error: 'Enter a category name' };
  if (categoryNameLength(name) > MAX_CATEGORY_NAME) {
    return { ok: false, error: `Keep the name under ${MAX_CATEGORY_NAME} characters` };
  }

  // Renaming back to the built-in name is a RESET, not a stored no-op row. Kept
  // here rather than only in the UI so the two doors agree: a row whose `name`
  // equals the default would otherwise render `renamed: true` forever and offer
  // a "Reset" that appears to do nothing.
  if (name === builtIn.name) return resetSystemCategoryName({ categoryId });

  const owner = (await visibleCategoryNames(userId)).get(name.toLowerCase());
  if (owner && owner !== categoryId) {
    // Name WHICH row holds it. A bare "already taken" pointing at a category the
    // reader removed from their list sends them hunting for something they
    // cannot see anywhere in the manager.
    const held = CATEGORY_BY_ID.get(owner);
    return {
      ok: false,
      error: held
        ? `“${name}” is already the name of another built-in category`
        : 'You already have a category with that name',
    };
  }

  await prisma.categoryRename.upsert({
    where: { userId_categoryId: { userId, categoryId } },
    create: { userId, categoryId, name },
    update: { name },
  });
  await auditLog(userId, 'category.rename.system', { categoryId, name, from: builtIn.name });
  revalidateAll();
  return { ok: true, name };
}

export async function resetSystemCategoryName(input: {
  categoryId: string;
}): Promise<RenameResult> {
  const userId = await requireUserId();
  const builtIn = CATEGORY_BY_ID.get(input.categoryId);
  if (!builtIn) return { ok: false, error: 'That category can’t be renamed.' };

  // deleteMany, not delete: resetting a category the reader never renamed is a
  // no-op rather than a "not found" they would have to understand.
  await prisma.categoryRename.deleteMany({ where: { userId, categoryId: input.categoryId } });
  await auditLog(userId, 'category.rename.reset', { categoryId: input.categoryId });
  revalidateAll();
  return { ok: true, name: builtIn.name };
}
