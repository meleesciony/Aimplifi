## §Savings-goal-by-date (DECISIONS #126 — inverse planner, hand-verified)

`solveSavingsGoalByDate` is the sibling of the debt planner above. Savings funding is LINEAR (no
investment growth — a near-term envelope is cash, not a portfolio), the SAME flat model the /goals
card uses (`goalFundingMonths` = `ceil(remaining / monthly)`), so the minimal monthly is closed-form:
`requiredMonthly = ceil(remaining / targetMonths)` is exactly the smallest integer m with
`ceil(remaining / m) ≤ targetMonths`. `share = round(requiredMonthly / safeToSpend × 10000)` bps,
identical to the debt twin's rule. Every figure below is hand-derived to the cent and pinned in
`tests/unit/savings-goal-by-date.test.ts` (today = 2026-06-10 unless noted). `remaining =
max(0, goalAmount − currentSavings)`; the app passes currentSavings = 0 (a fresh envelope, like
createGoal's savedCents), but the engine is general and the already-funded case is tested.

### SG-A. Simple — $6,000 over 12 months → exactly $500.00/mo
goal 600000c, current 0, 12 whole months, safeToSpend 200000c. remaining = 600000;
requiredMonthly = ceil(600000 / 12) = **50000c** ($500.00); monthsToGoal = ceil(600000/50000) = 12;
share = round(50000/200000×10000) = 2500 bps (25%); withinSafeToSpend = true; outcome `reachable`.

### SG-B. Already-funded — current ≥ goal → $0/mo
goal 100000c, current 200000c. remaining = max(0, −100000) = 0 ⇒ outcome `already-funded`,
requiredMonthly = 0, monthsToGoal = 0, share = 0 bps, within = true, remainingCents = 0.

### SG-C. Non-divisible — $5,000 over 7 months → exactly $714.29/mo (ceil)
goal 500000c, current 0, targetDate 2027-01-10 (7 whole months), safeToSpend 100000c.
requiredMonthly = ceil(500000 / 7) = ceil(71428.57…) = **71429c** ($714.29); check 7 × 71429 =
500003 ≥ 500000, and required−1 (71428) funds in ceil(500000/71428) = 8 > 7 (minimal). monthsToGoal =
ceil(500000/71429) = 7; share = round(71429/100000×10000) = round(7142.9) = 7143 bps (71%); within = true.

### SG-D. Reachable but OVER budget — honest figure, flagged unaffordable
goal 1200000c ($12,000), current 0, 2 months, safeToSpend 50000c. requiredMonthly = ceil(1200000/2) =
**600000c** ($6,000/mo); share = round(600000/50000×10000) = 120000 bps (**1200%**, NOT clamped) and
withinSafeToSpend = false. Outcome stays `reachable` — the real number is reported with an honest
"beyond a single month's budget" flag, never a fake yes and never a figure-less refusal.

### SG-E. Unreachable — a date today or in the past
remaining > 0 and targetMonths < 1 (the date is this month or earlier). Outcome `unreachable`,
requiredMonthly = null, monthsToGoal = null, share/affordability null; remainingCents is still
reported for the answer copy. (Unlike debt there is no "too high an APR" unreachable — any remaining
is reachable in ≥ 1 month at a large enough monthly — so "too soon" is the ONLY unreachable case.)

### SG-F. Overspent — safe-to-spend ≤ 0
The required figure is unchanged by safe-to-spend (e.g. still 50000c in SG-A), but
shareOfSafeToSpendBps and withinSafeToSpend are both `null` (a share of a non-positive budget is
meaningless), never a divide-by-zero or a negative percent.

### SG-G. Early finish — integer rounding can land a month before the deadline
goal 10c over 6 months: requiredMonthly = ceil(10/6) = 2c, which funds in ceil(10/2) = 5 months ≤ 6.
So `monthsToGoal` (5) can be strictly < `targetMonths` (6) — honest ("you'd actually hit it a touch
early"), never later than the deadline. Always `monthsToGoal ≤ targetMonths`.

### Card consistency (why no new Goal.kind is needed)
A goal saved at the solved monthly renders an IDENTICAL timeline on /goals, because the solver's
`monthsToGoal` and the card's `goalFIImpact.monthsToGoal` call the SAME `goalFundingMonths` — pinned by
a test that drives the real card path. (This is the #125 lesson — there a NEW debt-aware card was needed
because debt amortization contradicts the flat card; here the flat card is already correct.)
