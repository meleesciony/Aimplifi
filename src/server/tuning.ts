/**
 * Per-user threshold-tuning read (TASKS 3.6, DECISIONS #190). Assembles the
 * user's USER-LABELED predictions in label-chronological order and hands them
 * to the pure tuning engine — every guard (committed-only filter, minimum
 * samples, clamp, regression auto-revert) lives in the engine, not here.
 *
 * `labeledAt: { not: null }` is the golden-safety gate: seed-time labels carry
 * no labeledAt, so the demo user — whose predictions are pre-labeled in bulk at
 * seed — derives NOTHING and keeps the global threshold, exactly as learn.ts
 * derives no rules for a user with no corrections. Ownership-scoped by userId.
 */
import { prisma } from '@/lib/db';
import { type ThresholdTuning, tuneFlaggedThreshold } from '@/lib/engine/categorize/tuning';

export async function getThresholdTuning(userId: string): Promise<ThresholdTuning> {
  const preds = await prisma.categoryPrediction.findMany({
    where: { userId, actualCategoryId: { not: null }, labeledAt: { not: null } },
    // Chronological by LABEL time (the engine's regression window is "newest
    // labels vs prior history"); id tiebreak keeps batch filings — which share
    // one timestamp — deterministic across reads.
    orderBy: [{ labeledAt: 'asc' }, { id: 'asc' }],
    select: { predictedCategoryId: true, confidenceBps: true, actualCategoryId: true },
  });
  return tuneFlaggedThreshold(
    preds.map((p) => ({
      predictedCategoryId: p.predictedCategoryId,
      confidenceBps: p.confidenceBps,
      actualCategoryId: p.actualCategoryId as string,
    })),
  );
}
