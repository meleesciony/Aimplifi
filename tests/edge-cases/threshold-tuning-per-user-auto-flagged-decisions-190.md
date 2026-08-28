## §Threshold tuning (per-user AUTO_FLAGGED, DECISIONS #190)

Engine: `src/lib/engine/categorize/tuning.ts`; tests: `tests/unit/tuning.test.ts`,
`tests/unit/threshold-tuning-labels.test.ts`. All values hand-verified below.

- **Inputs** — the user's USER-labeled `CategoryPrediction` rows (`labeledAt` set; seed
  labels carry none), chronological by label time, restricted to COMMITTED filings:
  `predicted ≠ 'uncategorized'` (abstentions routed to review are the queue working as
  designed — counting them as misses would tighten exactly the users who review most, a
  feedback loop) and `actual ≠ 'uncategorized'` (a deleted custom category rewrites
  labels to it; not ground truth).
- **Per-sample Brier contribution** is (p − outcome)², p = confidenceBps/10000:
  hit@0.9 → 10 milli, miss@0.9 → 810; hit@0.8 → 40, miss@0.8 → 640; hit@0.7 → 90,
  miss@0.7 → 490.
- **Offset map:** `clamp((brierMilli − 150) × 5, ±500)`; tuned threshold =
  7000 + offset ∈ **[6500, 7500]**. Pivot 150 milli ≈ 17–18% of committed filings
  corrected at ~0.9 confidence (mean ≈ hitRate·10 + missRate·810); full loosening −500
  at ≤50 milli (~5% corrected), full tightening +500 at ≥250 milli (~30%).
- **Known answers:** `< 20` committed samples → 7000 (`insufficient-samples`).
  20@0.9 with 2 misses → (18·0.01 + 2·0.81)/20 = 0.090 → 90 milli → **6700**.
  20@0.8 with 10 misses → 6.8/20 = 0.340 → 340 → raw +950 → clamp → **7500**.
  20@0.7 with 3 misses → (17·0.09 + 3·0.49)/20 = 0.150 → exactly the pivot → **7000**
  (`baseline`).
- **Regression auto-revert** (only when n ≥ 40): newest 20 vs everything prior;
  revert iff recent > prior + 25 milli (strict). Prior 20@0.9/1 miss = 50 milli, recent
  20@0.9/8 misses = 330 → 330 > 75 → **7000** (`reverted-regression`). One-sided: bad
  prior 330 then good recent 50 stays tuned (overall 190 → +200 → **7200**). Brier
  granularity at 0.9 is 40 milli per extra miss (10 + 40m per 20), so the margin's
  strictness is exercised at 50→90 (reverts) vs 50→50 (holds).
- **Invariants:** 7500 = flagged ceiling < AUTO_SILENT (9000) — and pipeline.ts keeps
  `aiBadge < AUTO_SILENT_BPS` against the global constant, so NO flaggedBps value can
  create a new silent filing (locked for absurd inputs 0 and 10000-adjacent).
  Recompute-from-scratch: identical input → identical output; undo deletes the label +
  stamp and the tuning fades on the next read. Demo/golden safety: seed labels have
  `labeledAt = null` → demo user is permanently `insufficient-samples` → global
  thresholds, byte-identical behavior.
- **Production bite today:** confidences in the tunable window are Plaid PFC MEDIUM
  hints (7200) — a tightened user (≥7201) stops auto-filing those; 'STORE CARD
  PURCHASE' (6000) stays in review even fully loosened (6500). Merchant defaults
  (9600), generic keywords (8500), Toast priors (8000) and vocab (7500) are outside the
  reachable window, so tuning cannot touch them.
