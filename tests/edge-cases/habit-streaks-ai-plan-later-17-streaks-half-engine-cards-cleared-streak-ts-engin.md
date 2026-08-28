## §Habit Streaks (AI plan §Later #17 streaks half — `engine/cards/cleared-streak.ts` / `engine/recurring/creep-streak.ts`, DECISIONS #254)

Two pure retrospective walks; no persistence, no LLM. The savings-rate streak (#205,
`savings-streak.ts`) is the sibling convention: streaks are a pure function of history.

### Card cleared-in-full streak (`computeCardClearedStreak`)

Definitions (each a hand-locked test):
- **Resolved** statement: `isEstimated !== true` AND `dueDate < today` (STRICT — on the due
  date itself the statement is still open; an autopay dated that day hasn't "missed").
- **Cleared**: `statementBalanceCents ≤ 0`, OR the sum of its payments **dated ≤ dueDate**
  ≥ `statementBalanceCents`. Late full payment is NOT cleared-by-due-date (interest basis);
  the copy states "paid in full by its due date" inline.
- **Month qualifies**: every resolved statement with `ym(dueDate)` = that month is cleared.
  A month with NO resolved statements qualifies (nothing due = nothing missed) but only
  counts inside the walk span.
- **Full months only (critic #254 F2)**: statements resolving inside the CURRENT partial
  month are excluded from the walk entirely — they neither extend nor break the streak
  until the month completes (the sibling creep walk's lag-honest basis; overdue-now
  urgency belongs to reminders/cash-needed). When the ONLY resolved statements sit in the
  current partial month, `formingThisMonth: true` and the UI renders a forming line —
  "no statement has come due yet" would be false for that user.
- **Walk**: calendar months descending from the latest FULL month containing a resolved
  statement (`latestMonth`) down to the earliest such month; stop at the first month with
  an uncleared resolved statement (`brokeAt`); `streakMonths` = qualifying months counted.
  No resolved statements at all → `streakMonths 0, latestMonth null` → UI abstains.

Hand cases:
- C1: two cards, dues 3/15, 4/15, 5/15 all paid in full on due date, today 6/10 → streak 3.
- C2: latest due 6/15 with today 6/10 is unresolved — neither counts nor breaks (C1 data +
  future statement → still 3).
- C3: 5/15 balance 120000, single payment 120000 dated 5/17 (late) → May fails → streak 0,
  brokeAt 2026-05; the 3/15+4/15 cleared months above it are unreachable (walk stops).
- C4: 5/15 balance 120000, payments 40000+80000 both ≤ 5/15 → cleared (sum rule).
- C5: partial 100000 of 120000 by due → fails.
- C6: balance 0, no payment rows → cleared (Store-card $0 cycles).
- C7: statements due May and March only (April gap), all cleared → streak 3 (gap month
  qualifies inside the span); span floor = March (walk never counts below earliest signal).
- C8: `isEstimated: true` row is invisible (excluded before grouping).
- C9: overpayment (130000 of 120000) → cleared.
- C10 (critic F2): May cleared + a cleared statement due 6/05 with today 6/10 → streak 1
  through May; the partial-month statement is not counted.
- C11 (critic F2): May cleared + a MISSED statement due 6/05, today 6/10 → streak 1,
  brokeAt null; the SAME data at today 7/01 → streak 0, brokeAt 2026-06 (the break
  surfaces when the month completes — lag-honest, not hidden).
- C12 (critic F2): ONLY a resolved 6/05 statement, today 6/10 → streak 0, latestMonth
  null, `formingThisMonth: true` → forming copy, never "no statement has come due yet".
- **Seed lock** (asOf 2026-06-10): historical statements for sapphire/platinum/freedom
  (back 1–17: dues 2025-01-15..2026-05-15 / same / 2025-01-28..2026-05-28) are all
  seed-paid IN FULL ON the due date; store back 0–14 even offsets (dues 2025-03-15..
  2026-05-15 odd months, $0 cycles at back 6 and 12) all cleared; June dues (6/15, 6/15,
  6/28) unresolved at pinned demo today 2026-06-10. Every month 2025-01..2026-05 has ≥1
  resolved statement and qualifies → **streakMonths 17, latestMonth 2026-05, 4 cards,
  brokeAt null**.

### No-subscription-creep streak (`computeNoCreepStreak`)

Definitions:
- Universe: detected series with `isSubscription` (the #246/#249 subscription flag; income
  and non-subscription bills excluded). No subscription series → `streakMonths null`
  (abstain — a vacuous "no creep" over zero subscriptions is not an achievement).
- **Creep event**: `priceChangedAt` set AND `|typicalAmountCents| > |previousAmountCents|`
  (an increase; decreases never break) at month `ym(priceChangedAt)`. The detector retains
  at most one price change per series (two-plateau rule) and drops ≥3-plateau series
  entirely, so within the detector's own history window every knowable increase is visible.
- **Walk**: full months descending from `ym(today)−1`, capped at `windowMonths` (12,
  disclosed in copy — "in the last N full months"); stop at the first month containing a
  creep event; `brokeOn` = that event (same-month ties: largest increase, then merchant
  ascending). An increase inside the CURRENT partial month is invisible to the walk by
  construction — the copy says "full months" (lag-honest, #252 precedent); the
  price-increase opportunity surface (#207/#246) owns same-month news.

Hand cases:
- N1: no subscription series → null (abstain), count 0.
- N2: increase first charged 2026-02-03, today 2026-06-10 → walk May✓ Apr✓ Mar✓ Feb✗ →
  streak 3, brokeOn month 2026-02.
- N3: decrease (1799 → 1549: |typical| 1549 < |previous| 1799) → not an event → cap 12.
- N4: no priceChangedAt anywhere → streak 12 (cap), brokeOn null.
- N5: increase dated inside the current partial month → walk unaffected (streak unchanged).
- N6: two increases, 2026-02 and 2026-04 → walk breaks at the more recent (Apr) → streak 1.
- N7: increase 13+ months back → outside window → 12.
- N8: `isIncome` series with a raise is not creep (isSubscription false by construction).
- N9 same-month tie: events (+200) and (+450) both in 2026-03 → brokeOn is the +450 one.
- **Seed lock** (asOf 2026-06-10): the only seeded subscription price change is Netflix
  1549 → 1799 first charged **2026-02-03** (`netflixIncreaseMonth = asOf−4mo`) → streak
  **3**, brokeOn {netflix canonical, 1549, 1799, 2026-02}, subscription count = the seed's
  detected `isSubscription` series (asserted from the live detector, not hardcoded).
