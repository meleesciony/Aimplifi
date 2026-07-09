/**
 * Bounded per-user threshold tuning (TASKS 3.6, DECISIONS #190) — pure engine.
 * Every expected value is hand-verified in docs/EDGE_CASES.md §Threshold tuning:
 * per-sample Brier contributions are (p − outcome)², so at 0.9 confidence a hit
 * contributes 10 milli and a miss 810; the offset mapping is
 * clamp((brierMilli − 150) × 5, ±500).
 */
import { describe, expect, it } from 'vitest';

import type { PredictionSample } from '@/lib/engine/accuracy/score';
import { AUTO_FLAGGED_BPS, AUTO_SILENT_BPS, categorize } from '@/lib/engine/categorize/pipeline';
import {
  MIN_TUNING_SAMPLES,
  offsetForBrierMilli,
  TUNE_SPAN_BPS,
  tuneFlaggedThreshold,
} from '@/lib/engine/categorize/tuning';

/** n committed samples at `confidenceBps`, of which `misses` were corrected away. */
function batch(n: number, confidenceBps: number, misses: number): PredictionSample[] {
  return Array.from({ length: n }, (_, i) => ({
    predictedCategoryId: 'shopping',
    confidenceBps,
    actualCategoryId: i < misses ? 'dining' : 'shopping',
  }));
}

describe('offsetForBrierMilli — the pure Brier→offset mapping', () => {
  it('maps the hand-verified anchor points', () => {
    expect(offsetForBrierMilli(0)).toBe(-500); // perfect calibration → full loosening
    expect(offsetForBrierMilli(50)).toBe(-500); // span edge
    expect(offsetForBrierMilli(90)).toBe(-300); // (90-150)*5
    expect(offsetForBrierMilli(130)).toBe(-100);
    expect(offsetForBrierMilli(150)).toBe(0); // pivot
    expect(offsetForBrierMilli(151)).toBe(5); // 1 milli = 5 bps
    expect(offsetForBrierMilli(250)).toBe(500); // span edge
    expect(offsetForBrierMilli(340)).toBe(500); // clamped (raw +950)
    expect(offsetForBrierMilli(1000)).toBe(500); // worst possible Brier, still clamped
  });
});

