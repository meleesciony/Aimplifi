/**
 * Regression lock (#136) + the triage write-in contract, driving the REAL server
 * actions against throwaway data (never the seeded demo user):
 *
 *  - test_regression__manual_txn_custom_category: a manually-entered transaction
 *    filed under one of the user's own CUSTOM categories must persist. Before the
 *    fix, createManualTransaction passed assertOwnedCategory (custom-aware) but
 *    prepareManualTransaction re-validated against the system-only CATEGORY_BY_ID
 *    and threw `Unknown category "<cuid>"` — even though the add-transaction form
 *    legitimately offers customs via getVisibleCategories (DECISIONS #111).
 *
 *  - create → applyCategory: the sequenced "create a category, then file the
 *    current transaction under it" flow the triage write-in button performs. The
 *    id is only valid once the row exists (R4) — this locks the ordering contract.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn(), signOut: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/navigation', () => ({ redirect: vi.fn() }));

import { auth } from '@/auth';
import { createCustomCategory } from '@/server/custom-category-actions';
import { createManualTransaction } from '@/server/transaction-actions';
import { applyCategory } from '@/server/triage-actions';
import { CUSTOM_CATEGORY_GROUPS } from '@/lib/engine/categorize/assign';
import { CATEGORIES } from '@/lib/engine/categorize/categories';
import { prisma } from '@/lib/db';

describe('manual entry + triage filing with a CUSTOM category (regression #136)', () => {
  const stamp = `${Date.now()}-${process.pid}`;
  const USER = `manual-custom-${stamp}`;
  const GROUP = CUSTOM_CATEGORY_GROUPS[0]; // a spending group (Income/Transfers excluded)
  let accountId = '';
  let golfId = '';

  async function wipe() {
    await prisma.user.deleteMany({ where: { id: USER } }); // cascades accounts→txns, customs, rules
  }

  beforeAll(async () => {
    await wipe();
    await prisma.user.create({ data: { id: USER, email: `${USER}@test.local` } });
    // FK target for the review-pile transaction below; prod seeds it.
    const UNCATEGORIZED_NAME =
      CATEGORIES.find((c) => c.id === 'uncategorized')?.name ?? 'Uncategorized';
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

    const created = await createCustomCategory({ name: `Golf ${stamp}`, group: GROUP, discretionary: true });
    expect(created.ok).toBe(true);
    golfId = created.id!;
  });

  afterAll(wipe);

  it('test_regression__manual_txn_custom_category: createManualTransaction persists a custom id', async () => {
    const form = new FormData();
    form.set('accountId', accountId);
    form.set('descriptor', 'GREENS FEE 0714');
    form.set('amount', '54.00');
    form.set('direction', 'out');
    form.set('date', '2026-06-15');
    form.set('categoryId', golfId);

    // Before the fix this threw `Unknown category "<cuid>"` from prepareManualTransaction.
    // (#170 changed the signature to the useActionState shape: (prev, formData).)
    await createManualTransaction(null, form);

    const row = await prisma.transaction.findFirst({
      where: { account: { userId: USER }, rawDescriptor: 'GREENS FEE 0714' },
    });
    expect(row).not.toBeNull();
    expect(row!.categoryId).toBe(golfId);
    expect(row!.amountCents).toBe(-5400); // outflow negative (money.ts sign convention)
    expect(row!.needsReview).toBe(false); // explicit category is authoritative
  });

  it('create → applyCategory files a review-pile transaction under the fresh custom id', async () => {
    const txn = await prisma.transaction.create({
      data: {
        accountId,
        date: '2026-06-16',
        amountCents: -3200,
        rawDescriptor: 'PRO SHOP 123',
        categoryId: 'uncategorized',
        confidenceBps: 3000,
        status: 'POSTED',
        needsReview: true,
        isTransfer: false,
      },
    });

    // The triage write-in sequence: await the create, THEN file with the returned id.
    const res = await createCustomCategory({ name: `Range ${stamp}`, group: GROUP, discretionary: true });
    expect(res.ok).toBe(true);
    const applied = await applyCategory({ transactionId: txn.id, categoryId: res.id! });
    expect(applied.correctionIds).toHaveLength(1);

    const after = await prisma.transaction.findUniqueOrThrow({ where: { id: txn.id } });
    expect(after.categoryId).toBe(res.id);
    expect(after.needsReview).toBe(false);
  });
});
