/**
 * Bounded per-user threshold tuning (TASKS 3.6 / STRATEGIC_AUDIT §4.2 loop 4,
 * DECISIONS #190). Pure, deterministic, recomputed FROM SCRATCH on every call —
 * no stored tuning state, no ratchet: delete/undo the underlying labels and the
 * tuning disappears on the next read, exactly like learn.ts rules.
 *
 * WHAT IT TUNES — only the AUTO_FLAGGED (auto-file vs review) boundary, nudged
 * at most ±TUNE_SPAN_BPS around the global default. The AUTO_SILENT boundary is
 * NEVER tuned: a tuned filing always carries the visible "AI" badge rules apply
 * (pipeline.ts keeps `aiBadge: confidence < AUTO_SILENT_BPS` against the global
 * constant), so tuning can loosen review, but can never create a new SILENT
 * filing. Safety copy stays non-personalizable, mirroring the audit's "critical
 * alerts are never demotable" floor.
 *
 * WHAT IT READS — the user's labeled CategoryPrediction history (Brier score:
 * see accuracy/score.ts), restricted to COMMITTED auto-filings:
 *   - predicted 'uncategorized' rows are EXCLUDED. Those are abstentions the
 *     pipeline deliberately routed to review; counting them as low-confidence
 *     "misses" would inflate the Brier of exactly the users who review the most,
 *     tightening their threshold, sending MORE rows to review, generating more
 *     pseudo-misses — a positive feedback loop. Tuning must measure "were the
 *     filings we committed right for THIS user", nothing else.
 *   - actual 'uncategorized' rows are EXCLUDED. That value means "unresolved"
 *     (e.g. a deleted custom category rewrites predictions to it) — it is not a
 *     ground-truth label, and predicted==actual=='uncategorized' would score as
 *     a fake hit.
 *
 * DIRECTION — lower Brier (well-calibrated: confident-and-right) ⇒ negative
 * offset ⇒ more auto-filing with the badge ("a never-correcting user gets more
 * silence"); higher Brier (confident-and-wrong: the user keeps correcting our
 * filings) ⇒ positive offset ⇒ more review ("a consistently-corrected user gets
 * more review").
 *
 * AUTO-REVERT — if the user's RECENT labeled window scores materially worse
 * than their prior history, the estimate is unstable: freeze personalization
 * and fall back to the global threshold (the audit's "when a loop's metric
 * regresses, its candidates freeze"). The check is one-sided: recent
 * IMPROVEMENT never reverts.
 *
 * Hand-verified known-answer table: docs/EDGE_CASES.md §Threshold tuning.
 */
import { type PredictionSample, scorePredictions } from '../accuracy/score';
import { AUTO_FLAGGED_BPS } from './pipeline';

/**
 * Committed labeled samples required before any deviation from the global
 * threshold. Below this, per-user Brier is noise (one 810-milli miss among 10
 * samples swings the mean by 81), and a brand-new user must start at the
 * tested global default.
 */
export const MIN_TUNING_SAMPLES = 20;

/** Hard clamp on the offset: the tuned threshold lives in
 *  [AUTO_FLAGGED_BPS - 500, AUTO_FLAGGED_BPS + 500] = [6500, 7500]. */
export const TUNE_SPAN_BPS = 500;

/**
 * The Brier (milli) pivot mapped to offset 0. At ~0.9 confidence a miss costs
 * ~810 milli and a hit ~10 milli, so 150 milli ≈ 17–18% of committed filings
 * getting corrected — the neutral zone between "trust it more" and "review
 * more" (see EDGE_CASES for the derivation).
 */
export const NEUTRAL_BRIER_MILLI = 150;

/** Linear slope: 5 bps of threshold per Brier milli ⇒ the full ±500 span is
 *  reached 100 milli away from the pivot (at ≤50 / ≥250 milli). */
export const BPS_PER_BRIER_MILLI = 5;

/** Newest committed samples forming the regression-check window. */
export const RECENT_WINDOW = 20;

/** How much worse (in Brier milli) the recent window must score than the prior
 *  history before tuning auto-reverts. Strictly greater-than. */
