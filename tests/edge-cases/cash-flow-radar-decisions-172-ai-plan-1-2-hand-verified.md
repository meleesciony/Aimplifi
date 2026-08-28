## §Cash Flow Radar (DECISIONS #172 — AI plan §1.2, hand-verified)

`computeRadar` merges /forecast's committed events with cash-needed card obligations (plus
synthesized future cycles, always `isEstimated`) into one committed-only walk; the burn band is a
separately-labeled estimate that can raise at most `watch`, never `alert`. All cases below use
today = `2026-06-10` (June 1 2026 is a Monday) and are pinned in `tests/unit/radar.test.ts` /
`tests/unit/radar-burn.test.ts`.

### A. Clear — no dip, no proposal
Start 100000¢; payroll +50000¢ on 06-15; one card due 30000¢ on 06-20; horizon 30. Walk:
100000 → 150000 (06-15) → 120000 (06-20). `firstNegativeDate` null, lowest 100000¢ @ 06-10
(the day-0 anchor), ending 120000¢, status `ok`, coverTransfer null.

### B. Dip after a card — named card + minimum timed cover
Start 100000¢; "Sapphire" due 70000¢ Fri 06-19; rent −60000¢ Wed 06-24; horizon 30, no holidays.
Walk: 30000 (06-19) → **−30000** (06-24). firstNegative 06-24, worst dip 30000¢ →
`roundUpToNext50Dollars(30000) = 30000` ($300 — exact multiple stays), byDate =
`previousBusinessDay(06-24)` = Tue **06-23**. No card due ON 06-24 ⇒ colliding card = the most
recent due before it: **Sapphire (06-19)**. daysUntil = 14 ⇒ pushWorthy false. Sources: savings
500000¢ sufficient; an INVESTMENT brokerage is NEVER a source (adjudicated condition 2); the
payment account itself is never a source.

### C. Due TODAY comes off the day-0 anchor
Start 20000¢; card due 30000¢ ON 06-10 (today). `computeForecast` applies only future-dated
events, so the engine subtracts today's dues from the anchor: day-0 balance −10000¢ ⇒
firstNegative = **today**, daysUntil 0, pushWorthy **true**, colliding = that card. Cover:
dip 10000¢ → amount 10000¢ ($100); ideal 06-09 is in the past ⇒ byDate clamped to **06-10**.

### D. Future-cycle synthesis (projectCardDues), July-4 walk-back, statement basis
"Freedom", cashRequired 40000¢ (no mid-cycle payment ⇒ basis = cashRequired), raw due Sat
2026-07-04, cash-needed effective 07-02 (Sat→Fri 07-03 = observed Independence Day→Thu 07-02);
horizon 90 (end 09-08), holidays = [2026-07-03]. Dues: 07-02 (real, 40000¢) + synthesized
**08-04** and **09-04** (raw +1/+2 months from 07-04; both business days), each 40000¢
`isEstimated: true`; 10-04 is past the horizon. Stale anchor: raw due 2026-05-08 (passed;
effective clamped to today) ⇒ k=1 lands 06-08 ≤ today and is SKIPPED; an occurrence landing
exactly ON today is also skipped (the clamped current due already covers it); k=2 gives 07-08.
**Statement basis (critic #172 P1-1):** future cycles repeat `cycleBasisCents` (the FULL
statement balance, supplied by the server), never this cycle's post-mid-cycle-payment residual:
statement 100000¢ with 40000¢ paid ⇒ current due 60000¢ but future cycles **100000¢** each. A
card fully paid THIS cycle (cashRequired 0, basis 100000¢) still projects future cycles at
100000¢; a card with basis ≤ 0 (credit balance, or $0-due with no statement) projects nothing.

### E. Burn pace (weekly nearest-rank percentiles ÷ 7)
Real checking spend is sparse (most days $0), so pace comes from complete WEEKLY totals — a
daily percentile collapses to a false $0/day (critic #172 P1-2). Weeks are 7-day chunks counted
BACK from the most recent complete day, clamped to `min(lookback, historyDays)`; typical = p50
weekly ÷ 7, heavy = p80 weekly ÷ 7 (nearest-rank: rank = ceil(p·n); the ÷7 is one
`roundHalfAwayFromZero`).
- 8 weeks [0,0,7000,7000,14000,14000,21000,70000]: p50 rank 4 → 7000 → **1000/day**; p80 rank
  ceil(6.4)=7 → 21000 → **3000/day**.
- $70 once a week × 8 (six $0 days each week): typical = heavy = **1000/day** (not $0).
- 1000¢/wk → 1000/7 = 142.857… → **143/day** (half-away-from-zero).
- 10 dailies → 1 complete week (the most recent 7; the older partial is dropped); sampleDays 7.
- History clamp: 28 old days @2000/day + 28 new @1000/day — historyDays 28 ⇒ only the newest 4
  weeks count (typical=heavy=1000); historyDays 56 ⇒ weekly totals [7000×4, 14000×4]: typical
  1000, heavy **2000** (p80 rank 7 → 14000).
- hasEnoughHistory: historyDays 28 → true; 27 → false (BURN_MIN_HISTORY_DAYS = 28).
`discretionaryDailyOutflows` window = the 56 COMPLETE days [today−56, today−1] (today's partial
day would bias low); zero-days count as 0; PENDING / transfers / split parents / inflows / other
accounts / excluded canonicals (scheduled + recurring merchants) are all excluded.

### F. Burn band walks the committed path; watch vs ok
Committed flat 100000¢, no events, horizon 10, typical 1000¢/day, heavy 3000¢/day (history ok):
expected ending 100000−1000×10 = **90000**; conservative ending **70000**; both clear ⇒ `ok`.
Start 20000¢ instead: heavy line 20000−3000d < 0 first at d=7 (−1000) ⇒ conservative
firstNegative **06-17** while committed + typical stay clear ⇒ status **`watch`** (the burn band
can never produce `alert` — adjudicated condition 1). With hasEnoughHistory false both band
lines are null and status falls back to `ok`.
