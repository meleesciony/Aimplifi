'use server';

/**
 * Custom category CRUD (DECISIONS #111). A user can create their own categories
 * ("Golf"), rename them, and delete them. Custom rows are `isSystem=false` with a
 * `userId`; name uniqueness is PER-USER (schema @@unique([userId, name])), so two
 * users can each own a "Golf". Every write is ownership-scoped and audit-logged.
 *
 * Deleting reassigns the category's live transactions to the `uncategorized`
 * fallback and removes the config rows that FK it (rules + budgets are REQUIRED
 * FKs and would otherwise block the delete) — all in one atomic transaction.
 */
import { revalidatePath } from 'next/cache';
import { prisma } from '@/lib/db';
import {
  CATEGORY_BY_ID,
  MAX_CATEGORY_NAME,
  categoryNameLength,
  normalizeCategoryName,
} from '@/lib/engine/categorize/categories';
import { CUSTOM_CATEGORY_GROUPS } from '@/lib/engine/categorize/assign';
import { auditLog, requireUserId } from '@/server/authz';
import { visibleCategoryNames } from '@/server/category-meta';
import { DEMO_ENTRY_BLOCKED, isDemoUser } from '@/lib/demo-user';
import { ensureCategories } from '@/server/ensure-categories';

export interface CategoryActionResult {
  ok: boolean;
  error?: string;
  id?: string;
}

/** Valid parent groups a custom may join — SPENDING groups only (critic F4). */
const KNOWN_GROUPS = new Set(CUSTOM_CATEGORY_GROUPS);

/** Picker/analytics sources that read categories — refresh them after any change. */
const REVALIDATE = ['/settings', '/transactions', '/transactions/new', '/triage', '/budgets', '/reports', '/trends', '/coach', '/recurring'];
function revalidateAll(): void {
  for (const p of REVALIDATE) revalidatePath(p);
}

/**
 * Shape-only validation. The DUPLICATE check is deliberately not here: it needs
 * the reader's effective names (a built-in they renamed is spoken for under its
 * NEW name, and free under its old one), which requires the DB — see
 * `visibleCategoryNames`, the one author of that rule for all three doors.
 */
function validateName(name: string): string | null {
  if (!name) return 'Enter a category name';
  if (categoryNameLength(name) > MAX_CATEGORY_NAME) {
    return `Keep the name under ${MAX_CATEGORY_NAME} characters`;
  }
  return null;
}

/**
 * The duplicate rule, shared by create and rename. Compares against what the
 * reader can SEE — built-ins under their effective name plus their own customs —
 * so renaming Groceries to "Food shop" both frees the word "Groceries" for a
 * custom AND stops a custom from taking "Food shop" and rendering twice.
 */
async function nameConflict(
  userId: string,
  name: string,
  exceptId?: string,
): Promise<string | null> {
  const owner = (await visibleCategoryNames(userId)).get(name.toLowerCase());
  if (!owner || owner === exceptId) return null;
  // Which message depends on WHAT holds the name, decided by the taxonomy rather
  // than by the shape of the id (custom ids are cuids and system ids are slugs
  // today, but that is a coincidence to lean on, not a rule).
  return CATEGORY_BY_ID.has(owner)
    ? 'That matches a built-in category — pick a different name'
    : 'You already have a category with that name';
}

/** P2002 = the per-user unique([userId, name]) constraint — a friendly duplicate message. */
function isUniqueViolation(e: unknown): boolean {
  return (e as { code?: string })?.code === 'P2002';
}

export async function createCustomCategory(input: {
  name: string;
  group: string;
}): Promise<CategoryActionResult> {
  const userId = await requireUserId();
  // The demo is ONE shared row: a category name typed here is a name the next
  // anonymous visitor reads, in every picker and every report — the typed leg of
  // the rule in docs/lessons/shared-demo-account-must-not-learn.md, recorded there
  // as open and closed here (O.17).
  if (isDemoUser(userId)) return { ok: false, error: DEMO_ENTRY_BLOCKED };
  const name = normalizeCategoryName(input.name ?? '');
  const nameErr = validateName(name);
  if (nameErr) return { ok: false, error: nameErr };
  const group = (input.group ?? '').trim();
  if (!group || !KNOWN_GROUPS.has(group)) return { ok: false, error: 'Choose a group for it' };
  const conflict = await nameConflict(userId, name);
  if (conflict) return { ok: false, error: conflict };

  try {
    // No discretionary input (2026-08-03: classification is deterministic,
    // never typed in) — the column default (discretionary) applies.
    const row = await prisma.category.create({
      data: { userId, name, group, isSystem: false },
      select: { id: true },
    });
    await auditLog(userId, 'category.create', { id: row.id, name, group });
    revalidateAll();
    return { ok: true, id: row.id };
  } catch (e) {
    if (isUniqueViolation(e)) return { ok: false, error: 'You already have a category with that name' };
    throw e;
  }
}

