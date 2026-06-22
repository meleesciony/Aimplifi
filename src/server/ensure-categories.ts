/**
 * Idempotently ensure every system Category row exists (DECISIONS #63).
 *
 * Transaction.categoryId is a FK to Category. The categorizer can emit any id in
 * CATEGORIES, but a Postgres deploy only runs `db push` (schema), never re-seeds
 * category rows — so a newly-added category has no row and persisting a txn with
 * it throws a foreign-key violation. Calling this before any ingest upserts the
 * full set (categories are global + tiny). Cached per server instance.
 */
import { prisma } from '@/lib/db';
import { CATEGORIES } from '@/lib/engine/categorize/categories';

let ensured = false;

export async function ensureCategories(): Promise<void> {
  if (ensured) return;
  for (const c of CATEGORIES) {
    await prisma.category.upsert({
      where: { id: c.id },
      create: { id: c.id, name: c.name, isSystem: true },
      update: {}, // never touch name on existing rows (name is @unique)
    });
  }
  ensured = true;
}
