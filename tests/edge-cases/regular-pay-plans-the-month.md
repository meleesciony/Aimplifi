## §Regular pay plans the month (DECISIONS #785)

Engine: `src/lib/engine/spending-plan/regular-pay.ts` (`payFrequencyFromDates`,
`regularPayFromRows`, `regularPayBasisSentence`); plan basis `'regular-pay'` in `plan.ts`;
loader `src/server/spending-plan.ts`. Tests: `tests/unit/regular-pay.test.ts`,
`tests/unit/regular-pay-plan.test.ts`. All amounts and payers invented. `today = 2026-10-03`
(window Jul, Aug, Sep 2026 — starts Jul 1) unless stated.

**The rule — one steady paycheck, or the old basis.** Regular pay plans the month ONLY when ONE
steady paycheck clearly explains the household's recent pay (owner decisions at three human gates,
2026-10-04: fail closed after five critic cycles; conditions 2–3 tightened after cycle 6; one
paycheck only after cycle 7; cycle 8 PASS, its P2/P3 fixes applied before ship):

1. exactly one steady paycheck is still arriving — none → `no-steady-paycheck`; two or more →
   `second-paycheck`;
2. its current UNBROKEN run of paydays (each gap ≤ 1.5 periods) began before the window — else
   `new-paycheck`;
3. it held one level: its last eight paychecks agree within 2% (largest ÷ smallest ≤ 1.02), its
   newest payday is an ordinary paycheck (≤ 1.5× typical), and no other deposit from the payroll has
   arrived after that payday — else `pay-changed`;
4. no other steady payroll stopped inside the window (stale, last payday on or after the window
   start) — else `paycheck-stopped`;
5. everything else counted as pay (other payers, and the payroll's own out-of-band deposits; never a
   Bonus) has a median month over the window of at most 10% of a USUAL month's paychecks (paycheck × 2
   for every-two-weeks or twice-a-month, × 4 weekly, × 1 monthly) — else `other-income`. "Pay" is a
   deposit filed Paycheck, Side Gig / Freelance or Income; every other income category is outside both
   the figure and the test. The 2% and 10% comparisons are whole-number (×100 against 102 / 10).

Clean → income = the paycheck at its yearly rate + that usual remainder. Not clean → the median of
the last three complete months, exactly as before (the plan also checks `clean`, not only a positive
figure). A typed income wins over both.

