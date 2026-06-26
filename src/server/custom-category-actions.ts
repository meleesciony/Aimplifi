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
import { ASSIGNABLE_GROUPS } from '@/lib/engine/categorize/assign';
import { auditLog, requireUserId } from '@/server/authz';

export interface CategoryActionResult {
  ok: boolean;
  error?: string;
  id?: string;
}

const MAX_NAME = 40;
/** Built-in category names (lowercased) — a custom can't shadow one (would render twice). */
const SYSTEM_NAMES = new Set(CATEGORIES.map((c) => c.name.toLowerCase()));
/** Valid parent groups a custom may join — the existing system groups. */
const KNOWN_GROUPS = new Set(ASSIGNABLE_GROUPS.map((g) => g.group));

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

  // Atomic: re-file this category's transactions as uncategorized, drop the rows
  // that FK it (rules/budgets are REQUIRED FKs → would block the delete; hidden is
  // defensive), then delete the category. The id is a cuid unique to this user's
  // custom row, and every write path is guarded by assertOwnedCategory, so only
  // this user's transactions can reference it.
  await prisma.$transaction([
    prisma.transaction.updateMany({ where: { categoryId: input.id }, data: { categoryId: 'uncategorized' } }),
    prisma.categorizationRule.deleteMany({ where: { userId, categoryId: input.id } }),
    prisma.budget.deleteMany({ where: { userId, categoryId: input.id } }),
    prisma.hiddenCategory.deleteMany({ where: { userId, categoryId: input.id } }),
    prisma.category.delete({ where: { id: input.id } }),
  ]);

  await auditLog(userId, 'category.delete', { id: input.id });
  revalidateAll();
  return { ok: true, id: input.id };
}
