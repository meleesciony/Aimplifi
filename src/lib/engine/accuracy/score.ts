/**
 * Categorization accuracy + calibration engine (DECISIONS #37).
 *
 * Pure, deterministic scoring over labeled predictions — no React, no DB. A
 * prediction is "labeled" once its actual (confirmed/known) category is set.
 *   - accuracy = fraction whose predicted category matched the actual one.
 *   - Brier score = mean squared error between the model's stated probability
 *     (confidence as p that it's correct) and the binary outcome (1 = correct).
 *     Lower is better; it rewards being confident when right AND unsure when
 *     wrong, so it measures CALIBRATION, not just hit-rate.
 *
 * This is how "the AI improves over time" is made measurable rather than
 * asserted (CLAUDE.md §adaptive runtime): every prediction is logged and scored
 * against ground truth as it arrives.
 */
export interface PredictionSample {
  predictedCategoryId: string;
  /** Model confidence in basis points (0–10000) that the prediction is right. */
  confidenceBps: number;
  /** The confirmed/known truth. Only labeled samples are passed in. */
  actualCategoryId: string;
}

export interface AccuracyResult {
  /** Number of labeled samples scored. */
  n: number;
  /** How many predictions matched the actual category. */
  correct: number;
  /** Accuracy in basis points (0–10000); 0 when there are no samples. */
  accuracyBps: number;
  /** Brier score ×1000, rounded (0 = perfect calibration, 1000 = worst). */
  brierMilli: number;
}

function clampProb(bps: number): number {
  if (bps < 0) return 0;
  if (bps > 10000) return 1;
  return bps / 10000;
}

export function scorePredictions(samples: readonly PredictionSample[]): AccuracyResult {
  const n = samples.length;
  if (n === 0) return { n: 0, correct: 0, accuracyBps: 0, brierMilli: 0 };

  let correct = 0;
  let brierSum = 0;
  for (const s of samples) {
    const hit = s.predictedCategoryId === s.actualCategoryId;
    if (hit) correct += 1;
    const p = clampProb(s.confidenceBps);
    const o = hit ? 1 : 0;
    brierSum += (p - o) * (p - o);
  }

  return {
    n,
    correct,
    accuracyBps: Math.round((correct / n) * 10000),
    brierMilli: Math.round((brierSum / n) * 1000),
  };
}
