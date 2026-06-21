/**
 * Concurrency hardening (ROADMAP #9 / STATUS #10) — the splitTransaction
 * double-split race. The action used to read isSplitParent BEFORE its
 * transaction, so two concurrent splits could both pass the pre-read and each
 * create a set of children (doubling the transaction in every aggregate). The
 * fix claims the parent with a conditional updateMany INSIDE the transaction;
 * the loser affects 0 rows and aborts before creating children.
 *
 * Regression lock: drive two parallel splits of the same row and assert exactly
 * one succeeds AND the parent ends with exactly ONE set of children.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn(), signOut: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { auth } from '@/auth';
import { splitTransaction, undoSplit } from '@/server/triage-actions';
import { prisma } from '@/lib/db';

// NOTE: these run on the synchronous single-writer SQLite test DB, which serializes
// the two $transaction calls — so they exercise the conditional-claim GUARD LOGIC
// and the one-set-of-children invariant. On production Postgres the same guarantee
// rests on the conditional-updateMany taking a row lock (Critic CONC-3).

describe('splitTransaction is race-safe (ROADMAP #9 / STATUS #10)', () => {
  const USER = `split-user-${Date.now()}-${process.pid}`;
  let accountId = '';
  let cat0 = '';
  let cat1 = '';

  async function wipe() {
    await prisma.user.deleteMany({ where: { id: USER } });
  }
  async function newTxn(amountCents: number): Promise<string> {
    const t = await prisma.transaction.create({
      data: { accountId, date: '2026-06-01', amountCents, rawDescriptor: 'SPLIT ME', status: 'POSTED', needsReview: false },
    });
    return t.id;
  }

  beforeAll(async () => {
    await wipe();
    await prisma.user.create({ data: { id: USER, email: `${USER}@test.local` } });
    const a = await prisma.account.create({
      data: { userId: USER, provider: 'manual', name: 'Checking', type: 'CHECKING', currentBalanceCents: 100_000 },
    });
    accountId = a.id;
    const cats = await prisma.category.findMany({ take: 2, orderBy: { id: 'asc' } });
    cat0 = cats[0].id;
    cat1 = cats[1].id;
  });
  afterAll(wipe);
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue({ user: { id: USER } } as never);
  });

  it('splits a transaction into children and marks the parent (happy path)', async () => {
    const id = await newTxn(-30000);
    const { childIds } = await splitTransaction({
      transactionId: id,
      parts: [{ amountCents: -10000, categoryId: cat0 }, { amountCents: -20000, categoryId: cat1 }],
    });
    expect(childIds).toHaveLength(2);
    expect((await prisma.transaction.findUnique({ where: { id } }))!.isSplitParent).toBe(true);
    expect(await prisma.transaction.count({ where: { splitParentId: id } })).toBe(2);
  });

  it('two concurrent splits of the same row produce exactly ONE set of children', async () => {
    const id = await newTxn(-30000);
    const parts = [{ amountCents: -10000, categoryId: cat0 }, { amountCents: -20000, categoryId: cat1 }];
    const settled = await Promise.allSettled([
      splitTransaction({ transactionId: id, parts }),
      splitTransaction({ transactionId: id, parts }),
    ]);
    const fulfilled = settled.filter((s) => s.status === 'fulfilled');
    // At most one wins; the other is rejected (already-split or its rollback).
    expect(fulfilled.length).toBe(1);
    // The decisive invariant: never two sets of children.
    expect(await prisma.transaction.count({ where: { splitParentId: id } })).toBe(2);
  });

  it('a sequential second split is rejected and adds no children', async () => {
    const id = await newTxn(-30000);
    const parts = [{ amountCents: -10000, categoryId: cat0 }, { amountCents: -20000, categoryId: cat1 }];
    await splitTransaction({ transactionId: id, parts });
    await expect(splitTransaction({ transactionId: id, parts })).rejects.toThrow(/already split/i);
    expect(await prisma.transaction.count({ where: { splitParentId: id } })).toBe(2);
  });

  it('undoSplit restores a claimable state: split → undo → split again yields one fresh set (CQ-4)', async () => {
    const id = await newTxn(-30000);
    const parts = [{ amountCents: -10000, categoryId: cat0 }, { amountCents: -20000, categoryId: cat1 }];
    await splitTransaction({ transactionId: id, parts });
    await undoSplit(id);
    expect((await prisma.transaction.findUnique({ where: { id } }))!.isSplitParent).toBe(false);
    expect(await prisma.transaction.count({ where: { splitParentId: id } })).toBe(0);
    // Re-split succeeds and produces exactly one fresh set of children.
    await splitTransaction({ transactionId: id, parts });
    expect(await prisma.transaction.count({ where: { splitParentId: id } })).toBe(2);
  });
});
