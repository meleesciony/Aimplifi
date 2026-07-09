/**
 * Ingest-time prediction logging (DECISIONS #190, completing DECISIONS #37).
 *
 * One CategoryPrediction row per PIPELINE-categorized transaction, written when
 * the row is first ingested — the live-path counterpart of the seed's
 * prediction log. Before this, only the demo seed ever created prediction
 * rows, so for a real user the accuracy panel stayed at "No data yet" forever
 * and threshold tuning could never accrue a single labeled sample: filing
 * actions label predictions with updateMany, which no-ops on rows that don't
 * exist.
 *
 * Semantics:
 *  - The log records the FIRST verdict (create-only, never overwrite): what
 *    the pipeline (or its LLM assist) claimed when it first saw the row.
 *  - USER-dictated categories are NOT predictions — an explicit manual/CSV
 *    category carries confidence 10000, a value reserved for user-dictated
 *    verdicts (the pipeline maxes out at RULE_CONFIDENCE_BPS 9900) — so those
 *    rows are skipped: the pipeline made no claim to score.
 *  - Review-routed rows log their honest abstention (predicted
 *    'uncategorized', low confidence), exactly like the seed; the tuning
 *    engine excludes abstentions, the accuracy metric counts them once
 *    labeled.
 */
import { prisma } from '@/lib/db';

export interface PredictionLogRow {
  transactionId: string;
  categoryId: string | null;
  confidenceBps: number | null;
}

export async function logCategoryPredictions(
  userId: string,
  rows: readonly PredictionLogRow[],
): Promise<void> {
  const data = rows
    .filter(
      (r): r is { transactionId: string; categoryId: string; confidenceBps: number } =>
        r.categoryId != null && r.confidenceBps != null && r.confidenceBps < 10000,
    )
    .map((r) => ({
      userId,
      transactionId: r.transactionId,
      predictedCategoryId: r.categoryId,
      confidenceBps: r.confidenceBps,
    }));
  if (data.length === 0) return;
  await prisma.categoryPrediction.createMany({ data });
}
