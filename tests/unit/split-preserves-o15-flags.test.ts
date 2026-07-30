/**
 * O.15 slice 2 critic P1-1 + P1-2, kept as permanent regressions (the split-race
 * harness: real `splitTransaction` against the test DB).
 *
 * P1-1: splitting an EXCLUDED row must not silently reinstate its money — the
 * children inherit `excludeFromTotals` (the menu's own copy promises "exclude
 * its pieces instead"). Locked by asserting the exact DB state, because the old
 * child-create simply omitted the field and every total re-counted the row.
 *
 * P1-2: splitting a row with a TRACKED reimbursement is refused with the same
 * sentence the menu shows disabled — the parent would become a container the
 * outstanding-reimbursements line skips and the register never lists, so the
 * money-owed claim would vanish with no event.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn(), signOut: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { auth } from '@/auth';
import { splitTransaction, undoSplit } from '@/server/triage-actions';
import { SPLIT_BLOCKED_REIMBURSED } from '@/lib/engine/transactions/actions';
import { prisma } from '@/lib/db';

describe('split × the O.15 flags (critic P1-1 / P1-2)', () => {
  const USER = `split-o15-user-${Date.now()}-${process.pid}`;
  let accountId = '';
  let cat0 = '';
  let cat1 = '';

  async function wipe() {
    await prisma.user.deleteMany({ where: { id: USER } });
  }
  async function newTxn(data: Record<string, unknown>): Promise<string> {
    const t = await prisma.transaction.create({
      data: {
        accountId,
        date: '2026-06-01',
        amountCents: -30000,
        rawDescriptor: 'SPLIT ME',
        status: 'POSTED',
        needsReview: false,
        ...data,
      },
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

  it('P1-1: the children of an excluded row are born excluded, and undo restores the flagged parent', async () => {
    const id = await newTxn({ excludeFromTotals: true });
    const { childIds } = await splitTransaction({
      transactionId: id,
      parts: [
        { amountCents: -10000, categoryId: cat0 },
        { amountCents: -20000, categoryId: cat1 },
      ],
    });
    const children = await prisma.transaction.findMany({ where: { id: { in: childIds } } });
    expect(children).toHaveLength(2);
    for (const c of children) expect(c.excludeFromTotals).toBe(true);

    await undoSplit(id);
    const parent = await prisma.transaction.findUnique({ where: { id } });
    expect(parent!.isSplitParent).toBe(false);
    expect(parent!.excludeFromTotals).toBe(true); // the parent never lost it
  });

  it('P1-1 inverse: an ordinary row still splits into COUNTING children', async () => {
    const id = await newTxn({});
    const { childIds } = await splitTransaction({
      transactionId: id,
      parts: [
        { amountCents: -10000, categoryId: cat0 },
        { amountCents: -20000, categoryId: cat1 },
      ],
    });
    for (const c of await prisma.transaction.findMany({ where: { id: { in: childIds } } })) {
      expect(c.excludeFromTotals).toBe(false);
    }
  });

  it("P1-2: a tracked row refuses to split, with the menu's own sentence, in both states", async () => {
    for (const state of ['awaiting', 'received'] as const) {
      const id = await newTxn({ reimbursement: state });
      await expect(
        splitTransaction({
          transactionId: id,
          parts: [
            { amountCents: -10000, categoryId: cat0 },
            { amountCents: -20000, categoryId: cat1 },
          ],
        }),
      ).rejects.toThrow(SPLIT_BLOCKED_REIMBURSED);
      // Nothing happened: no container, no children.
      const row = await prisma.transaction.findUnique({ where: { id } });
      expect(row!.isSplitParent).toBe(false);
      expect(await prisma.transaction.count({ where: { splitParentId: id } })).toBe(0);
    }
  });
});
