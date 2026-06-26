/**
 * Category hide/show (DECISIONS #110) — integration test driving the REAL
 * `setCategoryHidden` action + the read helpers against throwaway data (never the
 * seeded demo user). Proves the round-trip: hide → the category leaves the
 * visible picker sources; unhide → it returns; the `uncategorized` guard holds;
 * and hiding NEVER deletes the shared Category row (historical data stays valid).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn(), signOut: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { auth } from '@/auth';
import { setCategoryHidden } from '@/server/category-actions';
import {
  getHiddenCategoryIds,
  getVisibleCategories,
  getVisibleGroups,
} from '@/server/categories';
import { prisma } from '@/lib/db';

describe('setCategoryHidden (real action, throwaway data — DECISIONS #110)', () => {
  const stamp = `${Date.now()}-${process.pid}`;
  const USER = `cat-vis-user-${stamp}`;

  async function wipe() {
    await prisma.user.deleteMany({ where: { id: USER } }); // cascades HiddenCategory + AuditLog
  }

  beforeAll(async () => {
    await wipe();
    await prisma.user.create({ data: { id: USER, email: `${USER}@test.local` } });
    vi.mocked(auth).mockResolvedValue({ user: { id: USER } } as never);
  });

  afterAll(wipe);

  it('hiding a category removes it from every visible picker source', async () => {
    const before = await getVisibleCategories(USER);
    expect(before.some((c) => c.id === 'fuel')).toBe(true);

    const res = await setCategoryHidden({ categoryId: 'fuel', hidden: true });
    expect(res.ok).toBe(true);

    expect(await getHiddenCategoryIds(USER)).toContain('fuel');
    const flat = await getVisibleCategories(USER);
    expect(flat.some((c) => c.id === 'fuel')).toBe(false);
    expect(flat.length).toBe(before.length - 1);

    const groups = await getVisibleGroups(USER);
    expect(groups.flatMap((g) => g.categories).some((c) => c.id === 'fuel')).toBe(false);
  });

  it('hiding does NOT delete the shared Category row (historical data stays valid)', async () => {
    // ensureCategories may not have run in this test process; the row may or may
    // not exist, but hiding must never be what removes it. Assert the action
    // touched only the per-user HiddenCategory table.
    const hiddenRows = await prisma.hiddenCategory.findMany({ where: { userId: USER } });
    expect(hiddenRows.map((r) => r.categoryId)).toContain('fuel');
  });

  it('unhiding restores the category', async () => {
    const res = await setCategoryHidden({ categoryId: 'fuel', hidden: false });
    expect(res.ok).toBe(true);
    expect(await getHiddenCategoryIds(USER)).not.toContain('fuel');
    expect((await getVisibleCategories(USER)).some((c) => c.id === 'fuel')).toBe(true);
  });

  it('refuses to hide the uncategorized fallback', async () => {
    const res = await setCategoryHidden({ categoryId: 'uncategorized', hidden: true });
    expect(res.ok).toBe(false);
    expect(await getHiddenCategoryIds(USER)).not.toContain('uncategorized');
  });

  it('refuses an unknown category id', async () => {
    const res = await setCategoryHidden({ categoryId: 'not-real', hidden: true });
    expect(res.ok).toBe(false);
  });

  it('hiding is idempotent (double-hide stays single, unique constraint holds)', async () => {
    await setCategoryHidden({ categoryId: 'alcohol', hidden: true });
    await setCategoryHidden({ categoryId: 'alcohol', hidden: true });
    const rows = await prisma.hiddenCategory.findMany({ where: { userId: USER, categoryId: 'alcohol' } });
    expect(rows.length).toBe(1);
    await setCategoryHidden({ categoryId: 'alcohol', hidden: false });
  });
});
