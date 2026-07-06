/**
 * SCRIPTED SIMULATION (stands in for a Playwright e2e — DECISIONS #111) of the
 * full custom-category lifecycle, driving the REAL server actions + read paths
 * against throwaway data (never the seeded demo user):
 *
 *   create → appears in every picker + resolves its name
 *   rename → the new name is what reads see
 *   set a budget target on it (write-path accepts the owned custom)
 *   delete → its transactions re-file as Uncategorized, its rule + budget are
 *            removed (REQUIRED FKs that would otherwise block the delete), the
 *            category row is gone, and it leaves the pickers
 *
 * Plus the two validation guards: a custom can't shadow a built-in name, and a
 * per-user duplicate name is refused.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn(), signOut: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { auth } from '@/auth';
import {
  createCustomCategory,
  renameCustomCategory,
  deleteCustomCategory,
} from '@/server/custom-category-actions';
import { setBudget } from '@/server/budget-actions';
import { recategorize, splitTransaction } from '@/server/triage-actions';
import { getVisibleCategories } from '@/server/categories';
import { getCategoryMeta, getCustomCategories } from '@/server/category-meta';
import { categoryName, CATEGORIES } from '@/lib/engine/categorize/categories';
import { CUSTOM_CATEGORY_GROUPS } from '@/lib/engine/categorize/assign';
import { prisma } from '@/lib/db';

describe('custom category lifecycle (real actions, throwaway data — DECISIONS #111)', () => {
  const stamp = `${Date.now()}-${process.pid}`;
  const USER = `cust-life-${stamp}`;
  const GROUP = CUSTOM_CATEGORY_GROUPS[0]; // a spending group (Income/Transfers excluded by F4)
  const UNCATEGORIZED_NAME = CATEGORIES.find((c) => c.id === 'uncategorized')?.name ?? 'Uncategorized';
  let accountId = '';

  async function wipe() {
    await prisma.user.deleteMany({ where: { id: USER } }); // cascades account→txn, custom cats, rules, budgets
  }

  beforeAll(async () => {
    await wipe();
    await prisma.user.create({ data: { id: USER, email: `${USER}@test.local` } });
    // The delete path re-files transactions to the global `uncategorized` row
    // (FK target). Prod seeds it; ensure it exists for this throwaway run too.
    await prisma.category.upsert({
      where: { id: 'uncategorized' },
      create: { id: 'uncategorized', name: UNCATEGORIZED_NAME, isSystem: true },
      update: {},
    });
    const acct = await prisma.account.create({
      data: { userId: USER, provider: 'demo', name: 'Checking', type: 'CHECKING', currentBalanceCents: 0 },
    });
    accountId = acct.id;
    vi.mocked(auth).mockResolvedValue({ user: { id: USER } } as never);
  });

  afterAll(wipe);

  it('refuses a name that shadows a built-in category', async () => {
    const res = await createCustomCategory({ name: 'Dining Out', group: GROUP, discretionary: true });
    expect(res.ok).toBe(false);
  });

  it('refuses a per-user duplicate name', async () => {
    const a = await createCustomCategory({ name: `Dup-${stamp}`, group: GROUP, discretionary: true });
    expect(a.ok).toBe(true);
    const b = await createCustomCategory({ name: `Dup-${stamp}`, group: GROUP, discretionary: true });
    expect(b.ok).toBe(false);
  });

  it('refuses an unknown group', async () => {
    const res = await createCustomCategory({ name: `Boat-${stamp}`, group: 'Not A Group', discretionary: true });
    expect(res.ok).toBe(false);
  });

  it('refuses the Income and Transfers groups (critic F4 — keeps customs genuine spending)', async () => {
    const income = await createCustomCategory({ name: `Side-${stamp}`, group: 'Income', discretionary: false });
    expect(income.ok).toBe(false);
    const transfer = await createCustomCategory({ name: `Move-${stamp}`, group: 'Transfers & Other', discretionary: false });
    expect(transfer.ok).toBe(false);
  });

  it('refuses a case-variant duplicate name (critic F6)', async () => {
    const a = await createCustomCategory({ name: `Case-${stamp}`, group: GROUP, discretionary: true });
    expect(a.ok).toBe(true);
    const b = await createCustomCategory({ name: `CASE-${stamp}`, group: GROUP, discretionary: true });
    expect(b.ok).toBe(false);
  });

  it('register write-in refile: recategorize scope:one files a manual row under a just-created CUSTOM category (the #136 register path, cycle-3 gate)', async () => {
    // The exact server path behind the register write-in e2e (transactions.spec
    // :191): merchantless manual row → createCustomCategory → recategorize
    // scope 'one' (delegates to applyCategory) with the custom id.
    const txn = await prisma.transaction.create({
      data: { accountId, date: '2026-06-03', amountCents: -1111, rawDescriptor: 'E2E REGISTER WRITE-IN UNIT', categoryId: 'dining', needsReview: false, confidenceBps: 9900 },
    });
    const created = await createCustomCategory({ name: 'Padel Unit', group: GROUP, discretionary: true });
    expect(created.ok).toBe(true);
    const res = await recategorize({ transactionId: txn.id, categoryId: created.id!, scope: 'one' });
    expect(res.affected).toBe(1);
    expect(res.correctionIds).toHaveLength(1);
    const after = await prisma.transaction.findUniqueOrThrow({ where: { id: txn.id } });
    expect(after.categoryId).toBe(created.id);
    expect(after.needsReview).toBe(false);
  });

  it('splitTransaction rejects a part with an unowned category (critic F1)', async () => {
    const txn = await prisma.transaction.create({
      data: { accountId, date: '2026-06-02', amountCents: -10000, rawDescriptor: 'SPLIT ME', categoryId: null },
    });
    await expect(
      splitTransaction({
        transactionId: txn.id,
        parts: [
          { amountCents: -6000, categoryId: 'dining' }, // a real system id — fine
          { amountCents: -4000, categoryId: 'not-a-real-category' }, // garbage — must reject
        ],
      }),
    ).rejects.toThrow();
    // the guard runs BEFORE any write, so the parent was never split
    expect((await prisma.transaction.findUnique({ where: { id: txn.id } }))?.isSplitParent).toBe(false);
  });

  it('create → rename → budget → delete (re-files + cleans up FKs)', async () => {
    // create
    const created = await createCustomCategory({ name: 'Golf', group: GROUP, discretionary: true });
    expect(created.ok).toBe(true);
    const id = created.id!;
    expect(id).not.toBe('golf'); // a cuid, never a slug

    // appears in the picker + resolves its name through the merged meta
    expect((await getVisibleCategories(USER)).some((c) => c.id === id)).toBe(true);
    expect(categoryName(id, await getCategoryMeta(USER))).toBe('Golf');

    // rename → the new name is what reads see
    const renamed = await renameCustomCategory({ id, name: 'Golf & Country' });
    expect(renamed.ok).toBe(true);
    expect((await getCustomCategories(USER)).find((c) => c.id === id)?.name).toBe('Golf & Country');

    // a budget target on the custom (write-path accepts an owned custom)
    const fd = new FormData();
    fd.set('categoryId', id);
    fd.set('amount', '120');
    const setRes = await setBudget(null, fd);
    expect(setRes.ok).toBe(true);
    expect(await prisma.budget.count({ where: { userId: USER, categoryId: id } })).toBe(1);

    // a rule + a transaction referencing it, to exercise the delete cleanup
    await prisma.categorizationRule.create({ data: { userId: USER, categoryId: id, priority: 100 } });
    const txn = await prisma.transaction.create({
      data: { accountId, date: '2026-06-01', amountCents: -9000, rawDescriptor: 'BEAR CREEK GC', categoryId: id },
    });

    // delete
    const deleted = await deleteCustomCategory({ id });
    expect(deleted.ok).toBe(true);

    // the category row is gone…
    expect(await prisma.category.findUnique({ where: { id } })).toBeNull();
    // …its transaction re-filed as uncategorized…
    expect((await prisma.transaction.findUnique({ where: { id: txn.id } }))?.categoryId).toBe('uncategorized');
    // …its budget + rule removed…
    expect(await prisma.budget.count({ where: { userId: USER, categoryId: id } })).toBe(0);
    expect(await prisma.categorizationRule.count({ where: { userId: USER, categoryId: id } })).toBe(0);
    // …and it no longer appears in the picker.
    expect((await getVisibleCategories(USER)).some((c) => c.id === id)).toBe(false);
  });
});
