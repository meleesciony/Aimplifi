/**
 * Demo fence on category REMOVAL (O.17c). The shared demo account is one row every
 * anonymous visitor logs into, so one visitor removing a built-in category takes it
 * out of the pickers every visitor after them chooses from — and the Settings copy
 * on the demo row used to invite exactly that ("Remove the ones you don't use"),
 * one tap from a visible button. The UI now drops the Remove control for demo;
 * these tests lock the server-side guard on the exposed 'use server' endpoint.
 *
 * The fence is deliberately ONE-SIDED: restoring stays open, because it can only
 * move the demo back toward its seeded default. That safety is a premise about the
 * seed, not about this file, so the first test asserts the premise instead of
 * leaving it in a comment — if a future seed ever hides a category on the demo row,
 * this test fails and the one-sided fence gets re-decided rather than silently
 * becoming wrong.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEMO_USER_ID } from '@/lib/demo-user';

vi.mock('@/auth', () => ({ auth: vi.fn(), signOut: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

const { auth } = await import('@/auth');
const { prisma } = await import('@/lib/db');
const { setCategoryHidden } = await import('@/server/category-actions');
const { deleteCustomCategory } = await import('@/server/custom-category-actions');
const { getHiddenCategoryIds } = await import('@/server/categories');

function actAs(userId: string) {
  vi.mocked(auth).mockResolvedValue({ user: { id: userId } } as never);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('test_regression__demo_cannot_remove_a_shared_category', () => {
  it('PREMISE: the seeded demo row hides nothing, so leaving Restore open is safe', async () => {
    // Read before this file mutates anything: this is a statement about the SEED.
    expect(await prisma.user.findUnique({ where: { id: DEMO_USER_ID }, select: { id: true } })).not.toBeNull();
    expect(await prisma.hiddenCategory.count({ where: { userId: DEMO_USER_ID } })).toBe(0);
  });

  it('refuses to remove a category on the demo row, and writes no row', async () => {
    actAs(DEMO_USER_ID);
    const res = await setCategoryHidden({ categoryId: 'fuel', hidden: true });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/shared/i);
    expect(await prisma.hiddenCategory.count({ where: { userId: DEMO_USER_ID } })).toBe(0);
    expect(await getHiddenCategoryIds(DEMO_USER_ID)).not.toContain('fuel');
  });

  it('answers the demo reason even for an id that is unhideable anyway', async () => {
    actAs(DEMO_USER_ID);
    // `uncategorized` is refused for EVERY user, so it is the only input that can
    // tell the two refusals apart: whichever check runs first is the one that
    // speaks. The demo reason is true of every id this visitor could send; the
    // hideable one would be a sentence about this id, which is not why they were
    // stopped. Swapping the two checks in the action flips this assertion.
    const res = await setCategoryHidden({ categoryId: 'uncategorized', hidden: true });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/shared/i);
    expect(res.error).not.toMatch(/can’t be hidden/i);
    expect(await prisma.hiddenCategory.count({ where: { userId: DEMO_USER_ID } })).toBe(0);
  });

  it('a hideable id is refused too, so the fence is not about which category it is', async () => {
    actAs(DEMO_USER_ID);
    const res = await setCategoryHidden({ categoryId: 'alcohol', hidden: true });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/shared/i);
    expect(await prisma.hiddenCategory.count({ where: { userId: DEMO_USER_ID } })).toBe(0);
  });

  it('is scoped to REMOVING: restore stays open on the demo row', async () => {
    actAs(DEMO_USER_ID);
    const res = await setCategoryHidden({ categoryId: 'fuel', hidden: false });
    expect(res.ok).toBe(true);
    // Still nothing hidden — restore on an already-visible category is a no-op,
    // which is the whole reason this direction cannot degrade the shared demo.
    expect(await prisma.hiddenCategory.count({ where: { userId: DEMO_USER_ID } })).toBe(0);
  });

  it('the sibling door is shut too: the demo cannot DELETE a custom category', async () => {
    // O.17c critic P2-4. Unreachable today — creation is fenced and a production
    // probe found 0 demo-owned custom categories — but it was left open on a
    // premise about a different action, and its blast radius is larger than the
    // one this slice fenced (it re-files every transaction in the category and
    // drops its rules and budgets, for everyone sharing the row).
    actAs(DEMO_USER_ID);
    const res = await deleteCustomCategory({ id: 'anything' });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/shared/i);
    // Not the "Category not found" answer — the fence spoke, before any lookup.
    expect(res.error).not.toMatch(/not found/i);
  });

  it('the fence is demo-specific: a real user can still remove a category', async () => {
    const USER = `cat-remove-fence-real-${Date.now()}-${process.pid}`;
    await prisma.user.deleteMany({ where: { id: USER } });
    await prisma.user.create({ data: { id: USER, email: `${USER}@test.local` } });
    try {
      actAs(USER);
      const res = await setCategoryHidden({ categoryId: 'fuel', hidden: true });
      expect(res.ok).toBe(true);
      expect(await getHiddenCategoryIds(USER)).toContain('fuel');
    } finally {
      await prisma.user.deleteMany({ where: { id: USER } }); // cascades HiddenCategory
    }
  });
});