export const REGRESSION_MARGIN_MILLI = 25;

export type TuningReason =
  /** Fewer than MIN_TUNING_SAMPLES committed labeled samples — global default. */
  | 'insufficient-samples'
  /** Enough samples, Brier sits exactly at the pivot — offset 0. */
  | 'baseline'
  /** Personalized threshold in effect. */
  | 'tuned'
  /** Recent Brier regressed vs prior history — reverted to the global default. */
  | 'reverted-regression';

export interface ThresholdTuning {
  /** The AUTO_FLAGGED boundary categorize() should use for this user. */
  flaggedBps: number;
  /** flaggedBps - AUTO_FLAGGED_BPS; 0 unless reason === 'tuned'. */
  offsetBps: number;
  reason: TuningReason;
  /** Committed labeled samples considered (after the exclusions above). */
  sampleCount: number;
  /** Overall Brier (milli) over the committed samples; null when insufficient. */
  brierMilli: number | null;
  /** Brier of the newest RECENT_WINDOW samples; null when the check didn't run. */
  recentBrierMilli: number | null;
  /** Brier of everything before the recent window; null when the check didn't run. */
  priorBrierMilli: number | null;
}

/** The pure Brier→offset mapping, exported for direct known-answer tests. */
export function offsetForBrierMilli(brierMilli: number): number {
  const raw = Math.round((brierMilli - NEUTRAL_BRIER_MILLI) * BPS_PER_BRIER_MILLI);
  if (raw > TUNE_SPAN_BPS) return TUNE_SPAN_BPS;
  if (raw < -TUNE_SPAN_BPS) return -TUNE_SPAN_BPS;
  return raw;
}

function isCommitted(s: PredictionSample): boolean {
  return s.predictedCategoryId !== 'uncategorized' && s.actualCategoryId !== 'uncategorized';
}

const GLOBAL: Omit<ThresholdTuning, 'reason' | 'sampleCount'> = {
  flaggedBps: AUTO_FLAGGED_BPS,
  offsetBps: 0,
  brierMilli: null,
  recentBrierMilli: null,
  priorBrierMilli: null,
};

/**
 * Compute the user's tuned AUTO_FLAGGED boundary from their labeled prediction
 * history. `samples` MUST be in chronological label order (oldest first) — the
 * regression check compares the newest RECENT_WINDOW against everything before.
 */
export function tuneFlaggedThreshold(samples: readonly PredictionSample[]): ThresholdTuning {
  const committed = samples.filter(isCommitted);
  const n = committed.length;

  if (n < MIN_TUNING_SAMPLES) {
    return { ...GLOBAL, reason: 'insufficient-samples', sampleCount: n };
  }

  const overall = scorePredictions(committed);

  // Regression gate — only once there is a full prior history to compare
  // against (n ≥ 2×RECENT_WINDOW). Before that, a regression still drags the
  // OVERALL Brier up, which pushes the offset toward more review — the safe
  // direction — so the gap is covered.
  let recentBrierMilli: number | null = null;
  let priorBrierMilli: number | null = null;
  if (n >= RECENT_WINDOW * 2) {
    recentBrierMilli = scorePredictions(committed.slice(n - RECENT_WINDOW)).brierMilli;
    priorBrierMilli = scorePredictions(committed.slice(0, n - RECENT_WINDOW)).brierMilli;
    if (recentBrierMilli > priorBrierMilli + REGRESSION_MARGIN_MILLI) {
      return {
        ...GLOBAL,
        reason: 'reverted-regression',
        sampleCount: n,
        brierMilli: overall.brierMilli,
        recentBrierMilli,
        priorBrierMilli,
      };
    }
  }

  const offsetBps = offsetForBrierMilli(overall.brierMilli);
  return {
    flaggedBps: AUTO_FLAGGED_BPS + offsetBps,
    offsetBps,
    reason: offsetBps === 0 ? 'baseline' : 'tuned',
    sampleCount: n,
    brierMilli: overall.brierMilli,
    recentBrierMilli,
    priorBrierMilli,
  };
}
