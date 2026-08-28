## §Upcoming renewals (AI plan §3.4, DECISIONS #246)

Engine: `src/lib/engine/recurring/renewals.ts`; tests:
`tests/unit/recurring-renewals.test.ts`. Pure forward expansion of ACTIVE expense series
from `nextExpectedAt` by cadence (detect.ts's own `nextDate` — one source of cadence
arithmetic) over a 90-day inclusive window, with nested 7/30/90-day buckets. All values
below hand-verified with `today = 2026-07-10` (window end **2026-10-08**: Jul 21
remaining + Aug 31 + Sep 30 + Oct 8 = 90).

- **Predicted amount = |lastAmountCents| verbatim** — the most recent real charge; after
  a two-plateau price change that is the NEW price (Netflix seed: every occurrence
  predicts $17.99, never $15.49) and the occurrence carries `increasedFromCents` (the
  magnitude it rose FROM, via `priceChangeBadge`; null when no increase) so the UI says
  "↑ was $15.49" — a fact the detector records, never a time adverb it doesn't (critic
  P2-1). The engine never computes an amount; the UI labels the whole section
  "estimates, not bills".
- **Monthly** from 07-28: `[07-28, 08-28, 09-28]`, daysOut `[18, 49, 80]`.
- **Weekly** $5.00 from 07-12: 13 occurrences (07-12 … 10-04; next 10-11 is out);
  7d bucket 1 × $5.00; 30d bucket 5 (07-12/19/26, 08-02, 08-09 — boundary inclusive).
- **Biweekly** from 07-15: 7 occurrences (07-15 … 10-07; next 10-21 = daysOut 103 out).
- **Month-end stepping clamps** exactly like detection: 07-31 → 08-31 → 09-30 (and the
  next step is 10-30 — the clamp drift is the shared `nextDate` rule, unchanged).
- **Boundaries:** an occurrence expected TODAY counts (daysOut 0, 7d bucket); exactly
  today+90 (10-08, daysOut 90) is IN; 10-09 is out. A stale `nextExpectedAt` before
  today re-advances by cadence — a past date is never emitted.
- **Included:** active expense series only — subscriptions AND bills (auto-loan, rent);
  ANNUAL only when genuinely detected (detection's ≥3-occurrence gate ⇒ ~3 years of
  history, satisfying the plan's ≥2yr caveat by construction). **Excluded:** income
  (payroll is not a renewal), inactive/lapsed series, and IRREGULAR input (detection
  never emits one, but the exported engine skips it explicitly rather than inventing a
  monthly schedule — critic P2-2, locked).
- **One bucket predicate:** `renewalsWithin` computes the horizon tiles AND the UI's
  next-30-days list, so the 30d tile count equals the rendered rows by construction
  (critic P2-3).
- **Horizon buckets nest** (7d ⊆ 30d ⊆ 90d, counts and totals monotone); combined
  fixture: 7d = 1/$5.00; 30d = 6/$42.99 (5×$5.00 + $17.99); 90d = 17/$217.97
  (13×$5.00 + 3×$17.99 + $99.00 annual).
