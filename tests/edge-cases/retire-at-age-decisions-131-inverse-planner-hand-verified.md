## §Retire-at-age (DECISIONS #131 — inverse planner, hand-verified)

`solveRetireAtAge` is the THIRD inverse planner (after debt #125 and savings #126). State a target
retirement AGE ("can I retire at 60?") and it SOLVES for the minimal monthly contribution that makes
the portfolio LAST through the plan-through age, with honest feasibility. Unlike the flat savings
twin, the portfolio COMPOUNDS, so there is no closed form — it BISECTS the boolean
`projectRetirement(...).outcome === 'sustained'` (the #122 decumulation engine, assembled through the
SAME `buildRetirementInputs` the /investments outlook uses; the solver never re-implements
compounding/withdrawal math). The depleted→sustained flip is one-directional (more money never
un-sustains), so the predicate flips at most once and the bisection is exact. `shareOfSafeToSpendBps`
is computed on the ADDITIONAL money (required − current), identical bps rule to the twins. Pinned in
`tests/unit/retire-at-age.test.ts`.

**Why the "+1":** the engine treats a balance reaching exactly 0 after a withdrawal as DEPLETED
(`p <= 0`), so the minimal SUSTAINING contribution is one cent above the break-even. In the
real-return-0 cases below (nominal = inflation ⇒ growth is the identity) the math is closed-form:
`balanceAtRetirement = accumMonths × monthly`, and sustained ⇔ `balanceAtRetirement > decumMonths × W`
where `W = round(annualSpending / 12)`.

### RA-0PCT. Reachable, real-return 0 — exactly $2,000.01/mo
currentAge 40, targetAge 50 (accum 120mo), endAge 70 (decum 240mo), portfolio 0, currentMonthly 0,
annualSpending 1,200,000c ⇒ W = 100,000c, nominal 250 = inflation 250 ⇒ real 0, swr 400, safeToSpend
300,000c. decum need = 240 × 100,000 = 24,000,000c. sustained ⇔ 120·monthly > 24,000,000 ⇔ monthly >
200,000 ⇒ **requiredMonthly 200,001c**; requiredAdditional 200,001c (current 0); balanceAtRetirement =
120 × 200,001 = **24,000,120c**; endBalance = 24,000,120 − 24,000,000 = **120c**;
sustainableAnnualWithdrawal = round(24,000,120 × 4%) = **960,005c**; share = round(200,001 / 300,000 ×
10000) = **6,667 bps**; within = true; outcome `reachable`.

### RA-CURRENT. The current rate is subtracted from the required TOTAL
RA-0PCT with currentMonthly 50,000c. The minimal TOTAL is unchanged (200,001c — it depends only on the
goal, not the current rate); requiredAdditional = 200,001 − 50,000 = **150,001c**; share =
round(150,001 / 300,000 × 10000) = **5,000 bps**; within = true.

### RA-ONTRACK. Already-on-track — the current rate already sustains
RA-0PCT with currentMonthly 250,000c. sustains(250,000): 120 × 250,000 = 30,000,000 > 24,000,000 ⇒
outcome `already-on-track`; requiredMonthly = currentMonthly 250,000c (echo); requiredAdditional **0**;
balanceAtRetirement 30,000,000c; endBalance 30,000,000 − 24,000,000 = **6,000,000c**;
sustainableAnnualWithdrawal round(30,000,000 × 4%) = **1,200,000c**; share 0 bps; within true.

### RA-D. Reachable but OVER budget — honest figure, flagged unaffordable
currentAge 40, targetAge 41 (accum 12mo), endAge 61 (decum 240mo), portfolio 0, annualSpending
1,200,000c (same 24,000,000c need), safeToSpend 100,000c. 12·monthly > 24,000,000 ⇔ monthly >
2,000,000 ⇒ requiredAdditional **2,000,001c**; share = round(2,000,001 / 100,000 × 10000) = **200,000
bps** (2000%, NOT clamped); within = false; outcome stays `reachable` (a real figure, never a fake yes).

### RA-G. Overspent — safe-to-spend ≤ 0
requiredAdditional is unchanged (still 200,001c in RA-0PCT), but shareOfSafeToSpendBps and
withinSafeToSpend are both `null` (a share of a non-positive budget is meaningless).

### Unreachable branches (the ONLY three)
With ≥ 1 accumulation month an unbounded contribution ALWAYS sustains, so a near-term aggressive age
is `reachable` (over-budget), NOT unreachable. The only honest `unreachable` cases:
- **age-in-past** — targetAge < currentAge (e.g. 39 < 40). Pre-checked before the engine (which throws).
- **age-after-end** — targetAge > endAge (e.g. 100 > 95). Pre-checked before the engine.
- **cannot-sustain** — targetAge == currentAge (accum 0 ⇒ no contribution can land) AND the seed
  portfolio alone can't cover the spend. requiredMonthly/Additional/share/within all `null`;
  plannedAnnualWithdrawal is still echoed for the copy.

### Minimality + monotonicity (why the bisection is valid)
The test pins `sustains(required)` true AND `sustains(required−1)` false, recomputed INDEPENDENTLY
straight from `projectRetirement` — including a real-compounding case (nominal 700 − inflation 250 =
4.5% real, no closed form). A property sweep confirms the sustained predicate flips false→true once as
the contribution rises.

### Card consistency (why no Goal row — persist the age instead)
Unlike the debt/savings slices, a retire-at-age plan persists the chosen age to the existing
`User.retirementAge` dial (`saveRetirementAge`), NOT a flat savings `Goal`. The decumulation engine
compounds returns net of inflation, so a flat `ceil(remaining/months)` Goal would CONTRADICT it (the
§Savings "card consistency" precedent inverted). `User.retirementAge` already feeds the same engine the
/investments outlook + what-if recompute live, so the plan can't drift and nothing is duplicated.
