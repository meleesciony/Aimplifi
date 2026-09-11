## Goal-progress-and-pace (DECISIONS #737 — hand-verified)

`goalProgress` (src/lib/engine/goals/progress.ts) answers "how far along am I?" and "will I make my
date?" from a goal's stored fields alone. It originates no new money math: the timeline is
`goalFundingMonths` (`ceil(remaining / monthly)`, flat, no growth — the /goals card's model) and the
required monthly for a dated goal is `solveSavingsGoalByDate`'s own figure (`ceil(remaining /
targetMonths)`), so the card and Ask Aimplifi state ONE number. The deadline is MONTH-granular:
the form stores a month pick as the 1st, Ask resolves "by June 2027" to the month's END, and every
card prints "by Jun 2027" — so pace is judged against `monthWindow(monthKey(targetDate)).to` (the
last day of the target month), never the stored day. `targetMonths` is the solver's
`wholeMonthsUntil` (largest k with `addMonthsClamped(today, k) ≤ deadline`). `fundedBps =
min(10000, floor(saved × 10000 / target))` — FLOORED so the bar can understate by < 0.01% but never
claim 100% early; target ≤ 0 → 10000. `remaining = max(0, target − saved)`. Every figure below is
pinned in `tests/unit/goal-progress.test.ts` (today = 2026-06-10 unless noted). Ask's
`goal_status` intent (DECISIONS #738) prints this module's `goalPaceSentence` byte-for-byte;
it adds no figures of its own.

Pace precedence: `funded` (remaining 0) → `date-passed` (date set, targetMonths < 1) → `no-pledge`
(monthly null/0) → `no-date` (no date) → `on-track` (monthsToFunded ≤ targetMonths) → `behind`.

### GP-A. On the date — $6,000, $0 saved, $500/mo, date 2027-06-10
remaining 600000c; fundedBps 0; monthsToFunded = ceil(600000/50000) = 12; fundedBy =
addMonthsClamped(2026-06-10, 12) = 2027-06-10; targetMonths 12; required = ceil(600000/12) =
**50000c**; pace `on-track`, monthsDelta 12 − 12 = 0; gap null.

### GP-B. Ahead — $1,500 saved (25%) at $500/mo
remaining 450000c; fundedBps = floor(150000×10000/600000) = 2500; monthsToFunded = ceil(450000/50000)
= 9; fundedBy 2027-03-10; required = ceil(450000/12) = **37500c**; `on-track`, monthsDelta 3.

### GP-C. Behind — $300/mo toward $6,000 in 12 months
monthsToFunded = ceil(600000/30000) = 20; fundedBy 2028-02-10; targetMonths 12; required 50000c;
`behind`, monthsDelta 20 − 12 = 8; gap = 50000 − 30000 = **20000c** ($200.00/mo more).

### GP-D. Funded — saved ≥ target
$1,000 saved of $1,000: remaining 0, fundedBps 10000, monthsToFunded 0, fundedBy = today, dated →
required 0 (solver `already-funded`); undated → required null. $2,500 of $1,000 clamps to 10000.

### GP-E. Date passed — date this month or earlier with money to go
$1,000, $100/mo, date 2026-06-30: addMonthsClamped(today, 1) = 2026-07-10 > 06-30 → targetMonths 0 →
solver `unreachable` → pace `date-passed`; required **null** (no figure invented); the pledge's own
timeline is still a fact: monthsToFunded 10, fundedBy 2027-04-10. A 2025-12-01 date is the same pace.

### GP-F. No pledge, dated — the solver's SG-C figure
$5,000, monthly null, date 2027-01-10: targetMonths 7; required = ceil(500000/7) = **71429c** ($714.29);
monthsToFunded null; pace `no-pledge`.

### GP-G. Zero pledge, no date
monthly 0 is no pledge: `no-pledge`, monthsToFunded/targetMonths/required all null.

### GP-H. Pledge, no date
$500/mo toward $6,000: `no-date`, monthsToFunded 12, fundedBy 2027-06-10, required null.

### GP-I. Floored percent
$2,999.99 of $3,000: floor(299999×10000/300000) = floor(9999.966…) = **9999 bps**, remaining 1c, not
`funded`.

### GP-J. Calendar-month clamp
today 2026-01-31, $100 at $100/mo: monthsToFunded 1, fundedBy addMonthsClamped → **2026-02-28**.

### GP-L. Month granularity — 2027-06-01, 2027-06-10 and 2027-06-30 judge alike
$6,000 at $500/mo funds 2027-06-10. Deadline for all three = 2027-06-30 → targetMonths 12, required
50000c, `on-track`, monthsDelta 0. (Against the stored 1st, `wholeMonthsUntil` would give 11 and
call the goal "behind by 1 month" — a verdict against a day the reader never chose.) "by Jul 2026"
stored as 2026-07-01 → deadline 07-31 → targetMonths 1 (one contribution cycle) → $500 at $500/mo
`on-track`. "by Jun 2026" (this month) → deadline 06-30 → targetMonths 0 → `date-passed`.

### GP-M. The basis is hand-typed — an Ask-saved goal one month later (critic P1-1)
`saveSavingsGoal` writes savedCents 0 + monthly = the solved pledge. "$6,000 by Jun 2027" solved on
2026-06-10 → $500/mo. Read on **2026-07-10** with saved never updated: targetMonths = 11 (07-10 + 11
= 2027-06-10 ≤ 06-30; +12 = 07-10 >), monthsToFunded still 12 → `behind`, monthsDelta 1, required =
ceil(600000/11) = ceil(54545.45) = **54546c** ($545.46), gap 4546c ($45.46). True of the STORED fields,
not necessarily of the reader's money (the July transfer may simply be unmarked). Every projecting
sentence therefore names "counting the $X you've marked saved", and the behind sentence offers
"update what you've saved" before the bigger pledge; Home prints "$X marked saved of $Y" beside the
percent so "0%" can never read as a fact about the account.

### GP-K. Degenerate inputs
target 0 → fundedBps 10000, `funded`. saved −500 (never written by the app) reads as 0 for the
percent; remaining = 600500c.

### Property: solver consistency + minimality
For a grid of (target, saved, date): `requiredMonthly` and `targetMonths` equal
`solveSavingsGoalByDate`'s; pledging exactly `requiredMonthly` is `on-track` with monthsToFunded =
`goalFundingMonths(remaining, required)`; pledging `required − 1` is `behind` with gap 1c and
monthsDelta ≥ 1. `on-track` ⇔ fundedBy ≤ targetDate.
