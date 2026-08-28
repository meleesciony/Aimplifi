## §Scenario Coherence (AI plan §Later #13 slice 1 — `engine/scenario/scenario.ts`, DECISIONS #255)

The snapshot-coherence engine behind Scenario Studio: ONE canonical state + knob-delta
application, so a knob (pay cut, spending change, extra debt payment) propagates to BOTH
representations the app's engines read — the AGGREGATE figures (coach derivation: monthly
income / savings, annual expenses) AND the PER-FLOW scheduled rows (forecast + cash-needed).
The decision-comparison half of #13 is permanently dropped (plan §4). No knob may ever apply
to one representation only: it applies to both, or not at all with a disclosed note.

Canonical identities (by construction, from the two verbatim coach figures):
- `monthlyExpensesCents = monthlyIncomeCents − monthlySavingsCents` (exact integer identity;
  `annualExpensesCents` stays the separate verbatim coach figure `expenses6×2` — the
  pre-existing rounding divergence between the two is inherited, not resolved here).
- `monthlyNetCents` = income − expenses after knobs (drives the savings RATE; may be negative).
- `monthlyInvestibleCents` = net − extraDebtMonthly (drives FI + retirement contribution).
  At base the two equal the verbatim coach `monthlySavingsCents`. Reallocating surplus to
  debt principal does NOT change the savings rate (income − expenses is unchanged) but DOES
  reduce what compounds — the split is the honest resolution of the ratio-vs-cents hazard.

Fixture SC (hand-built): today 2026-06-10; income 500000¢/mo, savings 120000¢/mo (→ expenses
380000¢), annualExpenses 4560000¢; portfolio 2500000¢; swr 400, expectedReturn 700 (nominal);
paymentAccountId 'acct-check'. Scheduled rows: R1 +250000 BIWEEKLY 'Paycheck' (acct-check),
R2 −150000 MONTHLY 'Rent' (acct-check), R3 +33333 MONTHLY 'Side gig' (acct-check).
Debts: D1 card 450000 @2199bps min 15000; D2 loan 800000 @649bps min 25000.

