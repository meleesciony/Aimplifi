/**
 * Undo un-labels the accuracy sample (DECISIONS #169). Filing a transaction stamps
 * its CategoryPrediction.actualCategoryId as ground truth (DECISIONS #37) so the
 * categorization-accuracy metric can score it. Undoing the correction restores the
 * transaction to review — the user retracted the label — so the prediction MUST be
 * un-labeled too, or getCategorizationAccuracy keeps counting a decision that was
 * taken back and the displayed accuracy never recovers after undo (the STATUS
 * #166/#168 follow-up (e) defect). Drives the REAL applyCategory + undoCorrections
 * server actions against throwaway data (never the seeded demo user); unique per-run
 * ids + a wipe guard keep it deterministic.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn(), signOut: vi.fn() }));
// revalidatePath needs a Next request store absent in unit tests — no-op it.
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { auth } from '@/auth';
import { applyCategory, undoCorrections } from '@/server/triage-actions';
import { getCategorizationAccuracy } from '@/server/accuracy';
import { prisma } from '@/lib/db';

describe('undo un-labels the accuracy sample (DECISIONS #169)', () => {
  const stamp = `${Date.now()}-${process.pid}`;
  const USER = `accundo-user-${stamp}`;
  const MERCHANT_CANON = `AccUndo Merchant ${stamp}`;
  let acctId = '';
  let merchId = '';

  async function wipe() {
    await prisma.user.deleteMany({ where: { id: USER } });
    await prisma.merchant.deleteMany({ where: { canonical: MERCHANT_CANON } });
  }

  beforeAll(async () => {
    await wipe();
    // Categories the test assigns must exist (FK). Slugs are the category ids.
    for (const c of [
      { id: 'shopping', name: 'Shopping' },
      { id: 'dining', name: 'Dining Out' },
    ]) {
      await prisma.category.upsert({ where: { id: c.id }, update: {}, create: { id: c.id, name: c.name, isSystem: true } });
    }
    await prisma.user.create({ data: { id: USER, email: `${USER}@test.local` } });
    const acct = await prisma.account.create({
      data: { userId: USER, provider: 'demo', name: 'T', type: 'CHECKING', currentBalanceCents: 0 },
    });
    acctId = acct.id;
    const merch = await prisma.merchant.create({ data: { canonical: MERCHANT_CANON } });
    merchId = merch.id;
  });
  afterAll(wipe);
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(auth).mockResolvedValue({ user: { id: USER } } as never);
  });

  // A review-queued transaction of the merchant carrying a logged (unlabeled)
  // prediction. `category` is the row's current (pre-file) category, kept distinct
  // from what the user files so the recorded correction is never a degenerate
  // X→X no-op (which the pre-existing idempotent-undo guard would skip); `predicted`
  // is the pipeline's guess that hit/miss is scored against.
  async function seedRow(i: number, predicted: string, category: string): Promise<string> {
    const t = await prisma.transaction.create({
      data: {
        accountId: acctId,
        date: `2026-06-1${i}`,
        amountCents: -(2000 + i),
        rawDescriptor: `ACCUNDO MERCHANT ${i}`,
        merchantId: merchId,
        categoryId: category,
        needsReview: true,
        confidenceBps: 8000,
      },
    });
    await prisma.categoryPrediction.create({
      data: { userId: USER, transactionId: t.id, predictedCategoryId: predicted, confidenceBps: 8000 },
    });
    return t.id;
  }

  it('filing a wrong guess then undoing restores the transaction AND the accuracy metric', async () => {
    const txId = await seedRow(1, 'shopping', 'shopping'); // the pipeline guessed 'shopping'

    // baseline: nothing labeled yet
    expect((await getCategorizationAccuracy(USER)).n).toBe(0);

    // user files it as 'dining' (an ambiguous group's non-guess) → a labeled MISS
    const filed = await applyCategory({ transactionId: txId, categoryId: 'dining' });
    let acc = await getCategorizationAccuracy(USER);
    expect(acc.n).toBe(1);
    expect(acc.correct).toBe(0); // predicted 'shopping' ≠ actual 'dining'
    expect(
      (await prisma.categoryPrediction.findUnique({ where: { transactionId: txId } }))!.actualCategoryId,
    ).toBe('dining');

    // undo → transaction back to review AND the prediction un-labeled
    await undoCorrections(filed.correctionIds);
    const txn = (await prisma.transaction.findUnique({ where: { id: txId } }))!;
    expect(txn.needsReview).toBe(true);
    expect(txn.categoryId).toBe('shopping'); // restored to the pre-file value
    expect(
      (await prisma.categoryPrediction.findUnique({ where: { transactionId: txId } }))!.actualCategoryId,
    ).toBeNull();

    // the metric no longer counts the retracted decision (fail-old: n stayed 1)
    acc = await getCategorizationAccuracy(USER);
    expect(acc.n).toBe(0);
  });

  it('undo un-counts a CORRECT guess too — the sample is retracted regardless of hit/miss', async () => {
    // predicted 'dining' while the row currently sits at 'shopping'; filing 'dining'
    // confirms the guess (a HIT) without a degenerate no-op correction.
    const txId = await seedRow(2, 'dining', 'shopping');
    const filed = await applyCategory({ transactionId: txId, categoryId: 'dining' }); // a HIT
    let acc = await getCategorizationAccuracy(USER);
    expect(acc.n).toBe(1);
    expect(acc.correct).toBe(1);

    await undoCorrections(filed.correctionIds);
    expect(
      (await prisma.categoryPrediction.findUnique({ where: { transactionId: txId } }))!.actualCategoryId,
    ).toBeNull();
    acc = await getCategorizationAccuracy(USER);
    expect(acc.n).toBe(0); // guards against a fix that only nulls on a miss
    expect(acc.correct).toBe(0);
  });
});
