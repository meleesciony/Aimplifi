# A task row's prescribed fix is a hypothesis too — measure the FIX, not just the bug

**One line:** O.20g's row named the defect correctly and prescribed a fix that, applied alone, made
the owner's live income-growth figure **five orders of magnitude worse**; the probe that caught it
was written before the code, and the only reason it caught it is that it measured the state AFTER
the prescription, not just the state the row complained about. (Magnitudes re-verified 2026-08-11
under O.20k, after the probe itself was found to carry the reconciliation-boundary bug — the
direction held; the specific figures corrected below.)

## What happened

TASKS O.20g was written by a critic and was right about everything it asserted: the lifestyle-creep
detector added EVERY positive row to its income series, so a merchandise return counted as a raise,
printing "income grew ~33.3%" and — because `flagged` is a DIFFERENCE — able to silence the very
warning the detector exists to raise. Its prescription was equally reasonable: gate the accumulator
with `isIncomeFlowRow`, the predicate `monthlyFlows` already uses four functions up (#166).

A read-only production probe was written first, in the C.19 pattern. It measured both arms — the
shipped rule and the counterfactual under the prescribed fix — per real user. The result:

```
positives the OLD rule counted as income and isIncomeFlowRow refuses: 42 rows, $28673.90
first-half income median: OLD $10604.95  ->  NEW $0.08
growth: spend 59.7% (approx meta) / income  ->  40,607,025.0%
```

The gating is correct. It is also, by itself, a regression: removing the miscounted positives left a
first-half median of **8 cents**, and growth is `(last - first) / first`, so the ratio exploded.
That figure never printed (its sentence only renders when flagged) — but it silenced the flag, so
the owner's real /coach page said *"Spending growth is tracking income growth — no lifestyle drift
detected"* while his discretionary spending grew ~59.7% (approx meta). Shipping the row as written
would have kept the false all-clear and made the number underneath it far worse.

The figures here were re-verified 2026-08-11 under O.20k: the probe's original run (67 rows /
$38,619.68; spend 153.3% / income 592.1% → 70,470,525%) was computed with a silent
reconciliation-boundary bug (a single object passed where the keep filter takes two positional
args), so every probe-computed magnitude was tainted. The fixed probe confirms the first-half
median **$10,604.95 → $0.08 exactly** and the verdict state, and supersedes the other magnitudes
with the corrected block above; the old-rule growth figures (153.3% / 592.1%) are not reproducible
from the corrected probe and are dropped rather than guessed at.

## Why it generalizes

A task row is authored at one moment, against one understanding, usually by someone who found the
bug rather than someone who traced the fix. `plan-verdicts-are-authoring-time-not-current-state`
already records that a row's VERDICT goes stale. This is the sharper sibling: a row's **remedy** can
be wrong on arrival, and it is wrong in the most dangerous way — it is locally correct, it makes the
described symptom disappear, and it moves the damage somewhere the row never looked.

The shape to watch for: **any fix that REMOVES terms from a divisor, a denominator, a baseline, a
median, or a count that something else divides by.** Removing wrong inputs is right; it also shrinks
the quantity, and downstream ratios do not care that the shrink was principled.

## The rule

1. When a row prescribes a fix, measure the state the fix PRODUCES, not only the state it
   complains about. One extra column in the probe (`OLD baseline -> NEW baseline`) is the whole
   cost, and it is what caught this.
2. Treat the row's remedy as a hypothesis with the same status as your own. If measurement
   contradicts it, the row is amended and the amendment is recorded — do not follow a prescription
   past your own evidence, and do not silently substitute a different fix without saying which
   prescription failed and why.
3. A slice that must add a second, unprescribed change to stay honest is not scope creep; shipping
   only half of it is the defect. Say so in the record, because the next reader will otherwise ask
   why the slice is bigger than its row.

## See also

- `three-sessions-of-hypothesis-one-query-of-evidence.md` — the inverse failure: hypothesising
  where one query would have decided it.
- `a-fix-that-cannot-fail-a-test-is-a-hypothesis.md` — the same slice also proved its own locks did
  not bind; that file carries the median half of this story.
- `check-what-the-fix-breaks-before-what-it-fixes.md` (C.13) — rank the divergence you create
  against the one you remove.
