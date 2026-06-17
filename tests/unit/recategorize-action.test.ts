/**
 * Register inline recategorization (DECISIONS #36) — integration test driving the
 * REAL `recategorize` server action against throwaway data (never the seeded
 * demo user). Proves the two scopes: 'one' touches a single transaction with no
 * rule; 'merchant' re-files EVERY transaction of the merchant — including ones
 * the pipeline already auto-filed (needsReview=false), which is the whole point
 * (a confident-but-wrong guess never reaches triage) — and creates a durable
 * priority-100 rule. Unique per-run ids + a wipe guard keep it deterministic.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn(), signOut: vi.fn() }));
// revalidatePath needs a Next request store absent in unit tests — no-op it.
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { auth } from '@/auth';
import { recategorize } from '@/server/triage-actions';
import { getCategorizationAccuracy } from '@/server/accuracy';
import { prisma } from '@/lib/db';

describe('recategorize (real action, throwaway data — DECISIONS #36)', () => {
  const stamp = `${Date.now()}-${process.pid}`;
  const USER = `recat-user-${stamp}`;
  const MERCHANT_CANON = `Recat Merchant ${stamp}`;
  let merchId = '';
  const mIds: string[] = [];
  let otherId = '';

  async function wipe() {
    await prisma.user.deleteMany({ where: { id: USER } });
    await prisma.merchant.deleteMany({ where: { canonical: MERCHANT_CANON } });
  }

  beforeAll(async () => {
    await wipe();
    // Categories assigned by the test must exist (FK). Slugs are the category ids.
    for (const c of [
      { id: 'shopping', name: 'Shopping' },
      { id: 'dining', name: 'Dining Out' },
      { id: 'fuel', name: 'Fuel' },
    ]) {
      await prisma.category.upsert({ where: { id: c.id }, update: {}, create: { id: c.id, name: c.name, isSystem: true } });
    }
    await prisma.user.create({ data: { id: USER, email: `${USER}@test.local` } });
    const acct = await prisma.account.create({
      data: { userId: USER, provider: 'demo', name: 'T', type: 'CHECKING', currentBalanceCents: 0 },
    });
    const merch = await prisma.merchant.create({ data: { canonical: MERCHANT_CANON } });
    merchId = merch.id;
    // Three transactions of the merchant: two already auto-filed (needsReview=false)
    // and one in review — to prove the merchant scope hits the already-filed ones.
    for (let i = 0; i < 3; i++) {
      const t = await prisma.transaction.create({
        data: {
          accountId: acct.id,
          date: `2026-06-0${i + 1}`,
          amountCents: -(1000 + i),
          rawDescriptor: `RECAT MERCHANT ALPHA ${i}`,
          merchantId: merchId,
          categoryId: 'shopping',
          needsReview: i === 2,
          confidenceBps: 9500,
        },
      });
      mIds.push(t.id);
      // a logged prediction (predicted 'shopping', confidence 95%, not yet labeled)
      await prisma.categoryPrediction.create({
        data: { userId: USER, transactionId: t.id, predictedCategoryId: 'shopping', confidenceBps: 9500 },
      });
    }
    // A different transaction — must never be touched by the merchant-scoped change.
    const other = await prisma.transaction.create({
      data: { accountId: acct.id, date: '2026-06-05', amountCents: -2000, rawDescriptor: 'OTHER PLACE', categoryId: 'shopping' },
    });
    otherId = other.id;
  });
  afterAll(wipe);
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue({ user: { id: USER } } as never);
  });

  it("scope 'one' changes only that transaction and creates no rule", async () => {
    const res = await recategorize({ transactionId: mIds[0], categoryId: 'dining', scope: 'one' });
    expect(res.affected).toBe(1);
    expect(res.ruleId).toBeNull();
    expect((await prisma.transaction.findUnique({ where: { id: mIds[0] } }))!.categoryId).toBe('dining');
    // a sibling of the same merchant is untouched
    expect((await prisma.transaction.findUnique({ where: { id: mIds[1] } }))!.categoryId).toBe('shopping');
    expect(await prisma.categorizationRule.count({ where: { userId: USER } })).toBe(0);
    expect(await prisma.correction.count({ where: { userId: USER, transactionId: mIds[0] } })).toBeGreaterThanOrEqual(1);
    // the prediction is now labeled with the user's confirmed truth (DECISIONS #37)
    expect(
      (await prisma.categoryPrediction.findUnique({ where: { transactionId: mIds[0] } }))!.actualCategoryId,
    ).toBe('dining');
    const acc = await getCategorizationAccuracy(USER);
    expect(acc.n).toBe(1); // one labeled so far; predicted 'shopping' ≠ 'dining' → a miss
    expect(acc.correct).toBe(0);
  });

  it("scope 'merchant' re-files every transaction of the merchant (already-filed included) + a priority-100 rule", async () => {
    const res = await recategorize({ transactionId: mIds[1], categoryId: 'fuel', scope: 'merchant' });
    expect(res.affected).toBe(3); // all three, including the two that were needsReview=false
    expect(res.ruleId).not.toBeNull();
    for (const id of mIds) {
      expect((await prisma.transaction.findUnique({ where: { id } }))!.categoryId).toBe('fuel');
    }
    // ownership/scope isolation: the unrelated transaction is unchanged
    expect((await prisma.transaction.findUnique({ where: { id: otherId } }))!.categoryId).toBe('shopping');
    const rule = await prisma.categorizationRule.findFirst({ where: { userId: USER, merchantId: merchId } });
    expect(rule?.categoryId).toBe('fuel');
    expect(rule?.priority).toBe(100);
    // all three predictions are now labeled 'fuel' (DECISIONS #37)
    const acc = await getCategorizationAccuracy(USER);
    expect(acc.n).toBe(3);
    expect(acc.correct).toBe(0); // predicted 'shopping' vs actual 'fuel' → all misses
  });
});
