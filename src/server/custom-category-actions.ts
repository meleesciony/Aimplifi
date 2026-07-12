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
import { CATEGORIES } from '@/lib/engine/categorize/categories';
import { CUSTOM_CATEGORY_GROUPS } from '@/lib/engine/categorize/assign';
import { auditLog, requireUserId } from '@/server/authz';
import { ensureCategories } from '@/server/ensure-categories';

export interface CategoryActionResult {
  ok: boolean;
  error?: string;
  id?: string;
}

const MAX_NAME = 40;
/** Built-in category names (lowercased) — a custom can't shadow one (would render twice). */
const SYSTEM_NAMES = new Set(CATEGORIES.map((c) => c.name.toLowerCase()));
/** Valid parent groups a custom may join — SPENDING groups only (critic F4). */
const KNOWN_GROUPS = new Set(CUSTOM_CATEGORY_GROUPS);

/** Picker/analytics sources that read categories — refresh them after any change. */
const REVALIDATE = ['/settings', '/transactions', '/transactions/new', '/triage', '/budgets', '/reports', '/trends', '/coach', '/recurring'];
function revalidateAll(): void {
  for (const p of REVALIDATE) revalidatePath(p);
}

/** Collapse internal whitespace and trim, so " Golf  Club " === "Golf Club". */
function normalizeName(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ');
}

function validateName(name: string): string | null {
  if (!name) return 'Enter a category name';
  if (name.length > MAX_NAME) return `Keep the name under ${MAX_NAME} characters`;
  if (SYSTEM_NAMES.has(name.toLowerCase())) return 'That matches a built-in category — pick a different name';
  return null;
}

/** P2002 = the per-user unique([userId, name]) constraint — a friendly duplicate message. */
function isUniqueViolation(e: unknown): boolean {
  return (e as { code?: string })?.code === 'P2002';
}

/**
 * Case-insensitive per-user duplicate check (critic F6). The DB @@unique is
 * case-SENSITIVE and Prisma's `mode: 'insensitive'` is Postgres-only, so we
 * compare in JS for portability across SQLite (dev/test) and Postgres (prod) —
 * blocking "Golf" vs "golf" before they can collide in the CSV name resolver.
 * The DB constraint remains the backstop for an exact-case race (P2002).
 */
async function isDuplicateName(userId: string, name: string, exceptId?: string): Promise<boolean> {
  const existing = await prisma.category.findMany({
    where: { userId, isSystem: false },
    select: { id: true, name: true },
  });
  const lower = name.toLowerCase();
  return existing.some((c) => c.id !== exceptId && c.name.toLowerCase() === lower);
}

export async function createCustomCategory(input: {
  name: string;
  group: string;
  discretionary: boolean;
}): Promise<CategoryActionResult> {
  const userId = await requireUserId();
  const name = normalizeName(input.name ?? '');
  const nameErr = validateName(name);
  if (nameErr) return { ok: false, error: nameErr };
  const group = (input.group ?? '').trim();
  if (!group || !KNOWN_GROUPS.has(group)) return { ok: false, error: 'Choose a group for it' };
  if (await isDuplicateName(userId, name)) {
    return { ok: false, error: 'You already have a category with that name' };
  }

  try {
    const row = await prisma.category.create({
      data: { userId, name, group, discretionary: !!input.discretionary, isSystem: false },
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
  const name = normalizeName(input.name ?? '');
  const nameErr = validateName(name);
  if (nameErr) return { ok: false, error: nameErr };

  // Ownership: only a custom row this user owns can be renamed (never a system row).
  const owned = await prisma.category.findFirst({
    where: { id: input.id, userId, isSystem: false },
    select: { id: true },
  });
  if (!owned) return { ok: false, error: 'Category not found' };
  if (await isDuplicateName(userId, name, input.id)) {
    return { ok: false, error: 'You already have a category with that name' };
  }

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