export async function renameCustomCategory(input: { id: string; name: string }): Promise<CategoryActionResult> {
  const userId = await requireUserId();
  // The demo is ONE shared row: a category name typed here is a name the next
  // anonymous visitor reads, in every picker and every report — the typed leg of
  // the rule in docs/lessons/shared-demo-account-must-not-learn.md, recorded there
  // as open and closed here (O.17).
  if (isDemoUser(userId)) return { ok: false, error: DEMO_ENTRY_BLOCKED };
  const name = normalizeCategoryName(input.name ?? '');
  const nameErr = validateName(name);
  if (nameErr) return { ok: false, error: nameErr };

  // Ownership: only a custom row this user owns can be renamed (never a system row).
  const owned = await prisma.category.findFirst({
    where: { id: input.id, userId, isSystem: false },
    select: { id: true },
  });
  if (!owned) return { ok: false, error: 'Category not found' };
  const conflict = await nameConflict(userId, name, input.id);
  if (conflict) return { ok: false, error: conflict };

  try {
    await prisma.category.update({ where: { id: input.id }, data: { name } });
    await auditLog(userId, 'category.rename', { id: input.id, name });
    revalidateAll();
    return { ok: true, id: input.id };
  } catch (e) {
    if (isUniqueViolation(e)) return { ok: false, error: 'You already have a category with that name' };
    throw e;
  }
}

export async function deleteCustomCategory(input: { id: string }): Promise<CategoryActionResult> {
  const userId = await requireUserId();
  // Shared-demo fence (O.17c critic P2-4). This used to be left open on the premise
  // that "with creation fenced there is nothing on the demo row to delete" — true
  // today (a production probe found 0 demo-owned custom categories) and a premise
  // about a DIFFERENT action, which is the shape that dies quietly when a seed, an
  // import or a backfill becomes a second writer. The blast radius if it ever came
  // back is worse than the hidden-flag write O.17c fenced: the transaction below
  // re-files every transaction in the category, and deletes its rules and budgets,
  // for every visitor sharing the row. A guard for a state that cannot happen yet
  // is cheap; discovering it can happen later is not.
  if (isDemoUser(userId)) return { ok: false, error: DEMO_ENTRY_BLOCKED };
  const owned = await prisma.category.findFirst({
    where: { id: input.id, userId, isSystem: false },
    select: { id: true },
  });
  if (!owned) return { ok: false, error: 'Category not found' };

  // The re-file target `uncategorized` is a FK target on Transaction.categoryId;
  // ensure the system rows exist first (a fresh Postgres deploy that never ran an
  // ingest/seed would otherwise FK-fail — critic F7), mirroring applyCategory.
  await ensureCategories();

  // Atomic: re-file this category's transactions as uncategorized, drop the rows
  // that FK it (rules/budgets are REQUIRED FKs → would block the delete; hidden is
  // defensive), remap the UNCONSTRAINED string refs in the audit/prediction history
  // off the soon-to-be-deleted id (so a later undo can't restore a dangling
  // categoryId and FK-crash — critic F3), then delete the category. The id is a
  // cuid unique to this user's custom row and every write path is guarded by
  // assertOwnedCategory, so only this user's rows can reference it — but that
  // invariant is now defended at exactly ONE gate (slice-6's system-only check
  // on the partner recategorize path), so the transaction re-file carries an
  // explicit owner scope anyway (slice-8 critic B-2): if a custom id ever
  // crosses onto a partner's row through a future defect, this must not become
  // a cross-user bulk write that silently re-files their register.
  await prisma.$transaction([
    prisma.transaction.updateMany({
      where: { categoryId: input.id, account: { userId } },
      data: { categoryId: 'uncategorized' },
    }),
    prisma.correction.updateMany({ where: { userId, fromCategoryId: input.id }, data: { fromCategoryId: 'uncategorized' } }),
    prisma.correction.updateMany({ where: { userId, toCategoryId: input.id }, data: { toCategoryId: 'uncategorized' } }),
    prisma.categoryPrediction.updateMany({ where: { userId, predictedCategoryId: input.id }, data: { predictedCategoryId: 'uncategorized' } }),
    prisma.categoryPrediction.updateMany({ where: { userId, actualCategoryId: input.id }, data: { actualCategoryId: 'uncategorized' } }),
    prisma.categorizationRule.deleteMany({ where: { userId, categoryId: input.id } }),
    prisma.budget.deleteMany({ where: { userId, categoryId: input.id } }),
    prisma.hiddenCategory.deleteMany({ where: { userId, categoryId: input.id } }),
    prisma.category.delete({ where: { id: input.id } }),
  ]);

  await auditLog(userId, 'category.delete', { id: input.id });
  revalidateAll();
  return { ok: true, id: input.id };
}
