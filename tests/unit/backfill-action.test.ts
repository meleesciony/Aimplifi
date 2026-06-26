/**
 * Backfill categorization (DECISIONS #116) — integration test driving the REAL
 * `backfillCategorization` action against throwaway data (never the seeded demo
 * user). Proves: the improved categorizer clears resolvable review rows (Delta
 * Dental → dental-insurance, payroll → income); the inflow sign guard and a
 * genuinely-unknown descriptor stay in review; a settled row is never clobbered;
 * another user's pile is untouched; and a second run is a no-op (idempotent).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn(), signOut: vi.fn() }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { auth } from '@/auth';
import { backfillCategorization } from '@/server/backfill-actions';
import { prisma } from '@/lib/db';

describe('backfillCategorization (real action, throwaway data — DECISIONS #116)', () => {
  const stamp = `${Date.now()}-${process.pid}`;
  const USER = `backfill-user-${stamp}`;
  const OTHER = `backfill-other-${stamp}`;
  const ids: Record<string, string> = {};

  async function wipe() {
    await prisma.user.deleteMany({ where: { id: { in: [USER, OTHER] } } });
  }

  beforeAll(async () => {
    await wipe();
    for (const c of [
      { id: 'uncategorized', name: 'Uncategorized' },
      { id: 'dental-insurance', name: 'Dental Insurance' },
      { id: 'income', name: 'Income' },
      { id: 'dining', name: 'Dining Out' },
    ]) {
      await prisma.category.upsert({ where: { id: c.id }, update: {}, create: { id: c.id, name: c.name, isSystem: true } });
    }

    await prisma.user.create({ data: { id: USER, email: `${USER}@test.local` } });
    const acct = await prisma.account.create({
      data: { userId: USER, provider: 'demo', name: 'T', type: 'CHECKING', currentBalanceCents: 0 },
    });
    async function txn(key: string, data: { rawDescriptor: string; amountCents: number; categoryId: string | null; needsReview: boolean }) {
      const t = await prisma.transaction.create({
        data: { accountId: acct.id, date: '2026-06-10', confidenceBps: 5000, ...data },
      });
      ids[key] = t.id;
    }
    // Resolvable by the improved rules → should be auto-filed:
    await txn('dental', { rawDescriptor: 'DELTA DENTAL OF GA PREMIUM', amountCents: -4500, categoryId: 'uncategorized', needsReview: true });
    await txn('income', { rawDescriptor: 'GUSTO PAYROLL 9X8Y7Z DIRECT DEP', amountCents: 500000, categoryId: 'uncategorized', needsReview: true });
    // Inflow that WOULD resolve to a spend category → sign guard keeps it in review:
    await txn('inflowSpend', { rawDescriptor: 'STARBUCKS 800-782-7282', amountCents: 700, categoryId: 'uncategorized', needsReview: true });
    // Genuinely unknown → stays in review:
    await txn('unknown', { rawDescriptor: 'ACME WIDGETS LLC 7781', amountCents: -2000, categoryId: 'uncategorized', needsReview: true });
    // Already settled → must never be clobbered:
    await txn('settled', { rawDescriptor: 'STARBUCKS 800-782-7282', amountCents: -600, categoryId: 'dining', needsReview: false });

    // A different user with a resolvable unsure row — must NOT be touched.
    await prisma.user.create({ data: { id: OTHER, email: `${OTHER}@test.local` } });
    const otherAcct = await prisma.account.create({
      data: { userId: OTHER, provider: 'demo', name: 'T2', type: 'CHECKING', currentBalanceCents: 0 },
    });
    const otherTxn = await prisma.transaction.create({
      data: { accountId: otherAcct.id, date: '2026-06-10', amountCents: -4500, rawDescriptor: 'DELTA DENTAL OF GA PREMIUM', categoryId: 'uncategorized', needsReview: true, confidenceBps: 5000 },
    });
    ids.other = otherTxn.id;
  });
  afterAll(wipe);
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue({ user: { id: USER } } as never);
  });

  const cat = async (id: string) => (await prisma.transaction.findUnique({ where: { id } }))!;

  it('auto-files the resolvable review rows and leaves the rest in review', async () => {
    const res = await backfillCategorization();
    expect(res.scanned).toBe(4); // the 4 unsure rows (settled is not scanned)
    expect(res.refiled).toBe(2); // dental + income
    expect(res.stillUnsure).toBe(2); // inflow-spend + unknown

    const dental = await cat(ids.dental);
    expect(dental.categoryId).toBe('dental-insurance');
    expect(dental.needsReview).toBe(false);
    expect(dental.confidenceBps).toBe(8500); // generic-rule confidence, NOT user-confirmed 9900

    const income = await cat(ids.income);
    expect(income.categoryId).toBe('income');
    expect(income.needsReview).toBe(false);

    // sign guard: a positive-amount STARBUCKS stays uncategorized in review
    const inflow = await cat(ids.inflowSpend);
    expect(inflow.categoryId).toBe('uncategorized');
    expect(inflow.needsReview).toBe(true);

    // unknown descriptor stays in review
    const unknown = await cat(ids.unknown);
    expect(unknown.needsReview).toBe(true);

    // settled row is untouched
    const settled = await cat(ids.settled);
    expect(settled.categoryId).toBe('dining');
    expect(settled.needsReview).toBe(false);
  });

  it("never touches another user's transactions", async () => {
    const other = await cat(ids.other);
    expect(other.categoryId).toBe('uncategorized');
    expect(other.needsReview).toBe(true);
  });

  it('is idempotent — a second run re-files nothing', async () => {
    const res = await backfillCategorization();
    expect(res.refiled).toBe(0);
    expect(res.stillUnsure).toBe(2);
  });
});
