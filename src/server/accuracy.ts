/**
 * Categorization accuracy read (DECISIONS #37). Assembles the user's LABELED
 * predictions (those with a confirmed/known actual category) and scores them
 * with the pure engine. Ownership-scoped by userId.
 */
import { prisma } from '@/lib/db';
import { type AccuracyResult, scorePredictions } from '@/lib/engine/accuracy/score';

export async function getCategorizationAccuracy(userId: string): Promise<AccuracyResult> {
  const preds = await prisma.categoryPrediction.findMany({
    where: { userId, actualCategoryId: { not: null } },
    select: { predictedCategoryId: true, confidenceBps: true, actualCategoryId: true },
  });
  return scorePredictions(
    preds.map((p) => ({
      predictedCategoryId: p.predictedCategoryId,
      confidenceBps: p.confidenceBps,
      actualCategoryId: p.actualCategoryId as string,
    })),
  );
}
