/**
 * Custom-category write-path guard + picker reads (DECISIONS #111), integration
 * against throwaway data (never the seeded demo user). Proves:
 *  - a created custom category is assignable for its owner and appears in the
 *    visible picker sources;
 *  - `assertOwnedCategory` accepts system ids and the owner's customs, but
 *    rejects garbage AND another user's custom id (the cross-tenant guard that
 *    stops a hand-crafted POST from filing a row under a foreign category).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { assertOwnedCategory } from '@/server/category-meta';
import { getVisibleCategories, getVisibleGroups } from '@/server/categories';
import { prisma } from '@/lib/db';

describe('assertOwnedCategory + custom pickers (real data — DECISIONS #111)', () => {
  const stamp = `${Date.now()}-${process.pid}`;
  const OWNER = `cust-owner-${stamp}`;
  const OTHER = `cust-other-${stamp}`;
  let golfId = '';

  async function wipe() {
    // Cascades the owner's custom Category rows (Category.userId onDelete: Cascade).
    await prisma.user.deleteMany({ where: { id: { in: [OWNER, OTHER] } } });
  }

  beforeAll(async () => {
    await wipe();
    await prisma.user.createMany({
      data: [
        { id: OWNER, email: `${OWNER}@test.local` },
        { id: OTHER, email: `${OTHER}@test.local` },
      ],
    });
    const golf = await prisma.category.create({
      data: { name: 'Golf', userId: OWNER, group: 'Entertainment', isSystem: false },
      select: { id: true },
    });
    golfId = golf.id;
  });

  afterAll(wipe);

  it('a custom category id is NOT a system id (it is a cuid, never a slug)', () => {
    expect(golfId).not.toBe('golf');
    expect(golfId.length).toBeGreaterThan(8);
  });

  it('accepts a system id, the uncategorized placeholder, and the owner’s custom', async () => {
    await expect(assertOwnedCategory(OWNER, 'dining')).resolves.toBeUndefined();
    await expect(assertOwnedCategory(OWNER, 'uncategorized')).resolves.toBeUndefined();
    await expect(assertOwnedCategory(OWNER, golfId)).resolves.toBeUndefined();
  });

  it('rejects a garbage id and another user’s custom id (cross-tenant guard)', async () => {
    await expect(assertOwnedCategory(OWNER, 'not-a-real-category')).rejects.toThrow();
    await expect(assertOwnedCategory(OTHER, golfId)).rejects.toThrow();
  });

  it('the custom category appears in the owner’s pickers, not another user’s', async () => {
    const ownerFlat = await getVisibleCategories(OWNER);
    expect(ownerFlat.some((c) => c.id === golfId)).toBe(true);

    const ownerGroups = await getVisibleGroups(OWNER);
    expect(ownerGroups.flatMap((g) => g.categories).some((c) => c.id === golfId)).toBe(true);

    const otherFlat = await getVisibleCategories(OTHER);
    expect(otherFlat.some((c) => c.id === golfId)).toBe(false);
  });
});