describe('tuneFlaggedThreshold — known-answer cases (EDGE_CASES §Threshold tuning)', () => {
  it('below MIN_TUNING_SAMPLES committed samples → global threshold, insufficient-samples', () => {
    const r = tuneFlaggedThreshold(batch(MIN_TUNING_SAMPLES - 1, 9000, 0));
    expect(r).toEqual({
      flaggedBps: AUTO_FLAGGED_BPS,
      offsetBps: 0,
      reason: 'insufficient-samples',
      sampleCount: 19,
      brierMilli: null,
      recentBrierMilli: null,
      priorBrierMilli: null,
    });
  });

  it('well-calibrated user loosens: 20 @0.9 with 2 misses → Brier 90 → 6700', () => {
    // sum = 18(.01) + 2(.81) = 1.80 → mean .090 → 90 milli → (90−150)*5 = −300
    const r = tuneFlaggedThreshold(batch(20, 9000, 2));
    expect(r.brierMilli).toBe(90);
    expect(r.offsetBps).toBe(-300);
    expect(r.flaggedBps).toBe(6700);
    expect(r.reason).toBe('tuned');
    expect(r.sampleCount).toBe(20);
  });

  it('heavily-corrected user tightens and clamps: 20 @0.8 with 10 misses → Brier 340 → 7500', () => {
    // sum = 10(.04) + 10(.64) = 6.80 → mean .340 → 340 milli → raw +950 → clamp +500
    const r = tuneFlaggedThreshold(batch(20, 8000, 10));
    expect(r.brierMilli).toBe(340);
    expect(r.offsetBps).toBe(500);
    expect(r.flaggedBps).toBe(7500);
    expect(r.reason).toBe('tuned');
  });

  it('exactly at the pivot → offset 0, baseline: 20 @0.7 with 3 misses → Brier 150', () => {
    // sum = 17(.09) + 3(.49) = 3.00 → mean .150 → 150 milli → offset 0
    const r = tuneFlaggedThreshold(batch(20, 7000, 3));
    expect(r.brierMilli).toBe(150);
    expect(r.offsetBps).toBe(0);
    expect(r.flaggedBps).toBe(AUTO_FLAGGED_BPS);
    expect(r.reason).toBe('baseline');
  });

  it('regression auto-revert: good prior (50) then bad recent (330) → global threshold', () => {
    // prior 20 @0.9, 1 miss → (19(.01)+.81)/20 = .050 → 50 milli
    // recent 20 @0.9, 8 misses → (12(.01)+8(.81))/20 = .330 → 330 milli
    // 330 > 50 + 25 → revert. Overall (1.00+6.60)/40 = .190 → 190 milli reported.
    const r = tuneFlaggedThreshold([...batch(20, 9000, 1), ...batch(20, 9000, 8)]);
    expect(r.reason).toBe('reverted-regression');
    expect(r.flaggedBps).toBe(AUTO_FLAGGED_BPS);
    expect(r.offsetBps).toBe(0);
    expect(r.priorBrierMilli).toBe(50);
    expect(r.recentBrierMilli).toBe(330);
    expect(r.brierMilli).toBe(190);
  });

  it('the revert is one-sided: bad prior (330) then good recent (50) does NOT revert', () => {
    // 50 ≤ 330 + 25 → no revert; overall 190 → (190−150)*5 = +200 → 7200
    const r = tuneFlaggedThreshold([...batch(20, 9000, 8), ...batch(20, 9000, 1)]);
    expect(r.reason).toBe('tuned');
    expect(r.offsetBps).toBe(200);
    expect(r.flaggedBps).toBe(7200);
    expect(r.priorBrierMilli).toBe(330);
    expect(r.recentBrierMilli).toBe(50);
  });

  it('a regression within the margin does not revert: prior 50, recent 90', () => {
    // recent 20 @0.9, 2 misses → 90 milli; 90 ≤ 50 + 25 is FALSE (90 > 75) → reverts.
    // The margin twin: recent 1 miss (50) → 50 ≤ 75 → stays tuned at the overall Brier.
    const reverted = tuneFlaggedThreshold([...batch(20, 9000, 1), ...batch(20, 9000, 2)]);
    expect(reverted.reason).toBe('reverted-regression');
    const held = tuneFlaggedThreshold([...batch(20, 9000, 1), ...batch(20, 9000, 1)]);
    expect(held.reason).toBe('tuned');
    // overall = 2.00/40 = .050 → 50 milli → offset −500 → 6500
    expect(held.brierMilli).toBe(50);
    expect(held.flaggedBps).toBe(6500);
  });

  it('EXCLUDES abstentions: predicted-uncategorized rows never count (feedback-loop guard)', () => {
    // 19 committed + 6 abstentions the user later filed — abstentions are the review
    // queue working as designed, not auto-filing errors; counting them would tighten
    // exactly the users who review the most.
    const abstentions: PredictionSample[] = Array.from({ length: 6 }, () => ({
      predictedCategoryId: 'uncategorized',
      confidenceBps: 5000,
      actualCategoryId: 'dining',
    }));
    const r = tuneFlaggedThreshold([...batch(19, 9000, 0), ...abstentions]);
    expect(r.reason).toBe('insufficient-samples');
    expect(r.sampleCount).toBe(19);
  });

  it("EXCLUDES actual='uncategorized' rows (a deleted custom category is not ground truth)", () => {
    // 10 fake predicted==actual=='uncategorized' hits must not dilute the real 20.
    const rewritten: PredictionSample[] = Array.from({ length: 10 }, () => ({
      predictedCategoryId: 'uncategorized',
      confidenceBps: 9000,
      actualCategoryId: 'uncategorized',
    }));
    const real = batch(20, 8000, 10);
    expect(tuneFlaggedThreshold([...real, ...rewritten])).toEqual(tuneFlaggedThreshold(real));
  });

  it('recompute-from-scratch determinism: identical input → identical result', () => {
    const samples = [...batch(20, 9000, 1), ...batch(20, 8000, 4)];
    expect(tuneFlaggedThreshold(samples)).toEqual(tuneFlaggedThreshold(samples));
  });

  it('structural clamp: even an all-miss / all-hit history stays within ±500 bps', () => {
    const allMiss = tuneFlaggedThreshold(batch(40, 9999, 40));
    expect(allMiss.flaggedBps).toBe(AUTO_FLAGGED_BPS + TUNE_SPAN_BPS); // 7500
    const allHit = tuneFlaggedThreshold(batch(40, 9999, 0));
    expect(allHit.flaggedBps).toBe(AUTO_FLAGGED_BPS - TUNE_SPAN_BPS); // 6500
  });

  it('SAFETY INVARIANT: the tuned ceiling can never reach the silent band', () => {
    expect(AUTO_FLAGGED_BPS + TUNE_SPAN_BPS).toBeLessThan(AUTO_SILENT_BPS);
  });
});