**Frequency** — mean interval over the (up to 10) most recent paydays (per-date totals per payer,
each at least 0.5× the payer's typical payday):

| Mean interval (days) | Frequency | Paychecks a year |
|---|---|---|
| 5–9, every payday within 1 day of a 7-day grid anchored on the newest (else no rhythm) | weekly | 52 |
| 12.5–16.5, ≥ 9 paydays ALL within 2 days of a 14-day grid anchored on the newest | biweekly | 26 |
| 12.5–16.5, otherwise | semimonthly | 24 |
| 26–35 | monthly | 12 |

Every gap must lie in [0.5×, 1.5×] of the period (7 / 14 / 15 / 30 days). If every payday does not
show a rhythm, the paydays of ordinary size (≤ 1.5× typical) are tried — a bonus through payroll on
its own date does not break it. The paychecks (≤ 1.5× typical) among the last EIGHT paydays must
agree within 25% to be a steady payroll at all. The paycheck is their MEDIAN, never more than the
NEWEST (inside the 2% band a raise arrives late, a cut at once). Still arriving = newest payday within
one period + 5 days (weekly 12, biweekly 19, semimonthly 20, monthly 35).

**Clean cases**

- **Biweekly Fridays, cent drift** (Jun 12 … Oct 2, nine paydays on the grid): $4,210.55 (before a
  raise), then $4,512.30, $4,512.31, $4,512.30, $4,512.31, $4,512.30, $4,512.30, $4,512.31, $4,512.30
  → biweekly. Last eight: spread 1.000002; median $4,512.30 (five .30, three .31), newest $4,512.30 →
  **$4,512.30**. Monthly = 451,230 × 26 ÷ 12 = **977,665 ($9,776.65)**. Run from Jun 12 < Jul 1; other
  income $0.00 → clean. (`detectRecurring` finds no series: three distinct amounts.)
- **Inside the 2% band**: $3,000.00 then $3,050.00 (+1.67%) on Sep 4 … Oct 2 → median of the eight
  $3,000.00, newest $3,050.00 → $3,000.00 → **$6,500.00** (the raise arrives late). $3,000.00 then
  $2,950.00 (−1.67%) on Oct 2 only → never more than the newest → 295,000 × 26 ÷ 12 = 639,166.67 →
  **$6,391.67** (the cut at once).
- **Semimonthly** $3,000.00 (Jun 15 … Sep 30) → **$6,000.00**. **Weekly** $812.40 (Jun 5 … Oct 2) →
  81,240 × 52 ÷ 12 = **$3,520.40**. **Monthly** $5,200.00 (Jun 1 … Oct 1) → **$5,200.00**.
- **Distributions filed Income** ($268.40 a month, a non-payroll payer — no Paycheck row, so not a
  stream) beside the biweekly payroll: $268.40 ≤ 10% × (2 × $4,512.30) = $902.46 → clean,
  **$10,045.05**. Alone → `no-steady-paycheck`.
- **Bonuses** — filed Bonus (Aug, Sep) → never pay rows → **$9,776.65**. Folded into the Sep 4 payday
  (one $13,512.30 deposit, not the newest): the date keeps the rhythm; the amount is above 1.5 ×
  $4,512.30 so it is not a paycheck — the other seven: median $4,512.30, newest $4,512.30; Sep other
  $13,512.30, Jul and Aug $0.00 → median **$0.00** → **$9,776.65**. Paid off-cycle on Sep 30
  ($13,500.00): every-payday rhythm fails (Sep 30 → Oct 2 is 2 days), the ordinary paydays are
  biweekly; Sep other $13,500.00, median $0.00 → **$9,776.65**.
- **Two deposits on one payday** ($1,500 + $1,000, nine Fridays) → one $2,500.00 paycheck → 250,000 ×
  26 ÷ 12 = **$5,416.67**.
- **A payroll filed half Paycheck, half generic Income** → one payer → **$9,776.65**.
- **Mobile-banking deposits** ($3,000.00 Jun 15 … Sep 15, "DEPOSIT MOBILE BANKING", Jul 15 filed
  Paycheck, the rest Income): filed Income they are money moved in; the Paycheck one is a single date
  (no rhythm) and July's "other" only → median $0.00 → **$9,776.65**, one stream.
- **A $45.00 payroll reimbursement on Sep 10** (not after the newest payday): under 0.5 × $4,512.30 →
  not a payday; September other $45.00, median $0.00 → **$9,776.65**.
- **Job change, settled** (old monthly $7,000.00 Mar 31 … Jun 30; new $3,500.00 every 14 days from Jun
  26): on Oct 3 the new payroll has eight paydays — not yet nine, so read 24 a year — run from Jun 26
  < Jul 1; the old payroll stopped Jun 30, before Jul 1 → clean, 350,000 × 24 ÷ 12 = **$7,000.00**.
- **A bonus on the newest payday, one period later**: Oct 2 = $13,512.30 holds the median on Oct 3
  (below); with an ordinary $4,512.30 on Oct 16, on Oct 17 (window still Jul–Sep, Oct 2 outside it) →
  **$9,776.65**.
- **Pending, transfer-flagged, excluded and outflow rows** never count.

**Fallback cases — the median, exactly as before**

- **A second steady paycheck** (critic cycle 7, P1-1; the cycle-7 code's figure in brackets): $8,000.00
  every 14 days (2025-06-06 … 2026-09-25) + a monthly stipend raised $400.00 → $650.00 in June 2026 —
  the stipend's typical payday is $400.00, its five $650.00 paydays sat above 1.5×, so its $400.00 was a
  stream and each $650.00 counted whole as other: [$18,383.33 vs a true $17,983.33] →
  `second-paycheck`, **0**. Two payrolls both paying since before the window (biweekly $9,776.65 +
  semimonthly $6,000.00) → `second-paycheck`. A side gig $400.00 weekly from Sep 4 →
  `second-paycheck`.
- **Pay changed — more than 2% inside the last eight** (critic cycle 6; the cycle-6 code's figure in
  brackets): five $3,700.00 overtime checks of eight then $3,000.00 again [$8,016.67]; overtime still
  running; a cut to $2,500.00 on Oct 2 [$6,500.00]; a 3% raise to $3,090.00 from Aug 7 [$6,695.00]; a
  raise through transition amounts ($4,233.10 … $4,512.31); weekly $800.00 with six $980.00 weeks then
  $800.00 [$4,246.67]; alternating twice-a-month $2,800 / $3,200 → `pay-changed`, **0**.
- **Pay changed — the newest payday** (critic cycle 7): $2,000.00 every 14 days from 2025-10-03, then
  $3,100.00 on Oct 2 (+55%, above 1.5×) [cycle-7 code: clean at $4,333.33] → `pay-changed`. $4,000.00
  every 14 days to Sep 18, then $1,800.00 on Oct 2 (under half — not a payday, arriving after the newest
  payday) [cycle-7 code: clean at $8,666.67] → `pay-changed`. A $13,512.30 bonus on the newest
  payday (Oct 2) → `pay-changed` until the next ordinary paycheck.
- **Twice a month on the 2nd and 4th Friday** (critic cycle 7, P2-2): Jan 9 … May 22 2026 (ten
  paydays). The last eight sit on an exact 14-day grid; Jan 23 → Feb 13 is 21 days → **semimonthly**,
  $3,000.00 → $6,000.00 (the eight alone → semimonthly too: fewer than nine).
- **Seasonal restart** (critic cycle 6, P2-1): weekly $975.00 Nov 7 2025 … Mar 27 2026, again Jul 3 …
  Oct 2 (fourteen paydays): the run walks back from Oct 2 and stops at the 98-day gap → run from Jul 3
  ≥ Jul 1 → `new-paycheck`, **0**.
- **Job change, in progress**: on Aug 21 (window May–Jul) the new payroll's run began Jun 26 ≥ May 1 →
  `new-paycheck`, **0**.
- **A payroll stopped inside the window**: biweekly $3,000.00 last Aug 7 (stale) beside a semimonthly
  payroll still paying → `paycheck-stopped`, **0**.
- **Pension** $3,000.00 monthly filed Income beside the biweekly payroll: other $3,000.00 > $902.46 →
  `other-income`, **0**. **Hourly second job** ($1,800–$2,600 biweekly, spread 1.44 — never steady):
  Jul $6,500.00, Aug $4,600.00, Sep $4,300.00 → median $4,600.00 → `other-income` (spread over its last
  eight paydays $2,600 ÷ $1,900 = 1.37).
- **The 10% is of a usual month**: $3,000.00 biweekly (two paychecks $6,000.00, 10% = $600.00; yearly
  average $6,500.00) + $640.00 a month filed Income → `other-income`.
- **Commission on a payday every month** (+$9,000.00 on Jul 24, Aug 21, Sep 18) → other median
  $13,512.30 → `other-income`.
- **Two earners on one payroll name, alternating weeks** $3,000 / $1,800: spread 1.67 > 1.25 → no
  stream → `no-steady-paycheck`, **0**.
- **Big raise mid-window**: $1,000.00 (Jun 12, Jun 26) → $2,400.00 from Jul 10: typical $2,400.00, the
  $1,000.00 paydays fall below 0.5× → the run begins Jul 10 ≥ Jul 1 → `new-paycheck`, **0**.
- **A paycheck that doubled recently**: ten biweekly $1,000.00 (from Feb 20) then seven $2,000.00 (to
  Oct 2): typical payday $1,000.00, only one of the last eight is ≤ $1,500.00 → fewer than three
  paychecks → `no-steady-paycheck`, **0**.
- **Re-linked account** (`spending-plan-income-reconciled.test.ts`, today Aug 2, window May–Jul): a
  monthly $10,000.00 payroll read across the reconciliation, run from May 8 ≥ May 1 → `new-paycheck`;
  the plan keeps the median of [$10,000.00, $10,000.00, $14,000.00] = **$10,000.00**.

**Boundaries pinned (critic cycle 8)**

- **Four fixed dates a month** ($1,000.00 on the 1st, 8th, 15th, 22nd, Mar … Oct 1 — 48 a year): mean
  gap about 7.6 days, but the 22nd → 1st gap (9–10 days; 7 only Feb → Mar) is off a 7-day grid by ≥ 2 →
  no rhythm → `no-steady-paycheck` [cycle-8 code: clean, weekly, $4,333.33 vs a true $4,000.00]. Two
  earners under "DIRECT DEPOSIT PAYROLL", $2,000.00 each on the 1st/15th and 7th/22nd → no rhythm, **0**
  [was $8,666.67 vs $8,000.00]. A true weekly payroll (Jul 31 … Oct 2) with Sep 4 moved to Sep 3 →
  weekly; to Sep 2 → no rhythm.
- **10% of a usual month**: $1,000.00 weekly (four → $4,000.00, 10% = $400.00) + $450.00 a month →
  `other-income`; + exactly $400.00 → clean, 100,000 × 52 ÷ 12 = 433,333 + 40,000 = **$4,733.33**.
  $5,000.00 monthly (10% = $500.00) + $550.00 → `other-income`. $3,000.00 biweekly + exactly $600.00 →
  clean, 650,000 + 60,000 = **$7,100.00**; + $600.01 → `other-income`.
- **Exactly 2%**: last eight four $3,060.00 then four $3,000.00 → 306,000 × 100 = 300,000 × 102 → held;
  median $3,030.00, newest $3,000.00 → **$6,500.00**. $3,060.01 → `pay-changed`.
- **First payday on the window start**: seven paydays from Jul 1 → `new-paycheck`; from Jun 30 →
  clean, read 24 a year, **$6,000.00**.
- **Stale at 20 days, not 19** (biweekly): newest payday Sep 14 (19 days before Oct 3) → clean
  **$6,500.00**; Sep 13 (20 days) → `no-steady-paycheck`.
- **A three-week pause** (weekly $975.00 Mar 6 … Jul 10, again Jul 31 … Oct 2): 21 days > 1.5 periods →
  run from Jul 31 → `new-paycheck`.
- **A partial final check off-cycle** ($4,000.00 every 14 days 2025-10-03 … 2026-09-04, then $1,800.00 on
  Sep 10; today Sep 11): a deposit after the newest payday that is not a payday → `pay-changed`
  [cycle-8 code: clean at $8,666.67 until stale].

**Plan** (`computeSpendingPlan`): median [$9,024.60, $13,536.90, $9,024.60] (two, three, two paychecks
of $4,512.30) = $9,024.60 — the old figure — vs regular pay **$9,776.65**; Fixed $5,000.00, savings
20% × $9,776.65 = $1,955.33 → guilt-free **$2,821.32**. A not-clean `RegularPay` carrying a positive
figure → the median **$9,024.60**.

**Loader** (the biweekly payroll above + a fund paying $6,840.00 in July and $268.40 in September,
filed Income, + rent $3,000.00): other income median(Jul $6,840.00, Aug $0.00, Sep $268.40) = $268.40 ≤
$902.46 → clean, income **$10,045.05** (label "Income (regular pay + other income, monthly)"); savings
20% = $2,009.01; guilt-free $10,045.05 − $3,000.00 − $2,009.01 = **$5,036.04**.

**e2e** (DEMO_TODAY 2026-06-10, window Mar–May; nine paydays Feb 13 … Jun 5 — the run begins before
Mar 1; $4,512.30 with a cent more on Feb 13, Mar 27, May 8; rent $3,000.00, no target): last eight
median $4,512.30, newest $4,512.30 → $9,776.65 − $3,000.00 = **$6,776.65**.

**The sentence** (one author for every surface) gives the arithmetic, the timing, what is left out,
and the rule in the code's own terms: "Only deposits filed Paycheck, Side Gig / Freelance or Income
count here; …" and "This figure is used only while one steady paycheck explains your pay: paid without
a break since before your last three complete months, within 2% across its last eight paychecks, no
other regular paycheck in that time, and the rest of those deposits no more than a tenth of a usual
month's pay. Otherwise the plan uses the median of your last three complete months. Within that
2%, a raise counts here once most of your last eight paychecks show it; a cut counts at once." A
24-a-year stream is described as "about twice a month — or pay every two weeks whose dates do not yet
confirm it, counted the lower way".