| # | knobs | hand-verified expected |
|---|-------|------------------------|
| S1 | none | identity: every adapter output deep-equals the base's; scheduled rows byte-identical; assumptions carry only the standing lines |
| S2 | income percent −1500 bps | aggregate delta = rHAFZ(500000×−1500/10000) = −75000 → income 425000, net 45000, investible 45000; expenses/annualExpenses unchanged; R1 → rHAFZ(250000×8500/10000)=212500, R3 → rHAFZ(33333×0.85)=rHAFZ(28333.05)=28333, R2 untouched; no synthetic row |
| S3 | income absolute −50000 | income 450000, net 70000; ONE synthetic MONTHLY row carrying the signed delta: {amountCents −50000, description 'Scenario: income adjustment', accountId 'acct-check', nextDate 2026-07-01 (first of next month)}; existing rows untouched |
| S4 | income percent −1500 AND absolute +20000 | order: percent first on base (−75000), then absolute (+20000) → income 445000, net 65000; rows scaled per S2 PLUS one synthetic +20000 monthly row |
| S5 | expense percent +1000 bps | monthlyExpenses 380000 → delta rHAFZ(380000×1000/10000)=+38000 → expenses 418000, net 82000, investible 82000; annualExpenses 4560000 + 12×38000 = 5016000; R2 → rHAFZ(−150000×1.1)=−165000; income rows untouched; savings-rate adapter = savingsRateBps(500000, 418000) = round((500000−418000)/500000×10000) = 1640 |
| S6 | expense absolute −25000 (cut $250/mo) | NO-OP + note 'a spending cut needs the percent knob' (rule E-CUT below: a cut names no bill, so it has no flow representation; a synthetic +25000 row would fabricate an inflow); aggregates UNCHANGED (both-or-neither rule) |
| S6b | expense absolute +25000 (add a $250/mo commitment) | expenses 405000, net 95000, investible 95000; annualExpenses 4560000+300000=4860000; ONE synthetic MONTHLY row {amountCents −25000, description 'Scenario: added spending', accountId 'acct-check', nextDate 2026-07-01}; existing rows untouched |
| S7 | extraDebt 30000 | net unchanged 120000; investible 90000; toDebtPlan.extraMonthlyCents 30000; synthetic row −30000 MONTHLY 'Scenario: extra debt payment' acct-check 2026-07-01; retirement contribution (builder-floored) 90000; savings rate UNCHANGED at the base 2400 bps |
| S8 | extraDebt 30000, debts all ≤0 balance | knob no-op + note 'no debts to pay'; investible stays 120000; no synthetic row; toDebtPlan.extraMonthlyCents 0 |
| S9 | paymentAccountId null + income absolute −50000 | knob no-op + note (cannot land a synthetic flow); aggregates UNCHANGED (both-or-neither rule) |
| S10 | income percent −10000 (clamp floor −100%) | income 0; net −380000 (negative, NOT floored); investible −380000; savings-rate adapter → null (income ≤ 0); retirement contribution floors to 0 via buildRetirementInputs; R1/R3 → 0-amount rows (kept, 0¢) |
| S11 | income percent −12000 (out of bounds) | clamped to −10000 → same as S10; clamp disclosed in notes |
| S12 | extraDebt −5000 (negative) | clamped to 0 → no-op (extra debt cannot be negative) |
| S13 | expense percent +1000 with NO negative scheduled rows (rows = R1,R3 only) | aggregate moves (expenses 418000 etc.); zero rows to scale is NOT a violation (the flow representation of expenses is empty; factor applied to the empty set); no note needed |
| S14 | income absolute −600000 (below −income) | income floors at 0; the synthetic row carries the EFFECTIVE delta −500000 (never the requested −600000 — both representations must agree); floor disclosed in notes |
| S15 | income percent +5000 on a base with monthlyIncome 0 (savings −380000, a deficit user) but income rows present | aggregate stays 0 (0 × any factor); rows scale (Paycheck 250000 → 375000); the visible asymmetry is DISCLOSED in notes ("average monthly income … is $0, so the percent change shows up only on your scheduled income flows"); same mirror rule on the expense side (critic F2) |
| S16 | NaN / Infinity / non-integer knob values (a cleared numeric form field is exactly NaN) | sanitize-and-note, never throw (critic F1): non-finite → knob ignored with a note; non-integer → rHAFZ-rounded with a note; state and synthetic rows always integer cents; adapters never throw |

Extra-debt duration assumption (critic F3): the synthetic extra-debt row and the investible
reduction have no end date, even though `planDebtPayoff` may clear the debts sooner — so
months-to-FI under an aggressive payoff carries a stated assumption line ("modeled as
continuing for the whole projection, even after the debts would be paid off"), appended
only when the knob actually applied.

rHAFZ = roundHalfAwayFromZero, applied ONCE per materialized value: once for the aggregate
delta, once per scaled row. S5 savings-rate check: savingsRateBps(500000, 418000) =
Math.round(82000/500000×10000) = Math.round(1640) = 1640 bps. S7 base rate:
Math.round(120000/500000×10000) = 2400 bps, unchanged by the extra-debt knob.

Rule E-CUT (settled): absolute expense knob X>0 (new committed spending, e.g. "add a $250/mo
car payment") = aggregate + synthetic −X monthly outflow. X<0 ("cut $250 somewhere") names no
bill, so no flow representation exists; per the both-or-neither rule it is a NO-OP with a
disclosed note steering to the percent knob. Income absolute is representable in both
directions (one paycheck stream more or less is a real dated flow either way).

Adapter conventions (each downstream engine's OWN convention, preserved verbatim):
- FI: un-floored investible; NOMINAL expectedReturnBps; fiNumber from scenario annualExpenses.
- Retirement: RetirementBaseInputs with un-floored figures — `buildRetirementInputs` (the one
  shared builder) floors at 0 and derives the real return; scenario never re-implements either.
- Savings rate: savingsRateBps(income′, expenses′) — null on income ≤ 0, preserved.
- Forecast + cash-needed: BOTH read the SAME adjusted `scheduledRows` (ScheduledLike shape,
  synthetic rows included); statements/cards/autopays pass through UNTOUCHED (an issued
  statement is history — a scenario cannot rewrite it; stated in assumptions).
- Debt: DebtPlanInput with scenario extraMonthlyCents; debts pass through (balances are facts).