describe('categorize() honors opts.flaggedBps (pipeline integration)', () => {
  const txn = (rawDescriptor: string, amountCents: number) => ({
    rawDescriptor,
    amountCents,
    date: '2026-06-15',
    accountId: 'acct-1',
  });

  it('default call and explicit global threshold are byte-identical', () => {
    for (const d of ['STORE CARD PURCHASE 1234', 'STARBUCKS #1234', 'TOTALLY UNKNOWN VENDOR']) {
      expect(categorize(txn(d, -5000), [], { flaggedBps: AUTO_FLAGGED_BPS })).toEqual(
        categorize(txn(d, -5000), []),
      );
    }
  });

  it('loosened boundary auto-files a below-global merchant match — WITH the visible badge', () => {
    // 'STORE CARD PURCHASE' → shopping @6000: review at the global 7000…
    const global = categorize(txn('STORE CARD PURCHASE 1234', -5000), []);
    expect(global.needsReview).toBe(true);
    expect(global.categoryId).toBe('uncategorized');
    // …auto-filed once the boundary sits at/below its confidence…
    const tuned = categorize(txn('STORE CARD PURCHASE 1234', -5000), [], { flaggedBps: 6000 });
    expect(tuned.needsReview).toBe(false);
    expect(tuned.categoryId).toBe('shopping');
    expect(tuned.aiBadge).toBe(true); // 6000 < AUTO_SILENT — never a silent filing
    // …and still reviewed one basis point above it.
    expect(categorize(txn('STORE CARD PURCHASE 1234', -5000), [], { flaggedBps: 6001 }).needsReview).toBe(true);
  });

  it('tightened boundary stops rescuing a Plaid MEDIUM-confidence hint (7200)', () => {
    const withHint = (flaggedBps?: number) =>
      categorize(
        {
          ...txn('XQZW UNRECOGNIZED LLC', -5000),
          providerCategoryHint: { categoryId: 'dining', confidenceBps: 7200 },
        },
        [],
        flaggedBps === undefined ? undefined : { flaggedBps },
      );
    const global = withHint();
    expect(global.needsReview).toBe(false); // 7200 ≥ 7000 → rescued
    expect(global.source).toBe('provider-category');
    expect(global.aiBadge).toBe(true);
    const tightened = withHint(7500); // max tighten: 7200 < 7500 → back to review
    expect(tightened.needsReview).toBe(true);
    expect(tightened.categoryId).toBe('uncategorized');
    const atBoundary = withHint(7200); // 7200 ≥ 7200 → still rescued
    expect(atBoundary.needsReview).toBe(false);
  });

  it('SAFETY INVARIANT: no flaggedBps value can produce a new SILENT filing', () => {
    // Even an absurd boundary of 0 auto-files everything only into the BADGED band.
    for (const d of ['STORE CARD PURCHASE 1234', 'TOTALLY UNKNOWN VENDOR']) {
      const out = categorize(txn(d, -5000), [], { flaggedBps: 0 });
      expect(out.needsReview).toBe(false);
      expect(out.aiBadge).toBe(true); // confidence < AUTO_SILENT_BPS ⇒ visible guess
    }
  });
});
