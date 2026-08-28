## §Debt-free-by-date (DECISIONS #125 — inverse planner, hand-verified)

`solveDebtFreeByDate` BISECTS the monotone `planDebtPayoff` for the minimal extra/mo that clears all
debt by a target date (the `coastFI` idiom). Every figure below is hand-derived and pinned in
`tests/unit/debt-free-by-date.test.ts` (today = 2026-06-10 unless noted).

### A. Zero-interest, $1,200 over 12 months → exactly $100.00/mo extra
1 debt: balance 120000c, apr 0, min 0. Budget = extra (min 0); cleared at `ceil(120000 / extra)`.
`≤ 12 ⇔ extra ≥ 10000`. Minimal extra = **10000c** ($100.00/mo); monthsToDebtFree = 12; at
safeToSpend 100000c the share = 1000 bps (10%), withinSafeToSpend = true; outcome `reachable`.

### B. On-track — minimums alone make the date → $0 extra
1 debt: 120000c, apr 0, min 20000. extra 0 clears in `ceil(120000/20000) = 6 ≤ 12` ⇒ the bisection
converges to 0: requiredExtra = **0**, monthsToDebtFree = 6, outcome `on-track`.

### C. Unreachable — a date today or in the past
targetMonths < 1 (the date is this month or earlier). No non-zero debt can clear in 0 months, so
outcome `unreachable`, requiredExtra = null, monthsToDebtFree = null, share/affordability null. (The
ONLY unreachable case for non-zero debt: paying everything in month 1 always works for targetMonths ≥ 1,
so "too soon" means strictly < 1 cycle.)

### D. Reachable but OVER budget — honest figure, flagged unaffordable
$12,000 (1200000c) at 0% in 3 months: `ceil(1200000/extra) ≤ 3 ⇔ extra ≥ 400000`. Minimal extra =
**400000c** ($4,000/mo). At safeToSpend 100000c the share = 40000 bps (**400%**, NOT clamped) and
withinSafeToSpend = false. Outcome stays `reachable` — the real number is reported with an honest
"more than your whole safe-to-spend" flag, never a fake yes and never a figure-less refusal.

### E1. With interest — $1,000 @ 24% APR in 1 month → exactly $1,020.00
month 1 interest = round(100000 × 2400 / 10000 / 12) = round(2000) = 2000 ⇒ owed 102000; cleared iff
extra ≥ 102000. Minimal extra = **102000c**; monthsToDebtFree = 1.

### E2. With interest — $1,000 @ 24% APR in 2 months → exactly $515.05
m1 leaves `102000 − E`; m2 clears iff `(102000−E) + round((102000−E)×0.02) ≤ E`. Max remaining 50495
(2×50495 + round(1009.9 = 1010) = 102000) ⇒ E = 102000 − 50495 = **51505c**; monthsToDebtFree = 2.
(MINIMALITY is locked independently: `worksIndependently(required)` true and `worksIndependently(required−1)`
false, recomputed straight from `planDebtPayoff` — proving the bisection returns the true minimum.)

### F. Already debt-free — nothing to solve
No debts (or all balances ≤ 0) ⇒ outcome `already-debt-free`, requiredExtra 0, monthsToDebtFree 0,
totalBalanceCents 0.

### G. Overspent — safe-to-spend ≤ 0
The required figure is unchanged by safe-to-spend (e.g. still 10000c in case A), but
shareOfSafeToSpendBps and withinSafeToSpend are both `null` (a share of a non-positive budget is
meaningless), never a divide-by-zero or a negative percent.

### Monotonicity (why the bisection is valid)
`planDebtPayoff.monthsToDebtFree` is non-increasing in `extraMonthlyCents` (more budget ⇒ each debt's
balance trajectory is pointwise ≤ the lower-budget one ⇒ payoff never later; null = never = +∞). A
property test sweeps extra 0…400000 over a mixed portfolio and asserts the months never increase.
