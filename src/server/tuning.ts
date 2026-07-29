/**
 * Per-user threshold-tuning read (TASKS 3.6, DECISIONS #190). Assembles the
 * user's USER-LABELED predictions in label-chronological order and hands them
 * to the pure tuning engine — every guard (committed-only filter, minimum
 * samples, clamp, regression auto-revert) lives in the engine, not here.
 *
 * `labeledAt: { not: null }` is the golden-safety gate for the SEED: seed-time
 * labels carry no labeledAt, so the demo user's bulk pre-labels derive nothing.
 * Live demo VISITORS' filings do stamp labeledAt, which is why the shared-demo
 * fence below exists (O.9e) — together they keep `user-demo` on the global
 * threshold, exactly as learn.ts derives no rules for it. Ownership-scoped by
 * userId.
 */
import { prisma } from '@/lib/db';
import { type ThresholdTuning, tuneFlaggedThreshold } from '@/lib/engine/categorize/tuning';
import { isDemoUser } from '@/lib/demo-user';

export async function getThresholdTuning(userId: string): Promise<ThresholdTuning> {
  // SHARED-DEMO FENCE (O.9e critic P1-1, same class as loadCorrectionInputs /
  // loadExplicitUserRules in server/rules.ts). The `labeledAt` gate below stops
  // SEED-time labels from tuning, but a live demo VISITOR who files a row stamps
  // `labeledAt` through the triage writers like any user — and every anonymous
  // visitor is the same `user-demo` row, so strangers' filings would accumulate
  // past MIN_TUNING_SAMPLES and shift the flagged boundary the NEXT visitor's
  // suggestions are computed with. Learned rules and proposals were fenced in
  // #332; this is the third correction-era learning read, fenced at the one
  // loader every consumer (ingest, backfill, triage, register, trust, settings)
  // goes through. A demo visitor's filing still files; it never becomes tuning
  // evidence. Empty input ⇒ the global default — goldens byte-identical.
  if (isDemoUser(userId)) return tuneFlaggedThreshold([]);
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
