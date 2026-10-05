## §Bonuses pay this month's savings first (DECISIONS #784 / #787)

Engine: `src/lib/engine/spending-plan/bonus.ts` (`bonusesThisMonth`, `bonusTowardSavingsCents`);
plan terms `bonusTowardSavingsCents`, `savingsFromPayCents`, `leftToSpendFromPayCents` in `plan.ts`;
words `src/lib/engine/spending-plan/bonus-copy.ts`; loader `src/server/spending-plan.ts`. Tests:
`tests/unit/bonus-line.test.ts`, `tests/e2e/bonus-pays-savings-first.spec.ts`. All amounts, payers and
dates invented. Unit `today = 2026-10-17`; e2e `today = 2026-06-10` (the server's `DEMO_TODAY`).

**The owner's rule (2026-10-03, verbatim option).** "Base pay plans the month … Bonuses show as their
own line and go toward your savings target first. Safest if bonus size varies — you never plan
monthly spending on money that only arrives 4 times a year."

**What counts as bonus money** — in the income-account rows the plan reads, this calendar month, up
to today, posted and counted in flows:

1. a row filed Bonus — whole, signed (a bonus taken back nets against it) — EXCEPT a positive row
   from the payer of a live regular paycheck dated after that paycheck's last payday: it may be the
   paycheck itself (two Bonus filings teach a rule that files the payer's next paycheck Bonus), so
   only the part above the usual paycheck counts until a paycheck lands after it (critic cycle 1, P1-1);
2. a day a live regular paycheck's payer deposited MORE than 1.5× its usual paycheck, once an
   ordinary paycheck (0.5×–1.5×) from that payer has landed after it — the part above the usual
   paycheck (whole-number: `total × 100 > usual × 150`). Without a later ordinary paycheck the day
   may be a raise or a new job — not bonus money (cycle 1, P2-3);
3. a negative row (not filed Bonus) from a payer of this month's bonus money — canonical equal, or
   the same name with more words ("… Ppd Reversal") — nets against it; Zelle, Venmo, checks and other
   aggregate payers never match (cycle 1, P1-2).

The usual paycheck is the stream's paycheck, or after a rise (#786) its newest paycheck (P2-4). The
total is the signed net, never below $0 for what pays savings; the copy prints the signed net (P2-2).

**What it does.** Only on the `regular-pay` basis (which leaves every bonus out of income):
`bonusTowardSavings = min(bonus total, plannedSavings)`, and

    income + bonusTowardSavings = fixed + plannedSavings + leftToSpend
    leftToSpendFromPay = income − fixed − plannedSavings   (what the planners read)
    savingsFromPay     = plannedSavings − bonusTowardSavings (the conscious strip's savings bucket)

Every other basis (`trailing-median`, `user-set`, `detected-series`, `none`) moves nothing — each can
already hold bonus pay. The rest of the bonus plans nothing.

### Worked: a $4,512.30 biweekly paycheck, Fixed $5,000.00, savings 20%

| Step | Value |
|---|---|
| Income: $4,512.30 × 26 ÷ 12 = 11,731,980 ÷ 12 | $9,776.65 |
| Planned savings: 20% of $9,776.65 = 195,533 (Math.round of 195,533.0) | $1,955.33 |
| Guilt-free from pay: 977,665 − 500,000 − 195,533 | $2,821.32 |

| This month's bonus money | Credit | Guilt-free this month | Savings from pay | Left over, not counted |
|---|---|---|---|---|
| none | $0.00 | $2,821.32 | $1,955.33 | — |
| Oct 2: $13,512.30 from the payroll (paycheck + $9,000.00) → $9,000.00 | $1,955.33 | $4,776.65 | $0.00 | $7,044.67 |
| Oct 5: $1,000.00 filed Bonus | $1,000.00 | $3,821.32 | $955.33 | $0.00 |
| Oct 9: $9,000.00 alone from the payroll → $9,000.00 − $4,512.30 = $4,487.70 (low by one paycheck) | — | — | — | — |
| Oct 2 day total exactly $6,768.45 (1.5 × $4,512.30) | not bonus money | | | |
| Oct 2 day total $6,768.46 → $2,256.16 | | | | |
| any bonus, plan on the median / a typed income | $0.00 | unchanged | unchanged | all of it |
| any bonus, no savings target and no goals | $0.00 | unchanged | $0.00 | all of it |
| $9,000.00 bonus, no target, goals $800.00/mo | $800.00 | $4,776.65 (977,665 − 500,000) | $0.00 | $8,200.00 |
| $1,000.00 filed Bonus, then $1,000.00 taken back | $0.00 | unchanged | unchanged | — ("$0.00 in all") |

Conscious split with the $1,000.00 bonus: Fixed $5,000.00 + Savings $955.33 + Guilt-free $3,821.32 =
$9,776.65 (a split of pay). The /budgets savings panel: +$1,955.33 − $1,000.00 = $955.33.

### Worked: the real loader (unit)

Ten paydays Jun 12 – Oct 16 at $4,512.30; rent $3,000.00 in Jul/Aug/Sep; $2,500.00 filed Bonus on
Oct 9; target 20%. Income $9,776.65; Fixed $3,000.00; savings $1,955.33, all paid by the bonus;
guilt-free from pay $4,821.32; guilt-free this month $6,776.65.

### Worked: e2e (`DEMO_TODAY = 2026-06-10`)

Nine paydays Feb 13 – Jun 5 at $4,512.30 (a cent of drift every third); rent $3,000.00; target 20%.
Income $9,776.65; savings $1,955.33; guilt-free this month $9,776.65 − $3,000.00 = $6,776.65.
- $2,500.00 filed Bonus on Wed Jun 3: credit $1,955.33; left over $544.67.
- $9,000.00 from the payroll on Mon Jun 1 (between paydays): bonus money $4,487.70; credit $1,955.33;
  left over $2,532.37. Regular pay still plans the month (the newest payday, Jun 5, is ordinary and
  nothing from the payroll arrived after it).

### Critic cycle 1 cases (all invented, executed in `tests/unit/bonus-line.test.ts`)

| Household (biweekly $4,512.30; Fixed $5,000.00; target 20%) | Bonus money | Credit |
|---|---|---|
| Paydays May 1 – Sep 18; the Oct 2 paycheck filed Bonus; today Oct 5 (stream live, last paid Sep 18) | $4,512.30 − $4,512.30 = $0.00 | $0.00 (guilt-free $2,821.32; was $4,776.65) |
| Same, the Oct 2 deposit = paycheck + $500.00, filed Bonus | $500.00 | $500.00 |
| $9,000.00 filed Bonus from the payroll Oct 9; today Oct 10 (last paid Oct 2) | $9,000.00 − $4,512.30 = $4,487.70 | — |
| Same, today Oct 17 (Oct 16 paycheck landed after it) | $9,000.00 | — |
| Oct 2: paycheck + a duplicate $4,512.30, and −$4,512.30 the same day | $4,512.30 − $4,512.30 = $0.00 | $0.00 (was $1,955.33) |
| $9,000.00 payroll bonus Oct 2, −$9,000.00 "… PPD REVERSAL" Oct 6 | $0.00 | $0.00 |
| $3,000.00 filed Bonus Oct 5, −$5,000.00 filed Bonus Oct 8 | net −$2,000.00 ("-$2,000.00 in all") | $0.00 |
| $7,000.00 on Oct 2 and Oct 16 (a raise of more than half) | none — no ordinary paycheck after | $0.00 |
| $4,000.00 through Aug 7, $4,800.00 from Aug 21; Oct 2 = $7,800.00; today Oct 20 | $7,800.00 − $4,800.00 = $3,000.00 | — |
| Fixed $10,000.00 (over plan) with the $9,000.00 payday bonus | $9,000.00 | $1,955.33 — "the overage is $1,955.33 smaller" |

### Never

- A double paycheck after a missed payday: the missed payday breaks the stream's rhythm, so no live
  stream exists and nothing is read as a bonus.
- A paycheck of the last eight read as a bonus: a stream's in-band paychecks sit within 25% of each
  other and its paycheck is never below the smallest, so none can exceed 1.5× it. A paycheck filed
  Bonus counts only above one paycheck until another paycheck lands after it; a paycheck deposited
  twice and taken back nets to nothing.
- A bonus month's credit in a figure that plans beyond this month: every solver input reads
  `leftToSpendFromPayCents` (locked by a source scan).
