/**
 * Threshold tuning derives ONLY from user-labeled predictions (DECISIONS #190).
 *
 * The golden-safety property under lock: the demo seed pre-labels hundreds of
 * predictions (actualCategoryId set at seed time, labeledAt null), and those
 * must NEVER activate per-user threshold tuning — otherwise the demo user's
 * routing would drift from the global thresholds and the golden e2e/demo
 * behavior would change. Only labels a user actually made (filing/correcting,
 * which stamp labeledAt) count; undo retracts the label AND the stamp,
 * symmetric with the #169 un-label invariant.
 *
 * Drives the REAL applyCategory + undoCorrections server actions and the REAL
 * getThresholdTuning read against throwaway data (never the seeded demo user);
 * unique per-run ids + a wipe guard keep it deterministic.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/auth', () => ({ auth: vi.fn(), signOut: vi.fn() }));
// revalidatePath needs a Next request store absent in unit tests — no-op it.
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import { auth } from '@/auth';
import { prisma } from '@/lib/db';
import { AUTO_FLAGGED_BPS } from '@/lib/engine/categorize/pipeline';
import { getThresholdTuning } from '@/server/tuning';
import { applyCategory, undoCorrections } from '@/server/triage-actions';

describe('threshold tuning reads only user-labeled predictions (DECISIONS #190)', () => {
  const stamp = `${Date.now()}-${process.pid}`;
  const USER = `tune-user-${stamp}`;
  const MERCHANT_CANON = `TuneTest Merchant ${stamp}`;
  let acctId = '';
  let merchId = '';

  async function wipe() {
    await prisma.user.deleteMany({ where: { id: USER } });
    await prisma.merchant.deleteMany({ where: { canonical: MERCHANT_CANON } });
  }

  beforeAll(async () => {
    await wipe();
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

  it('seed-style labels (labeledAt null) NEVER activate tuning — the demo user stays global', async () => {
    // 30 committed, perfectly-hit, high-confidence predictions labeled the way the
    // SEED labels them: actualCategoryId set, labeledAt absent. Were these counted,
    // Brier ≈ 10 milli would loosen the threshold to 6500.
    await prisma.categoryPrediction.createMany({
      data: Array.from({ length: 30 }, (_, i) => ({
        userId: USER,
        transactionId: `seedstyle-${stamp}-${i}`,
        predictedCategoryId: 'shopping',
        confidenceBps: 9000,
        actualCategoryId: 'shopping', // seed-time label…
        // …labeledAt deliberately NOT set
      })),
    });

    const tuning = await getThresholdTuning(USER);
    expect(tuning.reason).toBe('insufficient-samples');
    expect(tuning.sampleCount).toBe(0); // none of the 30 counted
    expect(tuning.flaggedBps).toBe(AUTO_FLAGGED_BPS);

    await prisma.categoryPrediction.deleteMany({ where: { userId: USER } });
  });

  it('filing stamps labeledAt; undo clears it (symmetric with the #169 un-label)', async () => {
    const t = await prisma.transaction.create({
      data: {
        accountId: acctId,
        date: '2026-06-11',
        amountCents: -2001,
        rawDescriptor: 'TUNETEST MERCHANT 1',
        merchantId: merchId,
        categoryId: 'shopping',
        needsReview: true,
        confidenceBps: 8000,
      },
    });
    await prisma.categoryPrediction.create({
      data: { userId: USER, transactionId: t.id, predictedCategoryId: 'shopping', confidenceBps: 8000 },
    });

    const filed = await applyCategory({ transactionId: t.id, categoryId: 'dining' });
    const labeled = (await prisma.categoryPrediction.findUnique({ where: { transactionId: t.id } }))!;
    expect(labeled.actualCategoryId).toBe('dining');
    expect(labeled.labeledAt).not.toBeNull(); // a USER label — tuning may learn from it

    await undoCorrections(filed.correctionIds);
    const retracted = (await prisma.categoryPrediction.findUnique({ where: { transactionId: t.id } }))!;
    expect(retracted.actualCategoryId).toBeNull();
    expect(retracted.labeledAt).toBeNull(); // fail-old: the stamp outliving the label
    await prisma.categoryPrediction.deleteMany({ where: { userId: USER } });
    await prisma.transaction.deleteMany({ where: { id: t.id } });
  });

  it('user-labeled history activates tuning end-to-end: 20 labels @0.9 with 2 misses → 6700', async () => {
    // EDGE_CASES §Threshold tuning case B, through the real loader: chronological
    // labeledAt stamps, committed samples only.
    const base = Date.parse('2026-06-01T00:00:00Z');
    await prisma.categoryPrediction.createMany({
      data: Array.from({ length: 20 }, (_, i) => ({
        userId: USER,
        transactionId: `userlabel-${stamp}-${i}`,
        predictedCategoryId: 'shopping',
        confidenceBps: 9000,
        actualCategoryId: i < 2 ? 'dining' : 'shopping', // 2 corrected, 18 confirmed
        labeledAt: new Date(base + i * 60_000),
      })),
    });

    const tuning = await getThresholdTuning(USER);
    expect(tuning.sampleCount).toBe(20);
    expect(tuning.brierMilli).toBe(90);
    expect(tuning.offsetBps).toBe(-300);
    expect(tuning.flaggedBps).toBe(6700);
    expect(tuning.reason).toBe('tuned');
    await prisma.categoryPrediction.deleteMany({ where: { userId: USER } });
  });
});
